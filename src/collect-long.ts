import {Env,Row,body,fail,hash,id,json,now,one,rate,risk,stmt,textField,topicFingerprint} from './core';
import {UNKNOWN_USER_ID} from './import';

// Preview-only Mayo long-thread staging. Each page is a small transaction.
// The final forum topic and all replies are published in ONE D1 batch.
const MAX_PAGES=400;
const MAX_PAGE_COMMENTS=30;
const CLAIM_LEASE_SECONDS=6*60*60;

function shape(value:unknown,fields:string[]):Row {
 if(!value||typeof value!=='object'||Array.isArray(value))fail(400,'invalid_long_payload');
 const data=value as Row;
 if(Object.keys(data).some(x=>!fields.includes(x)))fail(400,'invalid_long_fields');
 return data;
}
function mayoId(value:unknown):string {
 if(typeof value!=='string'||! /^[a-z0-9-]{1,100}$/.test(value))fail(400,'invalid_mayo_id');
 return value;
}
async function isClaimed(db:D1Database,sourceId:string,tokenHash:string) {
 const claim=await one(db,`SELECT state,lease_token_hash,lease_expires_at,completion_token_hash,topic_id
  FROM collect_sources WHERE site='mayoclinic' AND source_id=?`,sourceId);
 if(claim?.state==='completed'&&claim.completion_token_hash===tokenHash)return claim;
 if(claim?.state!=='claimed'||claim.lease_token_hash!==tokenHash||claim.lease_expires_at<=now())
   fail(409,'claim_not_owned_or_expired');
 return claim;
}
function guard(db:D1Database,sourceId:string,tokenHash:string) {
 return stmt(db,`INSERT INTO collect_finalize_guard(site,source_id,lease_token_hash) VALUES('mayoclinic',?,?)`,sourceId,tokenHash);
}
function unguard(db:D1Database,sourceId:string){
 return stmt(db,`DELETE FROM collect_finalize_guard WHERE site='mayoclinic' AND source_id=?`,sourceId);
}
async function staging(db:D1Database,sourceId:string) {
 return one(db,`SELECT expected_pages,title,body,source_lang,content_hash
 FROM collector_mayo_stage WHERE source_id=?`,sourceId);
}
async function existingTopic(db:D1Database,title:string,content:string,fp:string){
 const rows=(await stmt(db,'SELECT id FROM topics WHERE content_hash=? OR (title=? AND body=?) LIMIT 2',fp,title,content).all<Row>()).results;
 if(rows.length>1)fail(409,'ambiguous_existing_content');
 return rows[0]||null;
}
async function successful(db:D1Database,sourceId:string,topicId:string,duplicate:boolean,created:boolean,count:number) {
 const persisted=await one(db,'SELECT COUNT(*) total FROM comments WHERE topic_id=?',topicId);
 if(!duplicate&&persisted?.total!==count)fail(503,'long_readback_mismatch');
 return json({site:'mayoclinic',source_id:sourceId,status:'completed',duplicate,topic_id:topicId,
   imported:{topics:created?1:0,comments:created?count:0},persisted_comments:persisted?.total||0});
}
export async function collectLongRoute(req:Request,env:Env,path:string):Promise<Response> {
 if(req.method!=='POST')fail(405,'method_not_allowed');
 if(!['/api/collect/long/start','/api/collect/long/status','/api/collect/long/page','/api/collect/long/finish'].includes(path))
  fail(404,'not_found');
 const db=env.IMPORT_DB!;
 await rate(db,'collect:mayo:long',240);
 const raw=shape(await body(req),['site','source_id','lease_token','expected_pages','title','body','source_lang','page_number','comments']);
 if(raw.site!=='mayoclinic')fail(400,'mayo_only');
 const sourceId=mayoId(raw.source_id);
 const lease=textField(raw.lease_token,32,128,'lease_token');
 const tokenHash=await hash(lease);
 const claim=await isClaimed(db,sourceId,tokenHash);
 if(claim.state==='completed'){
  if(path==='/api/collect/long/finish')return successful(db,sourceId,claim.topic_id,true,false,0);
  fail(409,'already_collected');
 }
 if(path==='/api/collect/long/start'){
  const expected=raw.expected_pages;
  if(!Number.isInteger(expected)||expected<1||expected>MAX_PAGES)fail(400,'invalid_mayo_page_count');
  const title=textField(raw.title,1,200,'title'),content=textField(raw.body,1,30000);
  if(raw.source_lang!=='en')fail(400,'mayo_source_language');
  const fp=await topicFingerprint(title,content);
  const prior=await staging(db,sourceId);
  if(prior){
   if(prior.expected_pages!==expected||prior.title!==title||prior.body!==content||prior.source_lang!=='en'||prior.content_hash!==fp)
    fail(409,'staged_source_changed');
   return json({status:'staging',already_started:true,expected_pages:expected});
  }
  await db.batch([guard(db,sourceId,tokenHash),
   stmt(db,`INSERT INTO collector_mayo_stage(source_id,expected_pages,title,body,source_lang,content_hash)
     VALUES(?,?,?,?,?,?)`,sourceId,expected,title,content,'en',fp),unguard(db,sourceId)]);
  return json({status:'staging',already_started:false,expected_pages:expected});
 }
 const stage=await staging(db,sourceId);
 if(!stage)fail(409,'mayo_stage_not_started');
 if(path==='/api/collect/long/status'){
  const pages=(await stmt(db,'SELECT page_number,comment_count FROM collector_mayo_pages WHERE source_id=? ORDER BY page_number',sourceId).all<Row>()).results;
  return json({status:'staging',expected_pages:stage.expected_pages,pages,
    saved_replies:pages.reduce((n,p)=>n+p.comment_count,0)});
 }
 if(path==='/api/collect/long/page'){
  const pageNo=raw.page_number,comments=raw.comments;
  if(!Number.isInteger(pageNo)||pageNo<1||pageNo>stage.expected_pages)fail(400,'invalid_mayo_page_number');
  if(!Array.isArray(comments)||comments.length<1||comments.length>MAX_PAGE_COMMENTS)
   fail(400,'invalid_mayo_page_items');
  const parsed:{source:string;parent:string|null;content:string;commentId:string;status:string}[]=[];
  const ids=new Set<string>();
  for(const entry of comments){
   const c=shape(entry,['source_comment_id','parent_source_comment_id','body','source_lang']);
   const external=String(c.source_comment_id);
   if(!/^[0-9]{1,20}$/.test(external)||ids.has(external))fail(400,'invalid_or_duplicate_comment_id');
   const parent=c.parent_source_comment_id;
   if(parent!==null&&parent!==undefined&&!(typeof parent==='string'&&/^[0-9]{1,20}$/.test(parent)))
     fail(400,'invalid_mayo_comment_parent');
   if(c.source_lang!=='en')fail(400,'invalid_mayo_comment_language');
   const content=textField(c.body,1,12000,'reply');
   ids.add(external);
   parsed.push({source:external,parent:parent??null,content,commentId:id(),status:risk('',content)});
  }
  const digest=await hash(JSON.stringify(comments));
  const previous=await one(db,'SELECT content_hash,comment_count FROM collector_mayo_pages WHERE source_id=? AND page_number=?',sourceId,pageNo);
  if(previous){
   if(previous.content_hash!==digest||previous.comment_count!==comments.length)fail(409,'mayo_page_changed');
   return json({status:'page_saved',already_saved:true,page_number:pageNo,saved_comments:comments.length});
  }
  const writes=[guard(db,sourceId,tokenHash),
   stmt(db,'INSERT INTO collector_mayo_pages(source_id,page_number,content_hash,comment_count) VALUES(?,?,?,?)',sourceId,pageNo,digest,parsed.length),
   ...parsed.map((c,i)=>stmt(db,`INSERT INTO collector_mayo_comments
     (source_id,source_comment_id,comment_id,parent_source_comment_id,page_number,position,body,source_lang,status)
     VALUES(?,?,?,?,?,?,?,?,?)`,sourceId,c.source,c.commentId,c.parent,pageNo,i+1,c.content,'en',c.status)),
   unguard(db,sourceId)];
  await db.batch(writes);
  return json({status:'page_saved',already_saved:false,page_number:pageNo,saved_comments:parsed.length});
 }
 // Complete only when every page and every original reply parent is present.
 const state=(await one(db,`SELECT (SELECT COUNT(*) FROM collector_mayo_pages WHERE source_id=?) pages,
  (SELECT COUNT(*) FROM collector_mayo_comments WHERE source_id=?) replies,
  (SELECT COALESCE(SUM(comment_count),0) FROM collector_mayo_pages WHERE source_id=?) page_replies`,
  sourceId,sourceId,sourceId))!;
 if(state.pages!==stage.expected_pages||state.replies!==state.page_replies||state.replies<1)
  fail(409,'mayo_staging_incomplete');
 const wrongParent=await one(db,`SELECT sc.source_comment_id
  FROM collector_mayo_comments sc LEFT JOIN collector_mayo_comments parent
   ON parent.source_id=sc.source_id AND parent.source_comment_id=sc.parent_source_comment_id
  WHERE sc.source_id=? AND sc.parent_source_comment_id IS NOT NULL
    AND (parent.source_comment_id IS NULL OR
      parent.page_number*100+parent.position>=sc.page_number*100+sc.position)
  LIMIT 1`,sourceId);
 if(wrongParent)fail(409,'mayo_missing_or_forward_parent');
 const unknown=await one(db,'SELECT is_system,status FROM users WHERE id=?',UNKNOWN_USER_ID);
 if(!unknown||unknown.is_system!==1||unknown.status!=='active')fail(503,'import_account_unavailable');
 const stable=stage;
 const fp=stable.content_hash,topicId=id();
 let duplicate=await existingTopic(db,stable.title,stable.body,fp);
 async function commit(existing:Row|null){
  const chosen=existing?.id||topicId,duplicate=Boolean(existing);
  const writes:D1PreparedStatement[]=[guard(db,sourceId,tokenHash)];
  if(!existing){
   writes.push(stmt(db,`INSERT INTO topics(id,author_id,title,body,source_lang,status,content_hash)
     VALUES(?,?,?,?,?,?,?)`,topicId,UNKNOWN_USER_ID,stable.title,stable.body,'en',risk(stable.title,stable.body),fp));
   // A single SQL statement inserts the entire verified reply tree from private
   // staging. Parent references are stable UUIDs, never temporary positions.
   writes.push(stmt(db,`INSERT INTO comments
     (id,topic_id,author_id,parent_comment_id,kind,body,source_lang,status)
     SELECT sc.comment_id,?,?,
       (SELECT p.comment_id FROM collector_mayo_comments p
        WHERE p.source_id=sc.source_id AND p.source_comment_id=sc.parent_source_comment_id),
       'regular',sc.body,'en',sc.status
     FROM collector_mayo_comments sc WHERE sc.source_id=?
     ORDER BY sc.page_number,sc.position`,topicId,UNKNOWN_USER_ID,sourceId));
   writes.push(stmt(db,'INSERT INTO collector_mayo_publish_guard(source_id,topic_id) VALUES(?,?)',sourceId,topicId));
   writes.push(stmt(db,'DELETE FROM collector_mayo_publish_guard WHERE source_id=?',sourceId));
  }
  const stamp=now();
  writes.push(stmt(db,`UPDATE collect_sources
   SET state='completed',lease_token_hash=NULL,lease_expires_at=NULL,
   completion_token_hash=?,topic_id=?,content_hash=?,completed_duplicate=?,completed_at=?,updated_at=?
   WHERE site='mayoclinic' AND source_id=? AND state='claimed' AND lease_token_hash=?`,
   tokenHash,chosen,fp,duplicate?1:0,stamp,stamp,sourceId,tokenHash));
  writes.push(stmt(db,'DELETE FROM collector_mayo_stage WHERE source_id=?',sourceId));
  writes.push(unguard(db,sourceId));
  if(!duplicate)writes.push(stmt(db,`INSERT INTO daily_community_metrics(day_utc,new_topics,new_comments)
    VALUES(date('now'),1,?) ON CONFLICT(day_utc) DO UPDATE SET
    new_topics=new_topics+1,new_comments=new_comments+excluded.new_comments`,state.replies));
  await db.batch(writes);
  return successful(db,sourceId,chosen,duplicate,!duplicate,state.replies);
 }
 try{return await commit(duplicate);}catch(error){
  const last=await one(db,'SELECT state,completion_token_hash,topic_id,completed_duplicate FROM collect_sources WHERE site=? AND source_id=?','mayoclinic',sourceId);
  if(last?.state==='completed'&&last.completion_token_hash===tokenHash)
   return successful(db,sourceId,last.topic_id,Boolean(last.completed_duplicate),false,0);
  if(!duplicate){
   duplicate=await existingTopic(db,stage.title,stage.body,fp);
   if(duplicate)return commit(duplicate);
  }
  throw error;
 }
}
