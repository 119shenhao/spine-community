import {Env,Row,stmt,one,hash,now,id} from './core';

export const FEED_LIMIT=501;
const PREVIEW_ORIGIN='https://feature-v1-community-build-20261106-spine-community.119shenhao.workers.dev';
const PRODUCTION_ORIGIN='https://spine.nbn369.com';
const TOPIC_ID=/^[A-Za-z0-9_-]{1,128}$/;

export function projectionConfig(env:Env) {
  const preview=env.APP_ENV==='preview';
  if(!preview&&env.APP_ENV!=='production')return null;
  const base=preview?'https://spine-data-dev.nbn369.com':'https://spine-data.nbn369.com';
  if(env.PUBLIC_CONTENT_BASE_URL!==base||!env.PUBLIC_CONTENT_R2)return null;
  return {
    base, origin:preview?PREVIEW_ORIGIN:PRODUCTION_ORIGIN, bucket:env.PUBLIC_CONTENT_R2,
    enabled:env.PUBLIC_CONTENT_ENABLED==='true',
    purgeReady:/^[a-f0-9]{32}$/i.test(env.CDN_ZONE_ID||'')&&Boolean(env.CDN_PURGE_API_TOKEN)
  };
}

export function objectKey(scope:string,target:string,index:number) {
  if(!Number.isSafeInteger(index)||index<1)throw Error('invalid_object_index');
  if(scope==='feed'&&target==='latest')return `feeds/latest/page-${index}.json`;
  if(scope!=='topic'||!TOPIC_ID.test(target))throw Error('invalid_projection_target');
  return index===1?`topics/${target}/detail.json`:`topics/${target}/comments/page-${index}.json`;
}

export function parseObjectKey(key:string) {
  const feed=key.match(/^feeds\/latest\/page-([1-9][0-9]*)\.json$/);
  if(feed&&Number(feed[1])<=FEED_LIMIT)return {scope:'feed',target:'latest',index:Number(feed[1])};
  const topic=key.match(/^topics\/([A-Za-z0-9_-]{1,128})\/(?:detail\.json|comments\/page-([1-9][0-9]*)\.json)$/);
  if(!topic)return null;
  const index=topic[2]?Number(topic[2]):1;
  return Number.isSafeInteger(index)&&(!topic[2]||index>=2)?{scope:'topic',target:topic[1],index}:null;
}

const termsFor=(db:D1Database,ids:string[])=>stmt(db,`
 SELECT tt.topic_id,tt.term_id id,tx.term_type FROM topic_terms tt
 JOIN taxonomy_terms tx ON tx.id=tt.term_id
 WHERE tt.topic_id IN (SELECT value FROM json_each(?))
 ORDER BY tt.topic_id,tt.term_id`,JSON.stringify(ids));
const versionOf=(db:D1Database,scope:string,target:string)=>stmt(db,
  'SELECT version FROM public_projection WHERE scope=? AND target=?',scope,target);
const feedRows=(db:D1Database,index:number)=>stmt(db,`
 SELECT t.id,t.title,substr(t.body,1,260) summary,t.source_lang,t.content_version,t.status,
        t.created_at,t.reply_count,t.like_count,u.nickname,u.public_region
 FROM topics t JOIN users u ON u.id=t.author_id WHERE t.status='published'
 ORDER BY t.created_at DESC,t.id DESC LIMIT 21 OFFSET ?`,(index-1)*20);
const topicRow=(db:D1Database,target:string)=>stmt(db,`
 SELECT t.id,t.status,t.created_at,t.reply_count,t.content_version,
        CASE WHEN t.status='published' THEN t.title END title,
        CASE WHEN t.status='published' THEN t.body END body,
        CASE WHEN t.status='published' THEN t.source_lang ELSE 'und' END source_lang,
        CASE WHEN t.status='published' THEN u.nickname ELSE '' END nickname,
        CASE WHEN t.status='published' THEN u.public_region END public_region,
        CASE WHEN t.status='published' THEN t.like_count ELSE 0 END like_count
 FROM topics t JOIN users u ON u.id=t.author_id WHERE t.id=? AND t.status IN ('published','deleted')`,target);
