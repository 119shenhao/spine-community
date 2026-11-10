import {Env,Row,body,fail,json,requireUser,stmt} from './core';
import {parseObjectKey} from './public-projection';

const ID=/^[A-Za-z0-9_-]{1,128}$/;
const publicStatus=['published','deleted'];
type ContentRef=[string,string,number];

function references(raw:unknown,limit:number):ContentRef[] {
  if(!Array.isArray(raw)||raw.length>limit)fail(400,'invalid_projection_viewer');
  const ids=new Set<string>();
  for(const row of raw){
    if(!Array.isArray(row)||row.length!==3||typeof row[0]!=='string'||!ID.test(row[0])||
      !publicStatus.includes(row[1])||!Number.isSafeInteger(row[2])||row[2]<1||ids.has(row[0]))fail(400,'invalid_projection_viewer');
    ids.add(row[0]);
  }
  return raw;
}

const requested=`WITH requested AS (
  SELECT json_extract(value,'$[0]') id,json_extract(value,'$[1]') status,
    json_extract(value,'$[2]') version FROM json_each(?)
)`;

export async function projectionViewerRoute(req:Request,env:Env,user:Row|null,path:string):Promise<Response|null>{
  if(path!=='/api/public-content/viewer'||req.method!=='POST')return null;
  const viewer=requireUser(user);
  const input=await body(req);
  const page=typeof input.page==='string'&&input.page.length<=220?parseObjectKey(input.page):null;
  if(!page||!Number.isSafeInteger(input.version)||input.version<1)fail(400,'invalid_projection_viewer');
  const {scope,target,index}=page;
  const feed=scope==='feed';
  const topics=references(input.topics,feed?20:index===1?1:0);
  const comments=references(input.comments,feed?0:index===1?52:50);
  if(feed?topics.some(t=>t[1]!=='published'):index===1&&topics[0]?.[0]!==target)fail(400,'invalid_projection_viewer');
  const staff=['admin','moderator'].includes(viewer.role)?1:0;
  const uid=viewer.id;
  const db=env.DB;
  // A CDN read only renders after the authenticated state matches the current public projection.
  // A delayed likes-only update can still use the last published page with live counts.
  const queries=[stmt(db,`SELECT 1 usable FROM public_projection p
    WHERE p.scope=? AND p.target=? AND (p.version=? OR (p.priority=0 AND p.published_version=?))
      AND (?='feed' OR (
        EXISTS(SELECT 1 FROM topics t WHERE t.id=p.target AND t.status IN ('published','deleted'))
        AND NOT EXISTS(SELECT 1 FROM comments c WHERE c.topic_id=p.target
          AND c.status IN ('pending_review','blocked','hidden') AND (c.author_id=? OR ?=1))
      ))`,scope,target,input.version,input.version,scope,uid,staff)];
  if(topics.length)queries.push(stmt(db,requested+`
    SELECT t.id,t.author_id=? mine,
      CASE WHEN t.author_id=? THEN t.symptom_duration_days END symptom_duration_days,
      t.like_count,t.reply_count,
      EXISTS(SELECT 1 FROM topic_likes l WHERE l.topic_id=t.id AND l.user_id=?) liked,
      EXISTS(SELECT 1 FROM bookmarks b WHERE b.topic_id=t.id AND b.user_id=?) bookmarked,
      EXISTS(SELECT 1 FROM topic_follows f WHERE f.topic_id=t.id AND f.user_id=?) followed
    FROM requested r JOIN topics t ON t.id=r.id AND t.status=r.status AND t.content_version=r.version`,
    JSON.stringify(topics),uid,uid,uid,uid,uid));
  if(comments.length)queries.push(stmt(db,requested+`
    SELECT c.id,c.author_id=? mine,c.like_count,
      EXISTS(SELECT 1 FROM comment_likes l WHERE l.comment_id=c.id AND l.user_id=?) liked
    FROM requested r JOIN comments c ON c.id=r.id AND c.status=r.status AND c.content_version=r.version
    WHERE c.topic_id=?`,JSON.stringify(comments),uid,uid,target));
  const [pageState,...state]=(await db.batch<Row>(queries)).map(r=>r.results);
  const topicState=topics.length?state.shift()!:[];
  const commentState=comments.length?state.shift()!:[];
  if(!pageState.length||topicState.length!==topics.length||commentState.length!==comments.length)return json({useWorker:true});
  return json({topics:topicState,comments:commentState});
}
