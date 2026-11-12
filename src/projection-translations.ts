import {Row,all} from './core';
import {excerptText,FEED_EXCERPT_LIMIT,SUMMARY_TRANSLATION_ENGINE,SUMMARY_TRANSLATION_REVISION} from './excerpt';

// A locale is fetched independently: enforce a per-locale budget, not a
// combined budget that starves later languages as a page gets translated.
const LOCALE_PAGE_BYTES=2*1024*1024;
const encoder=new TextEncoder();

export async function projectTranslations(db:D1Database,topics:Row[],comments:Row[],progress:Row[],scope:'full'|'summary',direct=false) {
  if(!topics.length&&!comments.length&&!progress.length)return;
  const refs=(rows:Row[])=>JSON.stringify(rows.map(r=>[r.id,r.content_version]));
  const rows=await all(db,`SELECT 'topic' type,topic_id id,scope,locale,source_version,title_text,body_text,provider,projection_token,projection_key
    FROM topic_translations x JOIN json_each(?) r
      ON x.topic_id=json_extract(r.value,'$[0]') AND x.source_version=json_extract(r.value,'$[1]')
    WHERE scope=? AND (?=1 OR (projection_token IS NOT NULL AND projection_key IS NOT NULL))
      AND (x.scope<>'summary' OR x.provider<>'azure' OR x.engine_type=?)
    UNION ALL
    SELECT 'comment',comment_id,x.scope,locale,source_version,'',body_text,provider,projection_token,projection_key
    FROM comment_translations x JOIN (
      SELECT value,'full' scope FROM json_each(?) UNION ALL SELECT value,'preview' FROM json_each(?)
    ) r ON x.comment_id=json_extract(r.value,'$[0]') AND x.source_version=json_extract(r.value,'$[1]') AND x.scope=r.scope
    WHERE (?=1 OR (projection_token IS NOT NULL AND projection_key IS NOT NULL))
    ORDER BY locale,type,id,scope LIMIT 1024`,refs(topics),scope,Number(direct),SUMMARY_TRANSLATION_ENGINE,refs(comments),refs(progress),Number(direct));
  // Existing records may have a cached full translation but an older,
  // independently translated teaser. Prefer the full translation when rebuilding
  // direct/separate R2 feed JSON, without another Azure call or D1 migration.
  const fullTeasers=scope==='summary'&&direct?await all(db,`SELECT 'topic' type,x.topic_id id,'full' scope,x.locale,x.source_version,
    x.title_text,substr(x.body_text,1,801) body_text,x.provider,x.projection_token,x.projection_key,
    CASE WHEN length(x.body_text)>801 THEN 1 ELSE 0 END has_more
    FROM topic_translations x JOIN json_each(?) r
      ON x.topic_id=json_extract(r.value,'$[0]') AND x.source_version=json_extract(r.value,'$[1]')
    WHERE x.scope='full' AND x.provider='azure' AND NOT EXISTS (
      SELECT 1 FROM topic_translations m WHERE m.topic_id=x.topic_id
        AND m.locale=x.locale AND m.source_version=x.source_version
        AND m.scope='summary' AND m.provider<>'azure')`,refs(topics)):[];
  const index=new Map<string,Row[]>();
  for(const [type,part,group] of [['topic',scope,topics],['comment','full',comments],['comment','preview',progress]] as const){
    for(const row of group){
      const key=type+':'+part+':'+row.id;
      const matches=index.get(key);
      if(matches)matches.push(row);else index.set(key,[row]);
    }
  }
  const sizes=new Map<string,number>();
  for(const r of [...rows,...fullTeasers]){
    const fullTeaser=scope==='summary'&&direct&&r.type==='topic'&&r.scope==='full';
    const fullPreview=fullTeaser?excerptText(r.body_text,FEED_EXCERPT_LIMIT):'';
    // SQLite's substr(1,801) can end with a space that excerptText trims,
    // hiding the fact that the original full translation has more content.
    const displayPreview=fullTeaser&&r.has_more&&!fullPreview.endsWith('…')?fullPreview+'…':fullPreview;
    const translation={title:r.title_text,body:fullTeaser?displayPreview:r.body_text,
      provider:r.provider,...(scope==='summary'&&r.type==='topic'?{summaryRevision:SUMMARY_TRANSLATION_REVISION}:{})};
    const text=encoder.encode(JSON.stringify(translation));
    const size=sizes.get(r.locale)||0;
    if(size+text.length+64>LOCALE_PAGE_BYTES)continue;
    sizes.set(r.locale,size+text.length+64);
    const targets=index.get(r.type+':'+(fullTeaser?'summary':r.scope)+':'+r.id)||[];
    if(direct){
      for(const row of targets)(row.translations??={})[r.locale]={...translation,sourceVersion:r.source_version};
      continue;
    }
    // The per-row key and a keyed IV give deterministic rebuilds without
    // reusing an IV for different content if a future migration modifies a row.
    const bytes=Uint8Array.from(atob(r.projection_key.replace(/-/g,'+').replace(/_/g,'/')),s=>s.charCodeAt(0));
    const key=await crypto.subtle.importKey('raw',bytes,'AES-GCM',false,['encrypt']);
    const mac=await crypto.subtle.importKey('raw',bytes,{name:'HMAC',hash:'SHA-256'},false,['sign']);
    const iv=new Uint8Array(await crypto.subtle.sign('HMAC',mac,text)).subarray(0,12);
    const ciphertextBytes=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,text));
    const encrypted=new Uint8Array(iv.length+ciphertextBytes.length);
    encrypted.set(iv);encrypted.set(ciphertextBytes,iv.length);
    const ciphertext=Array.from({length:Math.ceil(encrypted.length/16384)},(_,i)=>
      String.fromCharCode(...encrypted.subarray(i*16384,(i+1)*16384))).join('');
    const data={token:r.projection_token,ciphertext:btoa(ciphertext)};
    for(const row of targets) (row.translations??={})[r.locale]=data;
  }
}