const commentsFor=(db:D1Database,target:string,index:number)=>stmt(db,`
 SELECT c.rowid cursor,c.id,c.topic_id,
        CASE WHEN p.status IN ('published','deleted') THEN c.parent_comment_id END parent_comment_id,
        c.kind,c.progress_seq,c.status,c.content_version,c.created_at,
        CASE WHEN c.status='published' THEN c.body END body,
        CASE WHEN c.status='published' THEN c.source_lang ELSE 'und' END source_lang,
        CASE WHEN c.status='published' THEN u.nickname ELSE '' END nickname,
        CASE WHEN c.status='published' THEN c.like_count ELSE 0 END like_count
 FROM comments c JOIN users u ON u.id=c.author_id
 LEFT JOIN comments p ON p.id=c.parent_comment_id
 WHERE c.topic_id=? AND c.status IN ('published','deleted')
 AND EXISTS(SELECT 1 FROM topics WHERE id=? AND status IN ('published','deleted'))
 ORDER BY c.rowid LIMIT 51 OFFSET ?`,target,target,(index-1)*50);

export async function buildProjection(db:D1Database,scope:string,target:string,index:number) {
  const version=versionOf(db,scope,target);
  if(scope==='feed'){
    if(index>FEED_LIMIT)return {version:(await version.first<Row>())?.version||0,data:null,more:false};
    // Capture feed rows and taxonomy assignments from the same D1 snapshot.
    const rows=feedRows(db,index);
    const result=await db.batch<Row>([version,rows,stmt(db,`
      WITH page AS (SELECT id FROM topics WHERE status='published'
        ORDER BY created_at DESC,id DESC LIMIT 20 OFFSET ?)
      SELECT tt.topic_id,tt.term_id id,tx.term_type FROM page
      JOIN topic_terms tt ON tt.topic_id=page.id JOIN taxonomy_terms tx ON tx.id=tt.term_id
      ORDER BY tt.topic_id,tt.term_id`,(index-1)*20)]);
    const [v,raw,tags]=result.map(r=>r.results);
    const more=raw.length===21&&index<FEED_LIMIT;
    const topics=raw.slice(0,20).map(t=>({...t,terms:tags.filter(tag=>tag.topic_id===t.id)}));
    return {version:v[0]?.version||0,data:index===1||topics.length?{topics,next:more?index*20:null,similar:false,highlights:[]}:null,more};
  }

  const statements=[version,topicRow(db,target),commentsFor(db,target,index)];
  if(index===1)statements.push(termsFor(db,[target]),stmt(db,`
    SELECT id,body,source_lang,content_version,progress_seq,created_at FROM comments
    WHERE topic_id=? AND status='published' AND kind='progress' ORDER BY progress_seq DESC,id DESC LIMIT 2`,target));
  const [v,topics,raw,tags,progress]= (await db.batch<Row>(statements)).map(r=>r.results);
  const topic=topics[0];
  const more=raw.length===51;
  const page=raw.slice(0,50);
  const comments=page.map(({cursor,...comment})=>comment);
  const replyData={comments,next:more?page.at(-1)!.cursor:null};
  const data=topic&&(index===1||comments.length)
    ?index===1?{topic:{...topic,terms:topic.status==='published'?tags:[]},progress,...replyData}:replyData
    :null;
  return {version:v[0]?.version||0,data,more};
}

function canonical(value:unknown):string {
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0)
    .map(([key,item])=>JSON.stringify(key)+':'+canonical(item)).join(',')+'}';
  return JSON.stringify(value) ?? 'null';
}
export const payloadHash=(data:unknown)=>hash(canonical(data));

export async function purgeProjection(env:Env,config:NonNullable<ReturnType<typeof projectionConfig>>,key:string) {
  const url=config.base+'/'+key;
  let response:Response;
  try{
    response=await fetch(`https://api.cloudflare.com/client/v4/zones/${env.CDN_ZONE_ID}/purge_cache`,{
      method:'POST',redirect:'error',signal:AbortSignal.timeout(5000),
      headers:{authorization:'Bearer '+env.CDN_PURGE_API_TOKEN,'content-type':'application/json'},
      body:JSON.stringify({files:[url,{url,headers:{Origin:config.origin}}]})
    });
  }catch{throw Error('purge_unavailable');}
  if(!response.ok)throw Error('purge_http_'+response.status);
  const result=await response.json().catch(()=>null) as {success?:boolean}|null;
  if(result?.success!==true)throw Error('purge_rejected');
}

