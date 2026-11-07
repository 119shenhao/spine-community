import {Env,Row,body,textField,lang,one,stmt,id,fail,json,hash,rate,risk,now,topicFingerprint} from './core';
import {terms} from './content';

export const UNKNOWN_USER_ID='system-unknown-import';
const PREVIEW_ORIGIN='https://feature-v1-community-build-20261106-spine-community.119shenhao.workers.dev';

// This route never falls back to DB, whose top-level binding points at production.
export function importEnabled(req:Request,env:Env):boolean {
 const url=new URL(req.url);
 return env.IMPORT_ENABLED==='true'&&Boolean(env.IMPORT_DB)&&(
  (env.APP_ENV==='preview'&&url.origin===PREVIEW_ORIGIN)||
  (env.APP_ENV==='local'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname))
 );
}
function object(value:unknown,allowed:string[]):Row {
 if(!value||typeof value!=='object'||Array.isArray(value))fail(400,'invalid_import_item');
 const item=value as Row;
 if(Object.keys(item).some(k=>!allowed.includes(k)))fail(400,'unknown_import_field');
 return item;
}
function array(value:unknown):unknown[] {
 if(value===undefined)return [];
 if(!Array.isArray(value))fail(400,'invalid_import_list');
 return value;
}
function canonical(value:any):string {
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
 return JSON.stringify(value);
}
type Result={path:string,type:'topic'|'comment',id:string,topic_id:string,parent_comment_id?:string|null,status:string,skipped?:boolean};

