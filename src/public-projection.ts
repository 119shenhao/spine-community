import {Env,Row,stmt,one,hash,now,id} from './core';

import {projectTranslations} from './projection-translations';
import {excerptText,FEED_EXCERPT_LIMIT} from './excerpt';

export const FEED_LIMIT=501;
const PREVIEW_ORIGIN='https://feature-v1-community-build-20261106-spine-community.119shenhao.workers.dev';
const PRODUCTION_ORIGIN='https://spine.nbn369.com';
const TOPIC_ID=/^[A-Za-z0-9_-]{1,128}$/;

export function projectionConfig(env:Env) {
  const preview=env.APP_ENV==='preview';
  if(!preview&&env.APP_ENV!=='production')return null;
  const base=preview?'https://spine-data-dev.nbn369.com':'https://spine-data.nbn369.com';
  if(env.PUBLIC_CONTENT_BASE_URL!==base||!env.PUBLIC_CONTENT_R2)return null;
  const zoneConfigured=/^[a-f0-9]{32}$/i.test(env.CDN_ZONE_ID||'');
  const tokenConfigured=Boolean(env.CDN_PURGE_API_TOKEN);
  return {
    base, origin:preview?PREVIEW_ORIGIN:PRODUCTION_ORIGIN, bucket:env.PUBLIC_CONTENT_R2,
    enabled:env.PUBLIC_CONTENT_ENABLED==='true',
    directTranslations:env.PUBLIC_TRANSLATION_DIRECT==='true'||env.PUBLIC_TRANSLATION_SEPARATE==='true',
    separateTranslations:env.PUBLIC_TRANSLATION_SEPARATE==='true',
    pageSize:env.PUBLIC_CONTENT_PAGE_SIZE==='20'?20:50,
    onDemand:env.PUBLIC_CONTENT_ON_DEMAND==='true',
    zoneConfigured,tokenConfigured,purgeReady:zoneConfigured&&tokenConfigured
  };
}

export function objectKey(scope:string,target:string,index:number,pageSize=50) {
  if(!Number.isSafeInteger(index)||index<1)throw Error('invalid_object_index');
  if(scope==='feed'&&target==='latest')return `feeds/latest/page-${index}.json`;
  if(scope!=='topic'||!TOPIC_ID.test(target))throw Error('invalid_projection_target');
  return index===1?`topics/${target}/detail.json`:
    `topics/${target}/comments/${pageSize===20?'size-20/':''}page-${index}.json`;
}

export function parseObjectKey(key:string):
  |{scope:'feed';target:'latest';index:number}
  |{scope:'topic';target:string;index:number;pageSize:number}
  |null {
  const feed=key.match(/^feeds\/latest\/page-([1-9][0-9]*)\.json$/);
  if(feed&&Number(feed[1])<=FEED_LIMIT)return {scope:'feed',target:'latest',index:Number(feed[1])};
  const topic=key.match(/^topics\/([A-Za-z0-9_-]{1,128})\/(?:detail\.json|comments\/(size-20\/)?page-([1-9][0-9]*)\.json)$/);
  if(!topic)return null;
  const index=topic[3]?Number(topic[3]):1;
  return Number.isSafeInteger(index)&&(!topic[3]||index>=2)?{scope:'topic',target:topic[1],index,pageSize:topic[2]?20:50}:null;
}

const termsFor=(db:D1Database,ids:string[])=>stmt(db,`
 SELECT tt.topic_id,tt.term_id id,tx.term_type FROM topic_terms tt
 JOIN taxonomy_terms tx ON tx.id=tt.term_id
 WHERE tt.topic_id IN (SELECT value FROM json_each(?))
 ORDER BY tt.topic_id,tt.term_id`,JSON.stringify(ids));
const versionOf=(db:D1Database,scope:string,target:string)=>stmt(db,
  'SELECT version FROM public_projection WHERE scope=? AND target=?',scope,target);
