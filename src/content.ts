import {Env,Row,all,one,stmt,now,id,fail,json,body,textField,requireUser,writable,rate,risk,metric,topicFingerprint} from './core';
import {sourceLanguage} from './source-language';
import {verificationWrite} from './language-state';
export async function getContent(env:Env,type:string,contentId:string,u:Row|null,placeholder=false):Promise<Row>{
  const table=type==='topic'?'topics':'comments';
  const row=await one(env.DB,`SELECT c.*,u.nickname,u.public_region FROM ${table} c JOIN users u ON u.id=c.author_id WHERE c.id=?`,contentId);
  if(!row)fail(404,'not_found');
  if(row.status==='deleted'){if(placeholder)return {...row,title:null,body:null};fail(404,'not_found');}
  if(row.status!=='published'&&u?.id!==row.author_id&&!['admin','moderator'].includes(u?.role))fail(404,'not_found');
  if(type==='comment'){
    const t=await one(env.DB,'SELECT status,author_id FROM topics WHERE id=?',row.topic_id);
    if(!t||(!['published','deleted'].includes(t.status)&&u?.id!==t.author_id&&!['admin','moderator'].includes(u?.role)))fail(404,'not_found');
  }
  return row;
}
export async function decorate(env:Env,rows:Row[],u:Row|null,type='topic'){
  if(!rows.length)return rows;
  const marks=rows.map(()=>'?').join(','),ids=rows.map(r=>r.id);
  const table=type==='topic'?'topic_likes':'comment_likes',key=type==='topic'?'topic_id':'comment_id';
  const liked=new Set(u?(await all(env.DB,`SELECT ${key} target FROM ${table} WHERE user_id=? AND ${key} IN (${marks})`,u.id,...ids)).map(r=>r.target):[]);
  let tags:Row[]=[],bookmarked=new Set(),followed=new Set();
  if(type==='topic'){
    tags=await all(env.DB,`SELECT tt.topic_id,t.id,t.term_type,t.slug FROM topic_terms tt JOIN taxonomy_terms t ON t.id=tt.term_id WHERE tt.topic_id IN (${marks})`,...ids);
    if(u){bookmarked=new Set((await all(env.DB,`SELECT topic_id FROM bookmarks WHERE user_id=? AND topic_id IN (${marks})`,u.id,...ids)).map(r=>r.topic_id));followed=new Set((await all(env.DB,`SELECT topic_id FROM topic_follows WHERE user_id=? AND topic_id IN (${marks})`,u.id,...ids)).map(r=>r.topic_id));}
  }
  for(const r of rows){r.liked=liked.has(r.id);if(type==='topic'){r.terms=tags.filter(t=>t.topic_id===r.id);r.bookmarked=bookmarked.has(r.id);r.followed=followed.has(r.id);}}
  return rows;
}
export function notify(db:D1Database,recipient:string,actor:string,event:string,topicId:string,commentId:string|null,key:string){
  return stmt(db,`INSERT OR IGNORE INTO notifications(id,recipient_id,actor_id,event_type,topic_id,comment_id,event_key) SELECT ?,?,?,?,?,?,? WHERE ?<>?`,id(),recipient,actor,event,topicId,commentId,key,recipient,actor);
}
export function purge(db:D1Database,type:string,contentId:string){
  const table=type==='topic'?'topics':'comments',key=type==='topic'?'topic_id':'comment_id';
  return [stmt(db,`UPDATE ${table} SET ${type==='topic'?'title=NULL,':''} body=NULL,status='deleted',deleted_at=?,updated_at=?,content_version=content_version+1 WHERE id=?`,now(),now(),contentId),stmt(db,`DELETE FROM ${type==='topic'?'topic_translations':'comment_translations'} WHERE ${key}=?`,contentId),stmt(db,`DELETE FROM translation_jobs WHERE content_type=? AND content_id=?`,type,contentId)];
}
export async function terms(env:Env,value:unknown){
  if(value===undefined)return [] as string[];
  if(!Array.isArray(value)||value.length>16||value.some(v=>typeof v!=='string'))fail(400,'invalid_terms');
  const unique=[...new Set(value)] as string[];for(const term of unique)if(!await one(env.DB,'SELECT 1 FROM taxonomy_terms WHERE id=? AND is_active=1',term))fail(400,'invalid_terms');return unique;
}
export async function contentRoute(req:Request,env:Env,u:Row|null,path:string):Promise<Response|null>{
  const url=new URL(req.url),method=req.method;
  if(path==='/api/taxonomy'&&method==='GET'){
    return json({terms:await all(env.DB,`SELECT t.*,COALESCE(l.label,e.label,t.slug) label FROM taxonomy_terms t LEFT JOIN taxonomy_labels l ON l.term_id=t.id AND l.locale=? LEFT JOIN taxonomy_labels e ON e.term_id=t.id AND e.locale='en' WHERE t.is_active=1 ORDER BY t.sort_order,t.id`,url.searchParams.get('locale')||'en')});
  }
  if(path==='/api/topics'&&method==='POST'){
    const user=await writable(env.DB,u);await rate(env.DB,'topic:'+user.id,6,3600);const b=await body(req);
    const title=textField(b.title,1,200,'title'),text=textField(b.body,1,30000),tags=await terms(env,b.terms);
    const duration=b.symptom_duration_days==null||b.symptom_duration_days===''?null:Number(b.symptom_duration_days);if(duration!==null&&(!Number.isInteger(duration)||duration<0||duration>36500))fail(400,'invalid_duration');
    const contentHash=await topicFingerprint(title,text);
    const duplicate=await one(env.DB,'SELECT id FROM topics WHERE content_hash=? OR (title=? AND body=?) LIMIT 1',contentHash,title,text);if(duplicate)fail(409,'duplicate_content');
    const topicId=id(),status=risk(title,text),language=sourceLanguage(b,[title,text]);
    await env.DB.batch([stmt(env.DB,'INSERT INTO topics(id,author_id,title,body,source_lang,source_lang_mode,status,symptom_duration_days,content_hash) VALUES(?,?,?,?,?,?,?,?,?)',topicId,user.id,title,text,language.label,language.mode,status,duration,contentHash),...tags.map(t=>stmt(env.DB,'INSERT INTO topic_terms VALUES(?,?)',topicId,t)),...(language.mode==='auto'&&language.label!=='und'&&status==='published'?[verificationWrite(env.DB,'topic',topicId,1,language.label,'tinyld-heavy',language.score)]:[]),metric(env.DB,'new_topics')]);
    return json({id:topicId,status},201);
  }
  const topicMatch=path.match(/^\/api\/topics\/([^/]+)$/);
  if(topicMatch){const topicId=topicMatch[1];
    if(method==='GET'){
      const topic=await getContent(env,'topic',topicId,u,true);await decorate(env,[topic],u);
      let before=url.searchParams.get('before');
      const focus=url.searchParams.get('focus');
      if(focus){const f=await one(env.DB,'SELECT rowid cursor FROM comments WHERE id=? AND topic_id=?',focus,topicId);if(f)before=String(Math.max(0,f.cursor-1));}
      if(before!==null&&(!Number.isSafeInteger(Number(before))||Number(before)<0))fail(400,'invalid_cursor');
      const progressOnly=url.searchParams.get('progress')==='1';
      const comments=await all(env.DB,`SELECT c.*,u.nickname FROM comments c JOIN users u ON u.id=c.author_id WHERE c.topic_id=? AND (c.status IN ('published','deleted') OR c.author_id=? OR ?=1) AND (? IS NULL OR c.rowid>?) AND (?=0 OR c.kind='progress') ORDER BY c.rowid LIMIT ?`,topicId,u?.id||'', ['admin','moderator'].includes(u?.role)?1:0,before,before?Number(before):0,progressOnly?1:0,env.PUBLIC_CONTENT_PAGE_SIZE==='20'?20:50);
      const decorated=await decorate(env,comments,u,'comment');
      const cursor=comments.length===(env.PUBLIC_CONTENT_PAGE_SIZE==='20'?20:50)?await one(env.DB,'SELECT rowid cursor FROM comments WHERE id=?',comments.at(-1)!.id):null;
      const progress=await all(env.DB,`SELECT c.id,c.body,c.source_lang,c.source_lang_mode,c.content_version,c.progress_seq,c.created_at FROM comments c WHERE c.topic_id=? AND c.kind='progress' AND c.status='published' ORDER BY c.progress_seq DESC LIMIT 2`,topicId);
      return json({topic,comments:decorated,progress,next:cursor?.cursor||null});
    }
    const user=await writable(env.DB,u),topic=await getContent(env,'topic',topicId,user);
    if(topic.author_id!==user.id)fail(403,'forbidden');
    if(method==='DELETE'){await env.DB.batch(purge(env.DB,'topic',topicId));return json({ok:true});}
    if(method==='PATCH'){
      const b=await body(req),title=textField(b.title,1,200,'title'),text=textField(b.body,1,30000),tags=await terms(env,b.terms);
      const contentHash=await topicFingerprint(title,text);
      const duplicate=await one(env.DB,'SELECT id FROM topics WHERE id<>? AND (content_hash=? OR (title=? AND body=?)) LIMIT 1',topicId,contentHash,title,text);if(duplicate)fail(409,'duplicate_content');
      const status=topic.status==='hidden'?'pending_review':risk(title,text),language=sourceLanguage(b,[title,text],topic);const duration=b.symptom_duration_days==null||b.symptom_duration_days===''?null:Number(b.symptom_duration_days);if(duration!==null&&(!Number.isInteger(duration)||duration<0||duration>36500))fail(400,'invalid_duration');const writes=[stmt(env.DB,'UPDATE topics SET title=?,body=?,status=?,source_lang=?,source_lang_mode=?,symptom_duration_days=?,content_hash=?,content_version=content_version+1,updated_at=? WHERE id=?',title,text,status,language.label,language.mode,duration,contentHash,now(),topicId),...(language.mode==='auto'&&language.label!=='und'&&status==='published'?[verificationWrite(env.DB,'topic',topicId,topic.content_version+1,language.label,'tinyld-heavy',language.score)]:[])];
      if(b.terms!==undefined){writes.push(stmt(env.DB,'DELETE FROM topic_terms WHERE topic_id=?',topicId),...tags.map(t=>stmt(env.DB,'INSERT INTO topic_terms VALUES(?,?)',topicId,t)));}
      await env.DB.batch(writes);return json({ok:true,status});
    }
  }
  const addComment=path.match(/^\/api\/topics\/([^/]+)\/comments$/);
  if(addComment&&method==='POST'){
    const user=await writable(env.DB,u);await rate(env.DB,'comment:'+user.id,30,3600);const topic=await getContent(env,'topic',addComment[1],user);
    if(topic.status!=='published')fail(409,'topic_not_open');
    const b=await body(req),text=textField(b.body,1,12000),kind=b.kind==='progress'?'progress':'regular',parent=b.parent_comment_id||null;
    if(kind==='progress'&&(topic.author_id!==user.id||parent))fail(403,'progress_author_required');
    let parentRow:Row|null=null;if(parent){parentRow=await getContent(env,'comment',parent,user,true);if(parentRow.topic_id!==topic.id)fail(400,'cross_topic_reply');}
    const commentId=id(),status=risk('',text),language=sourceLanguage(b,[text]),writes=[];
    writes.push(stmt(env.DB,`INSERT INTO comments(id,topic_id,author_id,parent_comment_id,kind,progress_seq,body,source_lang,source_lang_mode,status) VALUES(?,?,?,?,?,${kind==='progress'?'(SELECT COALESCE(MAX(progress_seq),0)+1 FROM comments WHERE topic_id=?)':'NULL'},?,?,?,?)`,commentId,topic.id,user.id,parent,kind,...(kind==='progress'?[topic.id]:[]),text,language.label,language.mode,status));
    if(language.mode==='auto'&&language.label!=='und'&&status==='published')writes.push(verificationWrite(env.DB,'comment',commentId,1,language.label,'tinyld-heavy',language.score));
    writes.push(metric(env.DB,'new_comments'));
    if(status==='published'){
      writes.push(notify(env.DB,topic.author_id,user.id,'topic_reply',topic.id,commentId,'reply:'+commentId));
      if(parentRow&&parentRow.author_id!==topic.author_id)writes.push(notify(env.DB,parentRow.author_id,user.id,'comment_reply',topic.id,commentId,'reply:'+commentId));
      if(kind==='progress')writes.push(stmt(env.DB,`INSERT OR IGNORE INTO notifications(id,recipient_id,actor_id,event_type,topic_id,comment_id,event_key) SELECT lower(hex(randomblob(16))),f.user_id,?,'progress_update',?,?,? FROM topic_follows f WHERE f.topic_id=? AND f.user_id<>?`,user.id,topic.id,commentId,'progress:'+commentId,topic.id,user.id));
    }
    await env.DB.batch(writes);const created=await getContent(env,'comment',commentId,user);await decorate(env,[created],user,'comment');const counts=await one(env.DB,'SELECT reply_count FROM topics WHERE id=?',topic.id);return json({id:commentId,status,comment:created,reply_count:counts?.reply_count},201);
  }
  const commentMatch=path.match(/^\/api\/comments\/([^/]+)$/);
  if(commentMatch&&['PATCH','DELETE'].includes(method)){
    const user=await writable(env.DB,u),c=await getContent(env,'comment',commentMatch[1],user);if(c.author_id!==user.id)fail(403,'forbidden');
    if(c.kind==='progress'){const t=await one(env.DB,'SELECT author_id FROM topics WHERE id=?',c.topic_id);if(t?.author_id!==user.id)fail(403,'progress_author_required');}
    if(method==='DELETE')await env.DB.batch(purge(env.DB,'comment',c.id));
    else{const b=await body(req),text=textField(b.body,1,12000),status=c.status==='hidden'?'pending_review':risk('',text),language=sourceLanguage(b,[text],c);await env.DB.batch([stmt(env.DB,'UPDATE comments SET body=?,status=?,source_lang=?,source_lang_mode=?,content_version=content_version+1,updated_at=? WHERE id=?',text,status,language.label,language.mode,now(),c.id),...(language.mode==='auto'&&language.label!=='und'&&status==='published'?[verificationWrite(env.DB,'comment',c.id,c.content_version+1,language.label,'tinyld-heavy',language.score)]:[])]);}
    if(method==='PATCH'){const changed=await getContent(env,'comment',c.id,user);await decorate(env,[changed],user,'comment');const counts=await one(env.DB,'SELECT reply_count FROM topics WHERE id=?',c.topic_id);return json({ok:true,status:changed.status,comment:changed,reply_count:counts?.reply_count});}
    return json({ok:true});
  }
  const interaction=path.match(/^\/api\/(topics|comments)\/([^/]+)\/(like|bookmark|follow)$/);
  if(interaction&&['PUT','DELETE'].includes(method)){
    const user=await writable(env.DB,u),[,plural,target,action]=interaction,type=plural==='topics'?'topic':'comment';
    await rate(env.DB,'interact:'+user.id,120);const c=await getContent(env,type,target,user);if(c.status!=='published')fail(404,'not_found');
    if(type==='comment'&&action!=='like')fail(404,'not_found');
    const table=action==='like'?(type==='topic'?'topic_likes':'comment_likes'):action==='bookmark'?'bookmarks':'topic_follows',key=type==='comment'?'comment_id':'topic_id';
    const writes=[stmt(env.DB,method==='PUT'?`INSERT OR IGNORE INTO ${table}(user_id,${key}) VALUES(?,?)`:`DELETE FROM ${table} WHERE user_id=? AND ${key}=?`,user.id,target)];
    if(action==='like'&&method==='PUT'){
      // A stable event key suppresses notification spam on unlike/re-like.
      writes.push(notify(env.DB,c.author_id,user.id,type+'_like',type==='topic'?target:c.topic_id,type==='comment'?target:null,'like:'+type+':'+target+':'+user.id));
    }
    if(action==='like'&&method==='DELETE')writes.push(stmt(env.DB,"DELETE FROM notifications WHERE actor_id=? AND event_key=?",user.id,'like:'+type+':'+target+':'+user.id));
    await env.DB.batch(writes);const counts=await one(env.DB,`SELECT like_count FROM ${plural} WHERE id=?`,target);return json({active:method==='PUT',like_count:counts?.like_count});
  }
  return null;
}
