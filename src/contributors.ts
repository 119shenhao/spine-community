import {Env,Row,all,one,fail,json} from './core';
import {excerptText,FEED_EXCERPT_LIMIT} from './excerpt';

// Public counts use the source ledger, not nicknames; imported Anonymous is excluded.
const topicOrigin = "JOIN content_origins o ON o.content_type='topic' AND o.content_id=t.id AND o.source='user'";
const commentOrigin = "JOIN content_origins o ON o.content_type='comment' AND o.content_id=c.id AND o.source='user'";
export type ContributorSort = 'topics'|'comments'|'total';
export function contributorSort(value:string|null):ContributorSort {
 return value==='comments'||value==='total'?value:'topics';
}
export async function contributorRanking(db:D1Database,sort:ContributorSort='topics'):Promise<Row[]> {
 const order=sort==='comments'?'replies':sort==='total'?'total':'posts';
 return all(db,`SELECT u.id,u.nickname,s.posts,s.replies,s.posts+s.replies total
  FROM visible_contributor_totals s JOIN users u ON u.id=s.author_id
  WHERE u.status='active' AND u.is_system=0 AND s.posts+s.replies>0
  ORDER BY ${order} DESC,s.posts DESC,s.replies DESC,u.id ASC LIMIT 20`);
}
export async function contributorRoute(req:Request,env:Env,_user:Row|null,path:string):Promise<Response|null> {
 const match=path.match(/^\/api\/users\/([^/]+)$/);
 if(!match)return null;
 if(req.method!=='GET')fail(405,'method_not_allowed');
 const uid=match[1];
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(uid))fail(404,'not_found');
 const url=new URL(req.url),kind=url.searchParams.get('kind')||'topics';
 if(kind!=='topics'&&kind!=='comments')fail(400,'invalid_list');
 const rawOffset=url.searchParams.get('offset')||'0';
 if(!/^\d{1,5}$/.test(rawOffset)||Number(rawOffset)>10000)fail(400,'invalid_offset');
 const offset=Number(rawOffset);
 const user=await one(env.DB,"SELECT id,nickname,created_at FROM users WHERE id=? AND status='active' AND is_system=0",uid);
 if(!user)fail(404,'not_found');
 const counts=await one(env.DB,`SELECT
  (SELECT count(*) FROM topics t ${topicOrigin} WHERE t.author_id=? AND t.status='published') posts,
  (SELECT count(*) FROM comments c ${commentOrigin} JOIN topics t ON t.id=c.topic_id
   WHERE c.author_id=? AND c.status='published' AND t.status IN ('published','deleted')) replies`,uid,uid);
 let rows:Row[];
 if(kind==='topics'){
  rows=await all(env.DB,`SELECT t.id,t.author_id,t.title,t.body,t.source_lang,t.created_at,
   t.reply_count,t.like_count,u.nickname,u.public_region,t.status,t.content_version,t.source_lang_mode
   FROM topics t ${topicOrigin} JOIN users u ON u.id=t.author_id
   WHERE t.author_id=? AND t.status='published'
   ORDER BY t.created_at DESC,t.id DESC LIMIT 21 OFFSET ?`,uid,offset);
  for(const r of rows){r.summary=excerptText(r.body,FEED_EXCERPT_LIMIT);delete r.body;}
 }else{
  rows=await all(env.DB,`SELECT c.id,c.topic_id,c.author_id,c.body,c.source_lang,c.created_at,
   c.kind,c.status,c.content_version,c.source_lang_mode,t.title topic_title,t.status topic_status
   FROM comments c ${commentOrigin} JOIN topics t ON t.id=c.topic_id
   WHERE c.author_id=? AND c.status='published' AND t.status IN ('published','deleted')
   ORDER BY c.created_at DESC,c.id DESC LIMIT 21 OFFSET ?`,uid,offset);
 }
 const next=rows.length>20?offset+20:null;
 return json({user:{...user,posts:counts?.posts||0,replies:counts?.replies||0},kind,items:rows.slice(0,20),next});
}
