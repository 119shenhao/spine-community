import {Env,Row,all,body,fail,hash,id,json,lang,now,one,rate,risk,stmt,textField,topicFingerprint} from './core';
import {terms} from './content';
import {UNKNOWN_USER_ID,importEnabled} from './import';

// Dedicated collector endpoints have NO production HTTP write path.
// Preview-only collection is deliberately anonymous; per-claim lease tokens still
// prevent one collector from completing or releasing another collector's work.
const CLAIM_LEASE_SECONDS=6*60*60;
export function collectEnabled(req:Request,env:Env):boolean {
 return env.COLLECT_ENABLED==='true' && importEnabled(req,env);
}
function validSite(v:unknown):string {
 if(typeof v!=='string'||! /^(?:[a-z0-9][a-z0-9_-]{1,31})$/.test(v))fail(400,'invalid_site');
 return v;
}
function validSource(v:unknown,site:string):string {
 if(typeof v!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(v))fail(400,'invalid_source_id');
 if(site==='tieba'&&!/^[0-9]{1,20}$/.test(v))fail(400,'invalid_source_id');
 if(site==='reddit'&&!/^[a-z0-9]{1,15}$/.test(v))fail(400,'invalid_source_id');
 return v;
}
function plainObject(v:unknown,fields:string[]):Row{
 if(!v||typeof v!=='object'||Array.isArray(v))fail(400,'invalid_collection_payload');
 const o=v as Row;
 if(Object.keys(o).some(k=>!fields.includes(k)))fail(400,'unknown_collection_field');
 return o;
}
function list(v:unknown):unknown[]{
 if(v===undefined)return [];
 if(!Array.isArray(v))fail(400,'invalid_collection_list');
 return v;
}
function allowPreviewRequest(req:Request,env:Env) {
 if(!collectEnabled(req,env))fail(403,'collect_disabled');
 // No API key or cookie required. Production binding/host gating happens first.
 const origin=req.headers.get('origin');
 if((origin&&origin!==new URL(req.url).origin)||req.headers.get('sec-fetch-site')==='cross-site')fail(403,'invalid_origin');
}

