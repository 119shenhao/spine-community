import {Env,Row,one,stmt,now,id,hash,b64,randomToken,cookie,fail,json} from './core';

const googleJwks='https://www.googleapis.com/oauth2/v3/certs';
const googleIssuers=['https://accounts.google.com','accounts.google.com'];
const identityCallback='/api/auth/identity/callback';
const identityStateCookie='__Host-sc_identity_oauth';
const jwksCache=new Map<string,{keys:(JsonWebKey & {kid:string})[],until:number}>();
const decode=(value:string)=>Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),char=>char.charCodeAt(0));

async function verifyIdToken(token:unknown,clientId:string,nonce:string,issuers:string[],jwksUrl:string):Promise<Row>{
  if(typeof token!=='string'||token.length>8192)fail(401,'invalid_identity');
  const parts=token.split('.');
  if(parts.length!==3||parts.some(part=>!/^[A-Za-z0-9_-]+$/.test(part)))fail(401,'invalid_identity');
  let header:Row,payload:Row,signature:Uint8Array<ArrayBuffer>;
  try{
    header=JSON.parse(new TextDecoder().decode(decode(parts[0])));
    payload=JSON.parse(new TextDecoder().decode(decode(parts[1])));
    signature=decode(parts[2]);
  }catch{return fail(401,'invalid_identity');}
  if(header?.alg!=='RS256'||typeof header.kid!=='string'||!header.kid||header.kid.length>128||!payload)fail(401,'invalid_identity');
  let jwks=jwksCache.get(jwksUrl);
  if(!jwks||jwks.until<=now()||!jwks.keys.some(key=>key.kid===header.kid)){
    try{
      const response=await fetch(jwksUrl,{redirect:'manual',signal:AbortSignal.timeout(7000)});
      if(!response.ok)fail(503,'identity_provider_unavailable');
      const data=await response.json() as {keys:(JsonWebKey & {kid:string})[]};
      if(!Array.isArray(data.keys)||data.keys.length>32)fail(503,'identity_provider_unavailable');
      jwks={keys:data.keys.filter(key=>key?.kty==='RSA'&&typeof key.kid==='string'&&(!key.alg||key.alg==='RS256')),until:now()+1800};
      jwksCache.set(jwksUrl,jwks);
    }catch{return fail(503,'identity_provider_unavailable');}
  }
  const key=jwks.keys.find(key=>key.kid===header.kid);
  if(!key)fail(401,'invalid_identity');
  try{
    const cryptoKey=await crypto.subtle.importKey('jwk',key,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
    if(!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',cryptoKey,signature,new TextEncoder().encode(parts[0]+'.'+parts[1])))fail(401,'invalid_identity');
  }catch{return fail(401,'invalid_identity');}
  if(!issuers.includes(payload.iss)||payload.aud!==clientId||!Number.isFinite(payload.exp)||!Number.isFinite(payload.iat)||
      payload.exp<=now()||payload.iat>now()+60||payload.nonce!==nonce||typeof payload.sub!=='string'||!payload.sub||payload.sub.length>255)fail(401,'invalid_identity');
  return payload;
}

export function verifyGoogle(token:string,clientId:string,nonce:string):Promise<Row>{
  return verifyIdToken(token,clientId,nonce,googleIssuers,googleJwks);
}

export function identityLoginConfig(env:Env,origin:string){
  const {IDENTITY_ISSUER:issuer,IDENTITY_REDIRECT_URI:redirectUri,IDENTITY_CLIENT_ID:clientId,IDENTITY_CLIENT_SECRET:clientSecret}=env;
  if(env.IDENTITY_LOGIN_ENABLED!=='true'||!issuer||!redirectUri||!clientId||!clientSecret||
      !/^[A-Za-z0-9._-]{1,128}$/.test(clientId)||!/^[A-Za-z0-9_-]{32,128}$/.test(clientSecret))return null;
  try{
    const issuerUrl=new URL(issuer);
    if(issuerUrl.protocol!=='https:'||issuerUrl.origin!==issuer||!origin.startsWith('https://')||redirectUri!==origin+identityCallback)return null;
  }catch{return null;}
  return {issuer,redirectUri,clientId,clientSecret};
}

const sessionCookie=(req:Request,value:string,age=2592000)=>`sc_session=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${age}${new URL(req.url).protocol==='https:'?'; Secure':''}`;
const flowCookie=(value:string,age=600)=>`${identityStateCookie}=${value}; Path=/; Max-Age=${age}; HttpOnly; Secure; SameSite=Lax`;
function redirect(location:string,cookieValue?:string){
  const headers=new Headers({location,'cache-control':'no-store','referrer-policy':'no-referrer'});
  if(cookieValue)headers.set('set-cookie',cookieValue);
  return new Response(null,{status:302,headers});
}
const findIdentity=(db:D1Database,provider:string,subject:string)=>one(db,'SELECT user_id FROM auth_identities WHERE provider=? AND provider_subject=?',provider,subject);

async function findOrCreateUser(db:D1Database,provider:string,subject:string):Promise<string>{
  const identity=await findIdentity(db,provider,subject);
  if(identity)return identity.user_id;
  const uid=id();
  try{
    await db.batch([
      stmt(db,"INSERT INTO users(id,nickname) VALUES(?,?)",uid,'Member '+uid.slice(0,6)),
      stmt(db,'INSERT INTO auth_identities(id,user_id,provider,provider_subject) VALUES(?,?,?,?)',id(),uid,provider,subject),
      stmt(db,"INSERT INTO daily_community_metrics(day_utc,new_users) VALUES(date('now'),1) ON CONFLICT(day_utc) DO UPDATE SET new_users=new_users+1")
    ]);
  }catch(error){
    const existing=await findIdentity(db,provider,subject);
    if(existing)return existing.user_id;
    throw error;
  }
  return uid;
}

async function requireActiveMember(db:D1Database,uid:string){
  const user=await one(db,'SELECT status,is_system FROM users WHERE id=?',uid);
  if(user?.status!=='active'||user.is_system)fail(403,'account_unavailable');
}

async function startSession(req:Request,db:D1Database,uid:string,returnTo='/'){
  const token=randomToken();
  const created=await one(db,`INSERT INTO user_sessions(id,user_id,token_hash,expires_at)
    SELECT ?,id,?,? FROM users WHERE id=? AND status='active' AND is_system=0 RETURNING id`,id(),await hash(token),now()+2592000,uid);
  if(!created)fail(403,'account_unavailable');
  return redirect(returnTo,sessionCookie(req,token));
}

export async function login(req:Request,env:Env,subject:string,provider='google'){
  const uid=await findOrCreateUser(env.DB,provider,subject);
  await requireActiveMember(env.DB,uid);
  if(provider==='google'&&env.ADMIN_GOOGLE_SUB&&subject===env.ADMIN_GOOGLE_SUB){
    await stmt(env.DB,"INSERT OR IGNORE INTO user_roles(user_id,role) VALUES(?,'admin')",uid).run();
  }
  return startSession(req,env.DB,uid);
}

async function linkIdentity(db:D1Database,subject:string,googleSubject:string){
  const linked=await findIdentity(db,'identity_center',subject);
  if(linked){
    const google=await findIdentity(db,'google',googleSubject);
    if(google?.user_id!==linked.user_id)fail(409,'identity_link_conflict');
    return linked.user_id as string;
  }
  const uid=await findOrCreateUser(db,'google',googleSubject);
  await requireActiveMember(db,uid);
  await stmt(db,`INSERT INTO auth_identities(id,user_id,provider,provider_subject)
    SELECT ?,u.id,'identity_center',? FROM users u JOIN auth_identities g ON g.user_id=u.id
    WHERE u.id=? AND u.status='active' AND u.is_system=0 AND g.provider='google' AND g.provider_subject=?
    ON CONFLICT DO NOTHING`,id(),subject,uid,googleSubject).run();
  const verified=await findIdentity(db,'identity_center',subject);
  if(verified?.user_id!==uid)fail(409,'identity_link_conflict');
  return uid;
}

function safeReturnPath(value:string|null,origin:string){
  if(!value||value.length>2000||!value.startsWith('/')||value.startsWith('//')||/[\\\u0000-\u001f\u007f]/.test(value))return '/';
  const returnUrl=new URL(value,origin);
  if(returnUrl.origin!==origin||returnUrl.pathname.startsWith('//')||/^\/api(?:\/|$)/i.test(returnUrl.pathname))return '/';
  return returnUrl.pathname+returnUrl.search+returnUrl.hash;
}

async function pkceChallenge(verifier:string){
  return b64(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))));
}