const feedRows=(db:D1Database,index:number)=>stmt(db,`
 SELECT t.id,t.title,substr(t.body,1,801) summary,
        COALESCE(v.language,t.source_lang) source_lang,
        CASE WHEN v.method='admin-manual' THEN 'manual' WHEN v.language IS NOT NULL THEN 'auto' ELSE t.source_lang_mode END source_lang_mode,
        t.content_version,t.status,
        t.created_at,t.reply_count,t.like_count,u.nickname,u.public_region
 FROM topics t JOIN users u ON u.id=t.author_id
 LEFT JOIN content_language_verifications v ON v.content_type='topic' AND v.content_id=t.id AND v.content_version=t.content_version
 WHERE t.status='published'
 ORDER BY t.created_at DESC,t.id DESC LIMIT 21 OFFSET ?`,(index-1)*20);
const topicRow=(db:D1Database,target:string)=>stmt(db,`
 SELECT t.id,t.status,t.created_at,t.reply_count,t.content_version,
        CASE WHEN t.status='published' THEN t.title END title,
        CASE WHEN t.status='published' THEN t.body END body,
        CASE WHEN t.status='published' THEN COALESCE(v.language,t.source_lang) ELSE 'und' END source_lang,
        CASE WHEN v.method='admin-manual' THEN 'manual' WHEN v.language IS NOT NULL THEN 'auto' ELSE t.source_lang_mode END source_lang_mode,
        CASE WHEN t.status='published' THEN u.nickname ELSE '' END nickname,
        CASE WHEN t.status='published' THEN u.public_region END public_region,
        CASE WHEN t.status='published' THEN t.like_count ELSE 0 END like_count
 FROM topics t JOIN users u ON u.id=t.author_id
 LEFT JOIN content_language_verifications v ON v.content_type='topic' AND v.content_id=t.id AND v.content_version=t.content_version
 WHERE t.id=? AND t.status IN ('published','deleted')`,target);
const commentsFor=(db:D1Database,target:string,index:number,pageSize:number)=>stmt(db,`
 SELECT c.rowid cursor,c.id,c.topic_id,
        CASE WHEN p.status IN ('published','deleted') THEN c.parent_comment_id END parent_comment_id,
        c.kind,c.progress_seq,c.status,c.content_version,c.created_at,
        CASE WHEN c.status='published' THEN c.body END body,
        CASE WHEN c.status='published' THEN COALESCE(v.language,c.source_lang) ELSE 'und' END source_lang,
        CASE WHEN v.method='admin-manual' THEN 'manual' WHEN v.language IS NOT NULL THEN 'auto' ELSE c.source_lang_mode END source_lang_mode,
        CASE WHEN c.status='published' THEN u.nickname ELSE '' END nickname,
        CASE WHEN c.status='published' THEN c.like_count ELSE 0 END like_count
 FROM comments c JOIN users u ON u.id=c.author_id
 LEFT JOIN comments p ON p.id=c.parent_comment_id
 LEFT JOIN content_language_verifications v ON v.content_type='comment' AND v.content_id=c.id AND v.content_version=c.content_version
 WHERE c.topic_id=? AND c.status IN ('published','deleted')
 AND EXISTS(SELECT 1 FROM topics WHERE id=? AND status IN ('published','deleted'))
 ORDER BY c.rowid LIMIT ? OFFSET ?`,target,target,pageSize+1,(index-1)*pageSize);

export async function buildProjection(db:D1Database,scope:string,target:string,index:number,directTranslations=false,pageSize=50) {
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
    const topics=raw.slice(0,20).map(t=>({...t,summary:excerptText(t.summary,FEED_EXCERPT_LIMIT),terms:tags.filter(tag=>tag.topic_id===t.id)}));
    await projectTranslations(db,topics,[],[],'summary',directTranslations);
    return {version:v[0]?.version||0,data:index===1||topics.length?{topics,next:more?index*20:null,similar:false,highlights:[]}:null,more};
  }

  const statements=[version,topicRow(db,target),commentsFor(db,target,index,pageSize)];
  if(index===1)statements.push(termsFor(db,[target]),stmt(db,`
    SELECT c.id,c.body,COALESCE(v.language,c.source_lang) source_lang,
      CASE WHEN v.method='admin-manual' THEN 'manual' WHEN v.language IS NOT NULL THEN 'auto' ELSE c.source_lang_mode END source_lang_mode,
      c.content_version,c.progress_seq,c.created_at FROM comments c
    LEFT JOIN content_language_verifications v ON v.content_type='comment' AND v.content_id=c.id AND v.content_version=c.content_version
    WHERE c.topic_id=? AND c.status='published' AND c.kind='progress' ORDER BY progress_seq DESC,id DESC LIMIT 2`,target));
  const [v,topics,raw,tags,progress]= (await db.batch<Row>(statements)).map(r=>r.results);
  const topic=topics[0];
  const more=raw.length===pageSize+1;
  const page=raw.slice(0,pageSize);
  const comments=page.map(({cursor,...comment})=>comment);
  const replyData={comments,next:more?page.at(-1)!.cursor:null};
  if(topic)await projectTranslations(db,topic.status==='published'&&index===1?[topic]:[],
    comments.filter(c=>c.status==='published'),progress||[],'full',directTranslations);
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