type DraftComment={id:string,parent:string|null,body:string,source_lang:string,status:string};
async function parseTopic(env:Env,db:D1Database,value:unknown){
 const t=plainObject(value,['title','body','source_lang','terms','symptom_duration_days','comments']);
 const title=textField(t.title,1,200,'title'),content=textField(t.body,1,30000),source_lang=lang(t.source_lang);
 const duration=t.symptom_duration_days??null;
 if(duration!==null&&(!Number.isInteger(duration)||duration<0||duration>36500))fail(400,'invalid_duration');
 const tags=await terms({...env,DB:db},t.terms);
 const comments:DraftComment[]=[];
 function comment(raw:unknown,parent:string|null,depth:number){
  if(depth>8)fail(400,'reply_depth_exceeded');
  if(comments.length>=49)fail(400,'too_many_items');
  const c=plainObject(raw,['body','source_lang','replies']);
  const body=textField(c.body,1,12000);
  const commentId=id();
  comments.push({id:commentId,parent,body,source_lang:lang(c.source_lang),status:risk('',body)});
  for(const child of list(c.replies))comment(child,commentId,depth+1);
 }
 for(const c of list(t.comments))comment(c,null,1);
 return {title,body:content,source_lang,duration,tags,comments,status:risk(title,content),contentHash:await topicFingerprint(title,content)};
}
async function exactTopic(db:D1Database,title:string,content:string,fp:string){
 const matches=await all(db,'SELECT id,status FROM topics WHERE content_hash=? OR (title=? AND body=?) LIMIT 2',fp,title,content);
 if(matches.length>1)fail(409,'ambiguous_existing_content');
 return matches[0]||null;
}
const claimRow=(db:D1Database,site:string,sourceId:string)=>one(db,'SELECT state,collector_id,lease_token_hash,lease_expires_at,completion_token_hash,topic_id,content_hash,completed_duplicate FROM collect_sources WHERE site=? AND source_id=?',site,sourceId);
function claimValid(row:Row|null,leaseHash:string){
 return Boolean(row&&row.state==='claimed'&&row.lease_token_hash===leaseHash&&row.lease_expires_at>now());
}
async function ensureAccount(db:D1Database){
 const row=await one(db,'SELECT is_system,status FROM users WHERE id=?',UNKNOWN_USER_ID);
 if(!row||row.is_system!==1||row.status!=='active')fail(503,'import_account_unavailable');
}
async function finalize(db:D1Database,site:string,sourceId:string,leaseHash:string,topicId:string,fp:string,duplicate:boolean,
 writes:D1PreparedStatement[],newTopicCount:number,commentCount:number){
 const timestamp=now();
 const prefix=stmt(db,'INSERT INTO collect_finalize_guard(site,source_id,lease_token_hash) VALUES(?,?,?)',site,sourceId,leaseHash);
 const update=stmt(db,`UPDATE collect_sources
 SET state='completed',lease_token_hash=NULL,lease_expires_at=NULL,completion_token_hash=?,
 topic_id=?,content_hash=?,completed_duplicate=?,completed_at=?,updated_at=?
 WHERE site=? AND source_id=? AND state='claimed' AND lease_token_hash=?`,
 leaseHash,topicId,fp,duplicate?1:0,timestamp,timestamp,site,sourceId,leaseHash);
 const cleanup=stmt(db,'DELETE FROM collect_finalize_guard WHERE site=? AND source_id=?',site,sourceId);
 const statements=[prefix,...writes,update,cleanup];
 if(newTopicCount||commentCount)statements.push(stmt(db,`INSERT INTO daily_community_metrics(day_utc,new_topics,new_comments) VALUES(date('now'),?,?)
 ON CONFLICT(day_utc) DO UPDATE SET new_topics=new_topics+excluded.new_topics,new_comments=new_comments+excluded.new_comments`,newTopicCount,commentCount));
 await db.batch(statements);
}
function finished(row:Row,fp:string,leaseHash:string){
 if(row.completion_token_hash!==leaseHash)fail(409,'already_collected');
 if(row.content_hash!==fp)fail(409,'completion_payload_mismatch');
 return json({status:'completed',already_completed:true,duplicate:Boolean(row.completed_duplicate),topic_id:row.topic_id,imported:{topics:0,comments:0}});
}
export async function collectRoute(req:Request,env:Env,path:string):Promise<Response>{
 // Preview-only environment gating happens BEFORE touching either database.
 allowPreviewRequest(req,env);
 if(!['/api/collect/exclusions','/api/collect/claim','/api/collect/complete','/api/collect/release','/api/collect/queue'].includes(path))fail(404,'not_found');
 const db=env.IMPORT_DB!;
 if(path==='/api/collect/queue'){
  if(req.method==='GET'){
   const url=new URL(req.url),site=validSite(url.searchParams.get('site'));
   await rate(db,'collect:queue:read',240);
   const rows=await all(db,`SELECT source_id,url,status,reason,attempts,retry_at FROM collector_candidates
     WHERE site=? AND (status='pending' OR (status='retry' AND retry_at<=unixepoch()) OR (status='processing' AND lease_until<=unixepoch()))
     ORDER BY updated_at,source_id LIMIT 120`,site);
   return json({site,items:rows});
  }
  if(req.method!=='POST')fail(405,'method_not_allowed');
  const b=plainObject(await body(req),['site','action','items']);
  const site=validSite(b.site),action=textField(b.action,1,20,'action');
  await rate(db,'collect:queue:write',90);
  const items=list(b.items);
  if(!items.length||items.length>30)fail(400,'invalid_queue_batch');
  if(action==='enqueue'){
   const statements=items.map(raw=>{
    const row=plainObject(raw,['source_id','url']),sourceId=validSource(row.source_id,site);
    const url=textField(row.url,10,300,'url');
    const parsed=new URL(url);
    const hosts:Record<string,string>={ '120ask':'www.120ask.com','ask39':'ask.39.net',xywy:'club.xywy.com',patientinfo:'patient.info',healthunlocked:'healthunlocked.com',mayoclinic:'connect.mayoclinic.org',smoke:'ask.39.net'};
    if(parsed.protocol!=='https:'||(parsed.hostname!==hosts[site]&&!(site==='patientinfo'&&parsed.hostname==='community.patient.info'))||parsed.username||parsed.password||parsed.port||parsed.hash||parsed.search)fail(400,'invalid_source_url');
    if(site!=='smoke'){
     const patterns:Record<string,RegExp>={
       '120ask':new RegExp('^/question/([0-9]{1,20})[.]htm$'),
       ask39:new RegExp('^/question/([A-Za-z0-9_-]{1,40})[.]html$'),
       xywy:new RegExp('^/wenda/([0-9]{1,20})[.]htm$'),
       patientinfo:new RegExp('^/forums/discuss/[a-z0-9-]+-([0-9]{1,20})/?$'),
       healthunlocked:new RegExp('^/[a-z0-9-]+/posts/([0-9]{1,20})(?:/[a-z0-9-]+)?/?$'),
       mayoclinic:new RegExp('^/discussion/([a-z0-9-]{1,100})/?$')
     };
     const modern=site==='patientinfo'&&parsed.hostname==='community.patient.info';
     const matched=modern?parsed.pathname.match(/^\/t\/[a-z0-9-]+\/([0-9]{1,20})\/?$/):parsed.pathname.match(patterns[site]);
     if(!matched||matched[1]!==sourceId)fail(400,'source_url_mismatch');
    }
    return stmt(db,`INSERT INTO collector_candidates(site,source_id,url,status) VALUES(?,?,?,'pending')
      ON CONFLICT(site,source_id) DO NOTHING`,site,sourceId,url);
   });
   await db.batch(statements);
   return json({status:'queued',count:items.length});
  }
  if(action==='mark'){
   const statements=items.map(raw=>{
    const row=plainObject(raw,['source_id','status','reason']),sourceId=validSource(row.source_id,site);
    const status=textField(row.status,1,20,'status');
    if(!['completed','rejected','retry'].includes(status))fail(400,'invalid_queue_status');
    const reason=row.reason===undefined?null:textField(row.reason,1,80,'reason');
    return stmt(db,`UPDATE collector_candidates SET status=?,reason=?,attempts=attempts+1,
      retry_at=CASE WHEN ?='retry' THEN unixepoch()+MIN(86400,300*(attempts+1)*(attempts+1)) ELSE 0 END,
      updated_at=unixepoch() WHERE site=? AND source_id=? AND status<>'completed' AND (?<>'completed' OR EXISTS(SELECT 1 FROM collect_sources WHERE collect_sources.site=collector_candidates.site AND collect_sources.source_id=collector_candidates.source_id AND state='completed'))`,status,reason,status,site,sourceId,status);
   });
   await db.batch(statements);
   return json({status:'marked',count:items.length});
  }
  fail(400,'invalid_queue_action');
 }
 if(path==='/api/collect/exclusions'){
  if(req.method!=='GET')fail(405,'method_not_allowed');
  const url=new URL(req.url),site=validSite(url.searchParams.get('site'));
  const cursor=url.searchParams.get('cursor')||'';
  if(cursor)validSource(cursor,site);
  const rawLimit=url.searchParams.get('limit')||'200',limit=Number(rawLimit);
  if(!/^[0-9]+$/.test(rawLimit)||!Number.isInteger(limit)||limit<1||limit>500)fail(400,'invalid_limit');
  await rate(db,'collect:list',90);
  const stamp=now();
  const rows=await all(db,`SELECT source_id,state,lease_expires_at FROM collect_sources
   WHERE site=? AND source_id>? AND (state='completed' OR (state='claimed' AND lease_expires_at>?))
   ORDER BY source_id LIMIT ?`,site,cursor,stamp,limit+1);
  const page=rows.slice(0,limit);
  return json({site,as_of:stamp,items:page.map(r=>({source_id:r.source_id,status:r.state,lease_expires_at:r.state==='claimed'?r.lease_expires_at:null})),
   next_cursor:rows.length>limit?page.at(-1)!.source_id:null});
 }
 if(req.method!=='POST')fail(405,'method_not_allowed');
 const input=await body(req);
 if(path==='/api/collect/claim'){
  const b=plainObject(input,['site','source_ids','collector_id']);
  const site=validSite(b.site);
  const collector=textField(b.collector_id,1,40,'collector_id');
  if(!/^[A-Za-z0-9_-]+$/.test(collector))fail(400,'invalid_collector_id');
  const sources=list(b.source_ids);
  if(sources.length<1||sources.length>30)fail(400,'invalid_claim_batch_size');
  const sourceIds=sources.map(v=>validSource(v,site));
  if(new Set(sourceIds).size!==sourceIds.length)fail(400,'duplicate_source_id');
  await rate(db,'collect:claim',40);
  const results=[];
  for(const sourceId of sourceIds){
   const secret=crypto.randomUUID()+'-'+crypto.randomUUID();
   const secretHash=await hash(secret),timestamp=now(),expiry=timestamp+CLAIM_LEASE_SECONDS;
   // One conditional UPSERT is the lock: two concurrent collectors cannot both win.
   const claimed=await one(db,`INSERT INTO collect_sources(site,source_id,state,collector_id,lease_token_hash,lease_expires_at,claimed_at,updated_at)
     VALUES(?,?,'claimed',?,?,?, ?,?)
     ON CONFLICT(site,source_id) DO UPDATE SET
       state='claimed',collector_id=excluded.collector_id,lease_token_hash=excluded.lease_token_hash,
       lease_expires_at=excluded.lease_expires_at,claimed_at=excluded.claimed_at,updated_at=excluded.updated_at,
       completion_token_hash=NULL,topic_id=NULL,content_hash=NULL,completed_duplicate=0,completed_at=NULL
     WHERE collect_sources.state='released' OR (collect_sources.state='claimed' AND collect_sources.lease_expires_at<=excluded.claimed_at)
     RETURNING state,lease_expires_at`,site,sourceId,collector,secretHash,expiry,timestamp,timestamp);
   if(claimed)results.push({source_id:sourceId,result:'granted',lease_token:secret,lease_expires_at:claimed.lease_expires_at});
   else{
    const row=await claimRow(db,site,sourceId);
    results.push({source_id:sourceId,result:row?.state==='completed'?'completed':'in_progress',
     lease_expires_at:row?.state==='claimed'?row.lease_expires_at:null});
   }
  }
  return json({site,lease_seconds:CLAIM_LEASE_SECONDS,results});
 }
 if(path==='/api/collect/release'){
  const b=plainObject(input,['site','source_id','lease_token']);
  const site=validSite(b.site),sourceId=validSource(b.source_id,site);
  const token=textField(b.lease_token,32,128,'lease_token'),tokenHash=await hash(token);
  await rate(db,'collect:release',90);
  const result=await one(db,`UPDATE collect_sources SET state='released',
   collector_id=NULL,lease_token_hash=NULL,lease_expires_at=NULL,updated_at=?
   WHERE site=? AND source_id=? AND state='claimed' AND lease_token_hash=? AND lease_expires_at>?
   RETURNING state`,now(),site,sourceId,tokenHash,now());
  if(!result)fail(409,'claim_not_owned_or_expired');
  return json({site,source_id:sourceId,status:'released'});
 }
 const b=plainObject(input,['site','source_id','lease_token','topic']);
 const site=validSite(b.site),sourceId=validSource(b.source_id,site);
 const token=textField(b.lease_token,32,128,'lease_token'),leaseHash=await hash(token);
 await rate(db,'collect:complete',90);
 const draft=await parseTopic(env,db,b.topic);
 const row=await claimRow(db,site,sourceId);
 if(row?.state==='completed')return finished(row,draft.contentHash,leaseHash);
 if(!claimValid(row,leaseHash))fail(409,'claim_not_owned_or_expired');
 await ensureAccount(db);
 const {title,body:content,source_lang,duration,tags,comments,status,contentHash:fp}=draft;
 const markExisting=async(existing:Row)=>{
  await finalize(db,site,sourceId,leaseHash,existing.id,fp,true,[],0,0);
  return json({site,source_id:sourceId,status:'completed',duplicate:true,topic_id:existing.id,imported:{topics:0,comments:0}});
 };
 const duplicate=await exactTopic(db,title,content,fp);
 if(duplicate){
  try{return await markExisting(duplicate);}catch(e){
   const latest=await claimRow(db,site,sourceId);
   if(latest?.state==='completed')return finished(latest,fp,leaseHash);
   if(!claimValid(latest,leaseHash))fail(409,'claim_not_owned_or_expired');
   throw e;
  }
 }
 const topicId=id();
 const writes:D1PreparedStatement[]=[
  stmt(db,`INSERT INTO topics(id,author_id,title,body,source_lang,status,symptom_duration_days,content_hash)
   VALUES(?,?,?,?,?,?,?,?)`,topicId,UNKNOWN_USER_ID,title,content,source_lang,status,duration,fp)
 ];
 for(const tag of tags)writes.push(stmt(db,'INSERT INTO topic_terms(topic_id,term_id) VALUES(?,?)',topicId,tag));
 for(const c of comments)writes.push(stmt(db,`INSERT INTO comments(id,topic_id,author_id,parent_comment_id,kind,body,source_lang,status)
  VALUES(?,?,?,?,'regular',?,?,?)`,c.id,topicId,UNKNOWN_USER_ID,c.parent,c.body,c.source_lang,c.status));
 try{
  await finalize(db,site,sourceId,leaseHash,topicId,fp,false,writes,1,comments.length);
 }catch(e){
  const latest=await claimRow(db,site,sourceId);
  if(latest?.state==='completed')return finished(latest,fp,leaseHash);
  if(!claimValid(latest,leaseHash))fail(409,'claim_not_owned_or_expired');
  // Another source might have inserted identical content concurrently.
  const appeared=await exactTopic(db,title,content,fp);
  if(appeared)return markExisting(appeared);
  throw e;
 }
 return json({site,source_id:sourceId,status:'completed',duplicate:false,topic_id:topicId,topic_status:status,
  imported:{topics:1,comments:comments.length}},201);
}