async function identityRoute(req:Request,env:Env,url:URL){
  const config=identityLoginConfig(env,url.origin);
  if(!config)fail(503,'identity_not_configured');
  if(url.pathname==='/api/auth/identity'){
    const state=randomToken(),nonce=randomToken(),verifier=randomToken(),current=now();
    const returnTo=safeReturnPath(url.searchParams.get('return_to'),url.origin);
    await env.DB.batch([
      stmt(env.DB,'DELETE FROM identity_login_states WHERE expires_at<=?',current),
      stmt(env.DB,'INSERT INTO identity_login_states(state_hash,nonce,verifier,return_path,expires_at) VALUES(?,?,?,?,?)',await hash(state),nonce,verifier,returnTo,current+600)
    ]);
    const params=new URLSearchParams({client_id:config.clientId,redirect_uri:config.redirectUri,response_type:'code',scope:'openid',
      state,nonce,code_challenge:await pkceChallenge(verifier),code_challenge_method:'S256',prompt:'select_account'});
    // This button explicitly requests Google via Identity Center. Google OAuth,
    // account mapping and browser sessions remain managed by the Center.
    // A registered web_confidential client may omit the provider chooser UI.
    params.set('provider_hint','google');
    return redirect(config.issuer+'/oauth/authorize?'+params,flowCookie(state));
  }

  const state=url.searchParams.get('state');
  if(!state||!/^[A-Za-z0-9_-]{43}$/.test(state)||state!==cookie(req,identityStateCookie))fail(401,'invalid_oauth_state');
  const saved=await one(env.DB,'DELETE FROM identity_login_states WHERE state_hash=? AND expires_at>? RETURNING nonce,verifier,return_path',await hash(state),now());
  if(!saved)fail(401,'invalid_oauth_state');
  const returnTo=safeReturnPath(saved.return_path,url.origin);
  if(url.searchParams.has('error'))return redirect(returnTo,flowCookie('',0));
  const code=url.searchParams.get('code');
  if(!code||!/^[A-Za-z0-9_-]{40,150}$/.test(code))fail(401,'login_failed');
  const form=new URLSearchParams({grant_type:'authorization_code',client_id:config.clientId,redirect_uri:config.redirectUri,code,code_verifier:saved.verifier});
  let response:Response;
  try{
    response=await fetch(config.issuer+'/oauth/token',{method:'POST',headers:{authorization:'Basic '+btoa(config.clientId+':'+config.clientSecret),
      'content-type':'application/x-www-form-urlencoded',accept:'application/json'},body:form.toString(),redirect:'manual',signal:AbortSignal.timeout(10000)});
  }catch{return fail(503,'identity_provider_unavailable');}
  const data=await response.json().catch(()=>null) as {id_token?:string,error?:string}|null;
  if(!response.ok){
    if(response.status===400&&data?.error==='invalid_grant')fail(401,'login_failed');
    if(response.status===403&&data?.error==='access_denied')fail(403,'account_unavailable');
    if(env.APP_ENV==='preview')fail(503,data?.error==='invalid_client'?'identity_client_rejected':`identity_exchange_http_${response.status}`);
    fail(503,'identity_provider_unavailable');
  }
  const claims=await verifyIdToken(data?.id_token,config.clientId,saved.nonce,[config.issuer],config.issuer+'/.well-known/jwks.json');
  if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(claims.sub)||
      typeof claims.spine_google_sub!=='string'||!/^[\x21-\x7e]{1,255}$/.test(claims.spine_google_sub))fail(401,'invalid_identity');
  const uid=await linkIdentity(env.DB,claims.sub,claims.spine_google_sub);
  const signedIn=await startSession(req,env.DB,uid,returnTo);
  signedIn.headers.append('set-cookie',flowCookie('',0));
  return signedIn;
}

export async function authRoute(req:Request,env:Env,user:Row|null,path:string):Promise<Response|null>{
  const url=new URL(req.url);
  if(req.method==='GET'&&(path==='/api/auth/identity'||path===identityCallback))return identityRoute(req,env,url);
  // The forum now accepts interactive sign-in exclusively via Identity Center.
  // Block both the legacy initiation endpoint and outstanding Google callbacks,
  // including requests from cached old clients, without token exchange or D1 writes.
  if(path==='/api/auth/google'||path==='/api/auth/callback')
    fail(410,'direct_google_login_disabled');
  if(path==='/api/auth/logout'&&req.method==='POST'){
    if(user)await stmt(env.DB,'UPDATE user_sessions SET revoked_at=? WHERE id=?',now(),user.session_id).run();
    return json({ok:true},200,{'set-cookie':sessionCookie(req,'',0)});
  }
  return null;
}