const LEASE_SECONDS=90;
const MAX_ATTEMPTS=8;

export async function drainProjection(env:Env,limit=2) {
  const config=projectionConfig(env);
  if(!config?.enabled||!config.purgeReady)return {processed:0,failed:0,configured:false};
  const db=env.DB;
  let processed=0,failed=0;
  for(let i=0;i<limit;i++){
    const token=id();
    const task=await one(db,`UPDATE public_projection SET lease=?,lease_until=?
      WHERE (scope,target)=(SELECT scope,target FROM public_projection WHERE state='pending'
        AND due_at<=? AND lease_until<=? ORDER BY priority DESC,due_at,next_object,updated_at,scope,target LIMIT 1)
      RETURNING *`,token,now()+LEASE_SECONDS,now(),now());
    if(!task)break;
    const {scope,target,version,next_object:index}=task;
    const release=()=>stmt(db,'UPDATE public_projection SET lease=NULL,lease_until=0 WHERE scope=? AND target=? AND lease=?',scope,target,token).run();
    let error='projection_read_failed';
    try{
      const current=await buildProjection(db,scope,target,index);
      if(current.version!==version)continue;
      const key=objectKey(scope,target,index);
      // Reserve a key before the first PUT so interrupted builds can scrub it.
      const reserved=await one(db,`UPDATE public_projection SET last_object=max(last_object,?)
        WHERE scope=? AND target=? AND lease=? AND lease_until>? AND version=? RETURNING last_object`,index,scope,target,token,now(),version);
      if(!reserved)continue;
      error='r2_publish_failed';
      const digest=await payloadHash(current.data);
      const old=await config.bucket.head(key);
      const oldVersion=Number(old?.customMetadata?.projectionVersion)||0;
      if(oldVersion>version)throw Error('r2_version_ahead');
      if(oldVersion!==version||old?.customMetadata?.payloadHash!==digest){
        const result=await config.bucket.put(key,JSON.stringify({
          schemaVersion:1,contentVersion:version,generatedAt:new Date().toISOString(),
          ...(scope==='topic'?{topicId:target}:{}),data:current.data
        }),{
          onlyIf:old?{etagMatches:old.etag}:{etagDoesNotMatch:'*'},
          httpMetadata:{contentType:'application/json',cacheControl:'public, max-age=0, must-revalidate'},
          customMetadata:{projectionVersion:String(version),payloadHash:digest,visibility:current.data?'public':'withdrawn'}
        });
        if(!result)throw Error('r2_conditional_write_conflict');
      }
      error='purge_failed';
      await purgeProjection(env,config,key);
      error='projection_checkpoint_failed';
      const done=!current.more&&index>=reserved.last_object;
      const updated=await one(db,`UPDATE public_projection SET next_object=?,published_version=CASE WHEN ? THEN version ELSE published_version END,
        state=?,attempts=0,last_error=NULL,due_at=?
        WHERE scope=? AND target=? AND lease=? AND version=? RETURNING version`,
        done?1:index+1,done?1:0,done?'done':'pending',now(),scope,target,token,version);
      if(updated)processed++;
    }catch(e){
      const code=e instanceof Error&&/^(?:purge_(?:http_[0-9]{3}|rejected|unavailable)|r2_version_ahead|r2_conditional_write_conflict)$/.test(e.message)?e.message:error;
      const attempts=task.attempts+1;
      await stmt(db,`UPDATE public_projection SET attempts=?,last_error=?,state=?,due_at=?
        WHERE scope=? AND target=? AND lease=? AND version=?`,
        attempts,code,attempts>=MAX_ATTEMPTS?'dead':'pending',
        now()+Math.min(3600,15*2**(attempts-1)),scope,target,token,version).run();
      console.warn('public_projection_failure',JSON.stringify({scope,target,version,index,attempts,code}));
      failed++;
    }finally{await release();}
  }
  return {processed,failed,configured:true};
}