export function localeObjectKey(key:string,locale:string) {
  if(!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/.test(locale))throw Error('invalid_projection_locale');
  return 'i18n/'+locale+'/'+key;
}

// Keep originals and available translated copies in separate public R2 objects.
// The original page contains only an index of available target languages.
export function splitLocaleData(data:unknown) {
  if(!data||typeof data!=='object'||Array.isArray(data))
    return {source:data,locales:new Map<string,Row[]>()};
  const original=structuredClone(data) as Row;
  const languages=new Map<string,Row[]>();
  const collect=(rows:Row[],type:'topic'|'comment',scope:string)=>{
    for(const row of rows){
      if(!row?.translations)continue;
      for(const [locale,translated] of Object.entries(row.translations as Record<string,Row>)){
        if(!translated||translated.sourceVersion!==row.content_version||typeof translated.body!=='string')continue;
        const entries=languages.get(locale)||[];
        entries.push({type,id:row.id,scope,...translated});
        languages.set(locale,entries);
      }
      delete row.translations;
    }
  };
  collect(original.topics||[],'topic','summary');
  collect(original.topic?[original.topic]:[],'topic','full');
  collect(original.comments||[],'comment','full');
  collect(original.progress||[],'comment','preview');
  const locales=new Map<string,Row[]>();
  for(const [locale,rows] of languages){
    rows.sort((a,b)=>String(a.type+':'+a.id+':'+a.scope).localeCompare(String(b.type+':'+b.id+':'+b.scope)));
    locales.set(locale,rows);
  }
  original.translationLayout='separate-v1';
  original.translationLocales=[...locales.keys()].sort();
  return {source:original,locales};
}

