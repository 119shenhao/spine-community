import {Row,all} from './core';

const PAGE_BYTES=384*1024;
const encoder=new TextEncoder();

export async function projectTranslations(db:D1Database,topics:Row[],comments:Row[],progress:Row[],scope:'full'|'summary') {
  if(!topics.length&&!comments.length&&!progress.length)return;
  const refs=(rows:Row[])=>JSON.stringify(rows.map(r=>[r.id,r.content_version]));
  const rows=await all(db,`SELECT 'topic' type,topic_id id,scope,locale,title_text,body_text,provider,projection_token,projection_key
    FROM topic_translations x JOIN json_each(?) r
      ON x.topic_id=json_extract(r.value,'$[0]') AND x.source_version=json_extract(r.value,'$[1]')
    WHERE scope=? AND projection_token IS NOT NULL AND projection_key IS NOT NULL
    UNION ALL
    SELECT 'comment',comment_id,x.scope,locale,'',body_text,provider,projection_token,projection_key
    FROM comment_translations x JOIN (
      SELECT value,'full' scope FROM json_each(?) UNION ALL SELECT value,'preview' FROM json_each(?)
    ) r ON x.comment_id=json_extract(r.value,'$[0]') AND x.source_version=json_extract(r.value,'$[1]') AND x.scope=r.scope
    WHERE projection_token IS NOT NULL AND projection_key IS NOT NULL
    ORDER BY type,id,scope,locale LIMIT 64`,refs(topics),scope,refs(comments),refs(progress));
  const index=new Map<string,Row[]>();
  for(const [type,part,group] of [['topic',scope,topics],['comment','full',comments],['comment','preview',progress]] as const){
    for(const row of group){
      const key=type+':'+part+':'+row.id;
      const matches=index.get(key);
      if(matches)matches.push(row);else index.set(key,[row]);
    }
  }
  let size=0;
  for(const r of rows){
    const text=encoder.encode(JSON.stringify({title:r.title_text,body:r.body_text,provider:r.provider}));
    if(text.length>96*1024||size+text.length+64>PAGE_BYTES)continue;
    size+=text.length+64;
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
    for(const row of index.get(r.type+':'+r.scope+':'+r.id)||[]) (row.translations??={})[r.locale]=data;
  }
}