export async function importRoute(req:Request,env:Env,path:string):Promise<Response> {
 // Deny before reading the body, checking sessions, or performing ANY database query/write.
 if(!importEnabled(req,env))fail(403,'import_disabled');
 const db=env.IMPORT_DB!;
 if(!['/api/import/account','/api/import/topics','/api/import/comments','/api/import/batch'].includes(path))fail(404,'not_found');
 const account=async()=>{
  const user=await one(db,'SELECT id,nickname,is_system,status FROM users WHERE id=?',UNKNOWN_USER_ID);
  if(!user?.is_system||user.status!=='active')fail(503,'import_account_unavailable');
  return {id:user.id,nickname:user.nickname,canLogin:false};
 };
 if(path==='/api/import/account'){
  if(req.method!=='GET')fail(405,'method_not_allowed');
  return json({account:await account()});
 }
 if(req.method!=='POST')fail(405,'method_not_allowed');
 // Command-line clients need neither a cookie nor an Origin header. Browser cross-origin writes are rejected.
 const origin=req.headers.get('origin');
 if((origin&&origin!==new URL(req.url).origin)||req.headers.get('sec-fetch-site')==='cross-site')fail(403,'invalid_origin');
 const input=await body(req),requestHash=await hash(path+'\n'+canonical(input));
 const replay=async()=>{
  const saved=await one(db,'SELECT result_json FROM import_batches WHERE request_hash=?',requestHash);
  return saved?json({...JSON.parse(saved.result_json),replayed:true}):null;
 };
 const author=await account();
 const prior=await replay();if(prior)return prior;
 await rate(db,'import:requests',30);
 const sanction=await one(db,'SELECT 1 FROM user_sanctions WHERE user_id=? AND lifted_at IS NULL AND starts_at<=? AND (ends_at IS NULL OR ends_at>?)',UNKNOWN_USER_ID,now(),now());
 if(sanction)fail(403,'import_account_sanctioned');
 let topicInputs:unknown[]=[],commentInputs:unknown[]=[];
 if(path==='/api/import/topics')topicInputs=[input];
 else if(path==='/api/import/comments')commentInputs=[input];
 else {
  object(input,['topics','comments']);
  topicInputs=array(input.topics);commentInputs=array(input.comments);
 }
 if(topicInputs.length>10)fail(400,'too_many_topics');
 if(!topicInputs.length&&!commentInputs.length)fail(400,'empty_import');
 const writes:D1PreparedStatement[]=[],results:Result[]=[];
 const seenTopics=new Map<string,{id:string,status:string}>();
 const push=(result:Result)=>{if(results.length>=50)fail(400,'too_many_items');results.push(result);};
 const importEnv={...env,DB:db};
 const addReply=async(raw:unknown,topicId:string,parent:string|null,path:string,depth:number,standalone=false):Promise<void>=>{
  if(depth>8)fail(400,'reply_depth_exceeded');
  const r=object(raw,standalone?['topic_id','parent_comment_id','body','source_lang','replies']:['body','source_lang','replies']);
  const text=textField(r.body,1,12000),commentId=id(),status=risk('',text);
  push({path,type:'comment',id:commentId,topic_id:topicId,parent_comment_id:parent,status});
  writes.push(stmt(db,"INSERT INTO comments(id,topic_id,author_id,parent_comment_id,kind,body,source_lang,status) VALUES(?,?,?,?,'regular',?,?,?)",commentId,topicId,UNKNOWN_USER_ID,parent,text,lang(r.source_lang),status));
  const children=array(r.replies);
  for(let i=0;i<children.length;i++)await addReply(children[i],topicId,commentId,`${path}.replies[${i}]`,depth+1);
 };
 for(let i=0;i<topicInputs.length;i++){
  const t=object(topicInputs[i],['title','body','source_lang','terms','symptom_duration_days','comments']);
  const title=textField(t.title,1,200,'title'),text=textField(t.body,1,30000),tags=await terms(importEnv,t.terms);
  const duration=t.symptom_duration_days??null;
  if(duration!==null&&(!Number.isInteger(duration)||duration<0||duration>36500))fail(400,'invalid_duration');
  const contentHash=await topicFingerprint(title,text);
  const existing=seenTopics.get(contentHash)||await one<{id:string,status:string}>(db,'SELECT id,status FROM topics WHERE content_hash=? OR (title=? AND body=?) LIMIT 1',contentHash,title,text);
  if(existing){
   // The whole thread is skipped, including any newly supplied replies.
   push({path:`topics[${i}]`,type:'topic',id:existing.id,topic_id:existing.id,status:existing.status,skipped:true});
   seenTopics.set(contentHash,existing);
   continue;
  }
  const topicId=id(),status=risk(title,text);
  seenTopics.set(contentHash,{id:topicId,status});
  push({path:`topics[${i}]`,type:'topic',id:topicId,topic_id:topicId,status});
  writes.push(stmt(db,'INSERT INTO topics(id,author_id,title,body,source_lang,status,symptom_duration_days,content_hash) VALUES(?,?,?,?,?,?,?,?)',topicId,UNKNOWN_USER_ID,title,text,lang(t.source_lang),status,duration,contentHash));
  for(const tag of tags)writes.push(stmt(db,'INSERT INTO topic_terms(topic_id,term_id) VALUES(?,?)',topicId,tag));
  const replies=array(t.comments);
  for(let j=0;j<replies.length;j++)await addReply(replies[j],topicId,null,`topics[${i}].comments[${j}]`,1);
 }
 for(let i=0;i<commentInputs.length;i++){
  const c=object(commentInputs[i],['topic_id','parent_comment_id','body','source_lang','replies']);
  const topicId=textField(c.topic_id,1,100,'topic_id');
  const topic=await one(db,"SELECT id FROM topics WHERE id=? AND status='published'",topicId);
  if(!topic)fail(404,'topic_not_open');
  const parent=c.parent_comment_id==null?null:textField(c.parent_comment_id,1,100,'parent_comment_id');
  if(parent){
   const row=await one(db,"SELECT topic_id FROM comments WHERE id=? AND status IN ('published','deleted')",parent);
   if(!row)fail(404,'parent_not_found');
   if(row.topic_id!==topicId)fail(400,'cross_topic_reply');
  }
  await addReply(c,topicId,parent,`comments[${i}]`,1,true);
 }
 const topicCount=results.filter(r=>r.type==='topic'&&!r.skipped).length,commentCount=results.filter(r=>r.type==='comment').length;
 const skippedTopics=results.filter(r=>r.type==='topic'&&r.skipped).length;
 const response={author,imported:{topics:topicCount,comments:commentCount},skipped:{topics:skippedTopics},results,replayed:false};
 // A single D1 batch commits all content, counters, and the replay record, or rolls everything back.
 // A concurrent identical batch loses the unique hash race and returns the winner's IDs.
 writes.unshift(stmt(db,'INSERT INTO import_batches(request_hash,result_json) VALUES(?,?)',requestHash,JSON.stringify(response)));
 writes.push(stmt(db,"INSERT INTO daily_community_metrics(day_utc,new_topics,new_comments) VALUES(date('now'),?,?) ON CONFLICT(day_utc) DO UPDATE SET new_topics=new_topics+excluded.new_topics,new_comments=new_comments+excluded.new_comments",topicCount,commentCount));
 try{await db.batch(writes);}catch(error){const saved=await replay();if(saved)return saved;throw error;}
 return json(response,topicCount+commentCount?201:200);
}