export async function purgeProjection(env:Env,config:NonNullable<ReturnType<typeof projectionConfig>>,key:string,allVariants=false,extraKeys:string[]=[]) {
  const urls=[key,...extraKeys].map(item=>config.base+'/'+item);
  const url=urls[0];
  let response:Response;
  try{
    response=await fetch(`https://api.cloudflare.com/client/v4/zones/${env.CDN_ZONE_ID}/purge_cache`,{
      method:'POST',redirect:'manual',signal:AbortSignal.timeout(5000),
      headers:{authorization:'Bearer '+env.CDN_PURGE_API_TOKEN,'content-type':'application/json'},
      body:JSON.stringify(allVariants?{prefixes:urls.map(item=>new URL(item).host+new URL(item).pathname)}:
        {files:urls.flatMap(item=>[item,{url:item,headers:{Origin:config.origin}}])})
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
      const checkedAt=now();
      const current=await buildProjection(db,scope,target,index,config.directTranslations,config.pageSize);
      if(current.version!==version)continue;
      const key=objectKey(scope,target,index,config.pageSize);
      // Reserve a key before the first PUT so interrupted builds can scrub it.
      const reserved=await one(db,`UPDATE public_projection SET last_object=max(last_object,?)
        WHERE scope=? AND target=? AND lease=? AND lease_until>? AND version=? RETURNING last_object`,index,scope,target,token,now(),version);
      if(!reserved)continue;
      error='r2_publish_failed';
      const localeKeys=await writeProjection(config,key,scope,target,version,current.data,false,checkedAt);
      error='purge_failed';
      await purgeProjection(env,config,key,false,localeKeys);
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

export async function writeProjection(config:NonNullable<ReturnType<typeof projectionConfig>>,key:string,
  scope:string,target:string,version:number,data:unknown,invalidated=false,checkedAt=0,refresh=false):Promise<string[]> {
  const separated=config.separateTranslations;
  const split=separated?splitLocaleData(data):{source:data,locales:new Map<string,Row[]>()};
  const source=split.source;
  const digest=await payloadHash(source);
  const visibility=invalidated?'invalidated':data===null?'withdrawn':'public';
  const old=await config.bucket.head(key);
  const oldVersion=Number(old?.customMetadata?.projectionVersion)||0;
  if(oldVersion>version)throw Error('r2_version_ahead');
  const cacheControl='public, max-age=0, s-maxage=7200, must-revalidate';
  const format=separated?'separate-v1':config.directTranslations?'direct':'encrypted';
  let previousLocales:string[]=[];
  if(old?.customMetadata?.translationLocales){
    try{previousLocales=JSON.parse(old.customMetadata.translationLocales);}catch{}
    if(!Array.isArray(previousLocales))previousLocales=[];
  }
  const languages=[...split.locales.keys()].sort();
  // Return every known locale key, including unchanged R2 objects, so a retry
  // after a failed CDN purge still invalidates stale edge copies.
  const keys:string[]=[...new Set([...previousLocales,...languages])]
    .map(locale=>localeObjectKey(key,locale));
  // When rolling back a split projection, tombstone and purge every previously
  // published locale object rather than leaving an independently readable stale
  // translation behind after its original is edited, hidden or deleted.
  if(separated||previousLocales.length){
    // Always write locale data first. Missing translations get invalidation
    // tombstones, so an edited reply cannot reuse an old R2 translation.
    for(const locale of new Set([...previousLocales,...languages])){
      const localeKey=localeObjectKey(key,locale);
      const items=split.locales.get(locale);
      const visible=visibility==='public'&&Boolean(items);
      const body=visible?{
        schemaVersion:1,contentVersion:version,translationLayout:'separate-v1',
        locale,sourceKey:key,items
      }:{schemaVersion:1,contentVersion:version,translationLayout:'separate-v1',
        locale,sourceKey:key,invalidated:true,items:[]};
      const oldLocale=await config.bucket.head(localeKey);
      const oldLocaleVersion=Number(oldLocale?.customMetadata?.projectionVersion)||0;
      if(oldLocaleVersion>version)throw Error('r2_version_ahead');
      const localeHash=await payloadHash(body);
      if(oldLocaleVersion===version&&oldLocale?.customMetadata?.payloadHash===localeHash)continue;
      const result=await config.bucket.put(localeKey,JSON.stringify(body),{
        onlyIf:oldLocale?{etagMatches:oldLocale.etag}:{etagDoesNotMatch:'*'},
        httpMetadata:{contentType:'application/json',cacheControl},
        customMetadata:{projectionVersion:String(version),payloadHash:localeHash,
          visibility:visible?'public':'invalidated',translationFormat:'separate-v1'}
      });
      if(!result)throw Error('r2_conditional_write_conflict');
    }
  }
  if(oldVersion===version&&old?.customMetadata?.payloadHash===digest&&old.customMetadata.visibility===visibility&&
    old.customMetadata.translationFormat===format&&old.customMetadata.cachePolicy==='edge-60'&&
    (!refresh||Number(old.customMetadata.translationCheckedAt)>=checkedAt))return keys;
  const result=await config.bucket.put(key,JSON.stringify({
    schemaVersion:1,contentVersion:version,generatedAt:new Date().toISOString(),
    ...(scope==='topic'?{topicId:target}:{}),...(invalidated?{invalidated:true}:{}),data:source
  }),{
    onlyIf:old?{etagMatches:old.etag}:{etagDoesNotMatch:'*'},
    httpMetadata:{contentType:'application/json',cacheControl},
    customMetadata:{projectionVersion:String(version),payloadHash:digest,visibility,
      translationFormat:format,translationLocales:JSON.stringify(languages),
      translationCheckedAt:String(checkedAt),cachePolicy:'edge-60'}
  });
  if(!result)throw Error('r2_conditional_write_conflict');
  return keys;
}
