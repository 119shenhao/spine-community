export interface Env {
  ASSETS: Fetcher; DB: D1Database; GOOGLE_CLIENT_ID?: string; GOOGLE_CLIENT_SECRET?: string;
  ADMIN_GOOGLE_SUB?: string; TRANSLATOR_KEY?: string; TRANSLATOR_REGION?: string;
  TRANSLATION_ENABLED?: string; TRANSLATION_DAILY_LIMIT?: string; TRANSLATION_MONTHLY_LIMIT?: string;
  ANALYTICS_SALT?: string; APP_ENV?: string; DEV_AUTH?: string;
  IMPORT_DB?: D1Database; IMPORT_ENABLED?: string;
  COLLECT_ENABLED?: string;
}
export type Row = Record<string, any>;
export const locales = ['en','zh-CN','zh-TW','es','pt-BR','de','fr','ja'];
export const now = () => Math.floor(Date.now()/1000);
export const id = () => crypto.randomUUID();
export class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
export function fail(status: number, message: string): never { throw new HttpError(status,message); }
export function json(data: unknown, status=200, headers: Record<string,string>={}) {
  return new Response(JSON.stringify(data), {status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',...headers}});
}
export const stmt = (db: D1Database, sql: string, ...args: any[]) => db.prepare(sql).bind(...args);
export const one = <T=Row>(db: D1Database, sql: string, ...args: any[]) => stmt(db,sql,...args).first<T>();
export async function all(db: D1Database, sql: string, ...args: any[]): Promise<Row[]> { return (await stmt(db,sql,...args).all<Row>()).results; }
export async function body(req: Request): Promise<Row> {
  if (!req.headers.get('content-type')?.includes('application/json')) fail(415,'json_required');
  const reader=req.body?.getReader(); if(!reader) fail(400,'invalid_json');
  let size=0,parts: Uint8Array[]=[];
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>150000){await reader.cancel();fail(413,'request_too_large');}parts.push(value);}
  try {const bytes=new Uint8Array(size);let n=0;for(const p of parts){bytes.set(p,n);n+=p.length;}const v=JSON.parse(new TextDecoder().decode(bytes));if(!v||Array.isArray(v)||typeof v!=='object')fail(400,'invalid_json');return v;} catch {return fail(400,'invalid_json');}
}
export function textField(value: unknown, min: number, max: number, field='body'): string {
  if(typeof value!=='string'||value.trim().length<min||value.trim().length>max)fail(400,`invalid_${field}`);return value.trim();
}
export const lang = (v: unknown) => typeof v==='string'&&/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(v)?v:'und';
export const cookie = (r: Request,n: string) => r.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(n+'='))?.slice(n.length+1)||'';
export async function hash(v: string) {return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v)))].map(x=>x.toString(16).padStart(2,'0')).join('');}
// A stable fingerprint for topic deduplication across import batches and D1 databases.
// Normalize only the fingerprint input; store the original text and language untouched.
export function normalizeTopicText(v:string):string {
  return v.normalize('NFKC').replace(/\s+/gu,' ').trim().toLowerCase();
}
export async function topicFingerprint(title:string,body:string):Promise<string> {
  return hash('spine-topic-v1\n'+normalizeTopicText(title)+'\n'+normalizeTopicText(body));
}
export const b64 = (s: Uint8Array) => btoa(String.fromCharCode(...s)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
export const randomToken = () => b64(crypto.getRandomValues(new Uint8Array(32)));
export function sameOrigin(req: Request) {
  const origin=req.headers.get('origin');
  if(origin!==new URL(req.url).origin||req.headers.get('sec-fetch-site')==='cross-site')fail(403,'invalid_origin');
}
export async function rate(db: D1Database,key: string,limit: number,seconds=60) {
  const bucket=Math.floor(now()/seconds);
  const r=await one(db,`INSERT INTO rate_limits(key,bucket,count,expires_at) VALUES(?,?,1,?) ON CONFLICT(key,bucket) DO UPDATE SET count=count+1 WHERE count<? RETURNING count`,key,bucket,(bucket+1)*seconds,limit);
  if(!r)fail(429,'rate_limit');
}
export async function currentUser(req: Request, env: Env): Promise<Row|null> {
  const token=cookie(req,'sc_session');if(!token)return null;
  const user=await one(env.DB,`SELECT u.*,s.id session_id FROM user_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND s.revoked_at IS NULL AND u.status='active' AND u.is_system=0`,await hash(token),now());
  if(!user)return null;
  const roles=await all(env.DB,'SELECT role FROM user_roles WHERE user_id=?',user.id);
  user.role=roles.some(r=>r.role==='admin')?'admin':roles.some(r=>r.role==='moderator')?'moderator':'member';return user;
}
export function requireUser(u: Row|null): Row {if(!u)fail(401,'login_required');return u;}
export function requireRole(u: Row|null,admin=false): Row {const user=requireUser(u);if(admin?user.role!=='admin':!['admin','moderator'].includes(user.role))fail(403,'forbidden');return user;}
export async function writable(db: D1Database,u: Row|null) {
  const user=requireUser(u);const active=await one(db,`SELECT sanction_type FROM user_sanctions WHERE user_id=? AND lifted_at IS NULL AND starts_at<=? AND (ends_at IS NULL OR ends_at>?) LIMIT 1`,user.id,now(),now());
  if(active)fail(403,active.sanction_type==='ban'?'account_banned':'account_muted');return user;
}
export function safeUser(u: Row|null) {return u?{id:u.id,nickname:u.nickname,preferred_locale:u.preferred_locale,public_region:u.public_region,role:u.role}:null;}
export function risk(title: string,body: string): string {const s=title+' '+body;const links=(s.match(/https?:\/\//g)||[]).length;if(links>8||/(?:buy now|guaranteed cure|miracle cure).{0,80}(?:https?:|whatsapp|telegram)/i.test(s))return 'blocked';if(links>2||/(?:promo code|discount code|contact.{0,12}whatsapp)/i.test(s))return 'pending_review';return 'published';}
export const metric = (db: D1Database,field: string) => stmt(db,`INSERT INTO daily_community_metrics(day_utc,${field}) VALUES(date('now'),1) ON CONFLICT(day_utc) DO UPDATE SET ${field}=${field}+1`);
