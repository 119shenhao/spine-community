import {Env,Row,all,one,stmt,now,id,hash,b64,randomToken,cookie,fail,json,lang} from './core';
let jwks: {keys: (JsonWebKey & {kid:string})[],until:number}|null=null;
export async function verifyGoogle(token: string,clientId: string,nonce: string): Promise<Row> {
  const parts=token.split('.');if(parts.length!==3)fail(401,'invalid_identity');
  const decode=(s:string)=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
  let header: Row,payload: Row;try{header=JSON.parse(new TextDecoder().decode(decode(parts[0])));payload=JSON.parse(new TextDecoder().decode(decode(parts[1])));}catch{return fail(401,'invalid_identity');}
  if(header.alg!=='RS256'||!header.kid)fail(401,'invalid_identity');
  if(!jwks||jwks.until<now()||!jwks.keys.some(k=>k.kid===header.kid)){
    const r=await fetch('https://www.googleapis.com/oauth2/v3/certs');if(!r.ok)fail(503,'identity_provider_unavailable');
    const data=await r.json() as {keys:(JsonWebKey & {kid:string})[]};jwks={keys:data.keys,until:now()+1800};
  }
  const key=jwks.keys.find(k=>k.kid===header.kid);if(!key)fail(401,'invalid_identity');
  const cryptoKey=await crypto.subtle.importKey('jwk',key,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  if(!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',cryptoKey,decode(parts[2]),new TextEncoder().encode(parts[0]+'.'+parts[1])))fail(401,'invalid_identity');
  if(!['https://accounts.google.com','accounts.google.com'].includes(payload.iss)||payload.aud!==clientId||!Number.isFinite(payload.exp)||!Number.isFinite(payload.iat)||payload.exp<=now()||payload.iat>now()+60||payload.nonce!==nonce||typeof payload.sub!=='string'||payload.sub.length>255)fail(401,'invalid_identity');
  return payload;
}
const sessionCookie=(req:Request,value:string,age=2592000)=>`sc_session=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${age}${new URL(req.url).protocol==='https:'?'; Secure':''}`;
export async function login(req: Request,env: Env,subject: string,provider='google') {
  let identity=await one(env.DB,'SELECT user_id FROM auth_identities WHERE provider=? AND provider_subject=?',provider,subject);
  const uid=identity?.user_id||id();
  if(!identity){
    await env.DB.batch([
      stmt(env.DB,"INSERT INTO users(id,nickname) VALUES(?,?)",uid,'Member '+uid.slice(0,6)),
      stmt(env.DB,'INSERT INTO auth_identities(id,user_id,provider,provider_subject) VALUES(?,?,?,?)',id(),uid,provider,subject),
      stmt(env.DB,"INSERT INTO daily_community_metrics(day_utc,new_users) VALUES(date('now'),1) ON CONFLICT(day_utc) DO UPDATE SET new_users=new_users+1")
    ]);
  }
  const user=await one(env.DB,'SELECT status,is_system FROM users WHERE id=?',uid);if(user?.status!=='active'||user.is_system)fail(403,'account_unavailable');
  if(provider==='google'&&env.ADMIN_GOOGLE_SUB&&subject===env.ADMIN_GOOGLE_SUB){
    // Only an out-of-band secret can bootstrap ownership. Never trust a request role or email.
    await stmt(env.DB,"INSERT OR IGNORE INTO user_roles(user_id,role) VALUES(?,'admin')",uid).run();
  }
  const token=randomToken();await stmt(env.DB,'INSERT INTO user_sessions(id,user_id,token_hash,expires_at) VALUES(?,?,?,?)',id(),uid,await hash(token),now()+2592000).run();
  return new Response(null,{status:302,headers:{location:'/', 'set-cookie':sessionCookie(req,token),'cache-control':'no-store'}});
}
export async function authRoute(req:Request,env:Env,user:Row|null,path:string):Promise<Response|null>{
  const url=new URL(req.url);
  if(path==='/api/auth/google'&&req.method==='GET'){
    if(!env.GOOGLE_CLIENT_ID||!env.GOOGLE_CLIENT_SECRET)fail(503,'google_not_configured');
    const state=randomToken(),nonce=randomToken(),verifier=randomToken();
    await stmt(env.DB,'INSERT INTO auth_states VALUES(?,?,?,?)',await hash(state),nonce,verifier,now()+600).run();
    const challenge=b64(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))));
    const query=new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,redirect_uri:url.origin+'/api/auth/callback',response_type:'code',scope:'openid',state,nonce,code_challenge:challenge,code_challenge_method:'S256'});
    return new Response(null,{status:302,headers:{location:'https://accounts.google.com/o/oauth2/v2/auth?'+query,'cache-control':'no-store','set-cookie':`sc_oauth=${state}; HttpOnly; SameSite=Lax; Path=/api/auth; Max-Age=600${url.protocol==='https:'?'; Secure':''}`}});
  }
  if(path==='/api/auth/callback'&&req.method==='GET'){
    const state=url.searchParams.get('state');if(!state||state!==cookie(req,'sc_oauth'))fail(401,'invalid_oauth_state');
    const saved=await one(env.DB,'DELETE FROM auth_states WHERE state_hash=? AND expires_at>? RETURNING *',await hash(state),now());if(!saved||!env.GOOGLE_CLIENT_ID||!env.GOOGLE_CLIENT_SECRET)fail(401,'invalid_oauth_state');
    const code=url.searchParams.get('code');if(!code)fail(400,'login_cancelled');
    const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({code,client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,redirect_uri:url.origin+'/api/auth/callback',grant_type:'authorization_code',code_verifier:saved.verifier})});
    if(!r.ok)fail(401,'login_failed');const data=await r.json() as {id_token:string};
    const claims=await verifyGoogle(data.id_token,env.GOOGLE_CLIENT_ID,saved.nonce);
    return login(req,env,claims.sub);
  }
  if(path==='/api/auth/logout'&&req.method==='POST'){
    if(user)await stmt(env.DB,'UPDATE user_sessions SET revoked_at=? WHERE id=?',now(),user.session_id).run();
    return json({ok:true},200,{'set-cookie':sessionCookie(req,'',0)});
  }
  return null;
}
