import {Env,Row,all,one,stmt,now,id,b64,fail,json,body,locales} from './core';
import {detectSourceLanguage,sameLanguage} from './source-language';
import {refreshProjectionTranslations} from './projection-demand';

const AZURE_ENDPOINT='https://api.cognitive.microsofttranslator.com';
const PRODUCT='azure_ai_translator_text';
const MAX_BATCH=8;
const MAX_GENERATION_BATCH=4;
const PUBLIC_ID=/^[A-Za-z0-9_-]{1,128}$/;
const TOKEN=/^[0-9a-f-]{36}$/i;
export const translatorTargetLocale=(locale:string)=>locale==='zh-TW'?'zh-Hant':locale==='zh-CN'?'zh-Hans':locale;

function azureSourceLocale(locale:string) {
  const code=locale.toLowerCase();
  if(/^zh-(tw|hk|mo|hant)(-|$)/.test(code))return 'zh-Hant';
  if(/^zh-(cn|sg|hans)(-|$)/.test(code)||code==='zh')return 'zh-Hans';
  if(/^pt-(br|pt)$/.test(code)||/^[a-z]{2,3}-(latn|cyrl|mong|arab|syrc|cans|deva)$/.test(code))return locale;
  return code.split('-')[0];
}

function azureConfiguration(env:Env) {
  if(env.TRANSLATION_ENABLED!=='true'||!env.TRANSLATOR_KEY)return null;
  const verifiedAt=Date.parse(env.TRANSLATOR_F0_VERIFIED_AT||'')/1000;
  if(!Number.isFinite(verifiedAt)||verifiedAt>now()||now()-verifiedAt>=31*86400)return null;
  let endpoint:URL;
  try{endpoint=new URL(env.TRANSLATOR_ENDPOINT||AZURE_ENDPOINT);}catch{return null;}
  const global=endpoint.origin===AZURE_ENDPOINT&&endpoint.pathname==='/';
  const regional=/^[a-z0-9-]+\.cognitiveservices\.azure\.com$/.test(endpoint.hostname)
    && ['/', '/translator/text/v3.0', '/translator/text/v3.0/'].includes(endpoint.pathname);
  if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password||endpoint.port||
     endpoint.search||endpoint.hash||(!global&&!regional))return null;
  if((regional&&!env.TRANSLATOR_REGION)||(env.TRANSLATOR_REGION&&!/^[a-z0-9-]+$/.test(env.TRANSLATOR_REGION)))return null;
  const url=new URL(global?'/translate':'/translator/text/v3.0/translate',endpoint);
  url.searchParams.set('api-version','3.0');
  url.searchParams.set('category','general');
  url.searchParams.set('textType','plain');
  url.searchParams.set('profanityAction','NoAction');
  const headers:Record<string,string>={'content-type':'application/json','Ocp-Apim-Subscription-Key':env.TRANSLATOR_KEY};
  if(env.TRANSLATOR_REGION)headers['Ocp-Apim-Subscription-Region']=env.TRANSLATOR_REGION;
  return {url,headers,verifiedAt:Math.floor(verifiedAt)};
}
export const translationConfigured=(env:Env)=>Boolean(azureConfiguration(env));

type Item={type:'topic'|'comment'; id:string; scope:'summary'|'full'|'preview'; version:number|null; token:string|null; page:string|null};
type Settings=NonNullable<ReturnType<typeof azureConfiguration>>;
const result=(reason:string):{translated:false;reason:string;generated?:false}=>({translated:false,reason});
const cached=(row:Row):{translated:true;title:string;body:string;provider:string;generated?:false}=>({translated:true,title:row.title_text||'',body:row.body_text,provider:row.provider});
const allowedComment="root.status IN ('published','deleted')";
const validLease=`EXISTS(SELECT 1 FROM translation_jobs j WHERE j.content_type=? AND j.content_id=?
  AND j.locale=? AND j.source_version=? AND j.lease_token=? AND j.expires_at>unixepoch())`;

function parseItem(raw:unknown,legacy=false):Item {
  if(!raw||typeof raw!=='object')fail(400,'invalid_translation_request');
  const x=raw as Row;
  if(typeof x.id!=='string'||!PUBLIC_ID.test(x.id)||(!legacy&&x.type!=='topic'&&x.type!=='comment')||
    (!legacy&&(!Number.isSafeInteger(x.version)||x.version<1)))fail(400,'invalid_translation_request');
  return {type:x.type==='comment'?'comment':'topic',id:x.id,
    scope:x.type==='comment'?(x.scope==='preview'?'preview':'full'):(x.scope==='summary'?'summary':'full'),version:legacy?null:x.version,
    token:typeof x.token==='string'&&TOKEN.test(x.token)?x.token:null,
    page:typeof x.page==='string'&&x.page.length<=220?x.page:null};
}

async function readItems(db:D1Database,items:Item[],locale:string) {
  // The request may contain stale CDN ciphertext. Return its key only when
  // the same cache row and original version still have anonymous read access.
  return all(db,`WITH requested AS (
    SELECT key idx,json_extract(value,'$.id') id,json_extract(value,'$.type') type,
      json_extract(value,'$.scope') scope,json_extract(value,'$.version') version,json_extract(value,'$.token') token
    FROM json_each(?)
  ), public_rows AS (
    SELECT r.*,t.content_version,t.source_lang,t.source_lang_mode,x.provider,
      CASE WHEN r.token=x.projection_token THEN x.projection_key END projection_key,
      CASE WHEN r.token IS NULL OR r.token IS NOT x.projection_token THEN x.title_text END title_text,
      CASE WHEN r.token IS NULL OR r.token IS NOT x.projection_token THEN x.body_text END body_text
    FROM requested r JOIN topics t ON t.id=r.id AND t.status='published'
    LEFT JOIN topic_translations x ON x.topic_id=t.id AND x.locale=? AND x.source_version=t.content_version AND x.scope=r.scope
    WHERE r.type='topic'
    UNION ALL
    SELECT r.*,c.content_version,c.source_lang,c.source_lang_mode,x.provider,
      CASE WHEN r.token=x.projection_token THEN x.projection_key END,NULL,
      CASE WHEN r.token IS NULL OR r.token IS NOT x.projection_token THEN x.body_text END
    FROM requested r JOIN comments c ON c.id=r.id AND c.status='published'
    JOIN topics root ON root.id=c.topic_id AND ${allowedComment}
    LEFT JOIN comment_translations x ON x.comment_id=c.id AND x.locale=? AND x.source_version=c.content_version AND x.scope=r.scope
    WHERE r.type='comment' AND (r.scope<>'preview' OR c.kind='progress')
  ) SELECT * FROM public_rows`,JSON.stringify(items),locale,locale);
}

function limit(raw:string|undefined,fallback:number,max:number) {
  if(raw===undefined)return fallback;
  return /^\d+$/.test(raw)?Math.min(Number(raw),max):0;
}

async function generate(env:Env,entry:Item,row:Row,locale:string,config:Settings) {
  const db=env.DB,topic=entry.type==='topic',table=topic?'topics':'comments';
  const version=row.content_version;
  const currentSql=`SELECT c.* FROM ${table} c ${topic?'':"JOIN topics root ON root.id=c.topic_id AND "+allowedComment}
    WHERE c.id=? AND c.status='published' AND c.content_version=?
      ${entry.scope==='preview'?"AND c.kind='progress'":''}`;
  const c=await one(db,currentSql,entry.id,version);
  if(!c)return result('content_changed');
  const source=c.source_lang_mode==='legacy'?detectSourceLanguage(...(topic?[c.title,c.body]:[c.body])):c.source_lang;
  if(source==='und')return result('source_language_uncertain');
  if(sameLanguage(source,locale))return result('same_language');
  const token=id(),lease=[entry.type,c.id,locale,version,token];
  const lock=await one(db,`INSERT INTO translation_jobs(content_type,content_id,locale,source_version,lease_token,expires_at)
    VALUES(?,?,?,?,?,unixepoch()+35) ON CONFLICT(content_type,content_id,locale) DO UPDATE SET
    source_version=excluded.source_version,lease_token=excluded.lease_token,expires_at=excluded.expires_at
    WHERE translation_jobs.expires_at<=unixepoch() RETURNING content_id`,...lease);
  if(!lock)return result('translation_in_progress');
  let retryAfter=0;
  try{
    // One lease per source/locale allows the list and detail scopes to share a title.
    const existing=(await readItems(db,[{...entry,token:null}],locale))[0];
    if(!existing||existing.content_version!==version)return result('content_changed');
    if(existing.provider)return cached(existing);
    const other=topic?await one(db,`SELECT title_text,body_text FROM topic_translations WHERE topic_id=? AND locale=?
      AND source_version=? AND scope<>? AND provider='azure' AND product_id=? AND source_language=?`,
      c.id,locale,version,entry.scope,PRODUCT,source):null;
    const cap=entry.scope==='summary'?260:entry.scope==='preview'?180:null;
    const text=cap===null?c.body:[...c.body.slice(0,cap*2)].slice(0,cap).join('');
    const title=topic&&!other?c.title:null;
    const teaser=topic?260:180;
    const sameBody=c.body.length<=teaser*2&&[...c.body].length<=teaser;
    const otherComment=!topic?await one(db,`SELECT body_text FROM comment_translations WHERE comment_id=? AND locale=?
      AND source_version=? AND scope<>? AND provider='azure' AND product_id=? AND source_language=?`,
      c.id,locale,version,entry.scope,PRODUCT,source):null;
    const bodyFromOther=sameBody?(other||otherComment)?.body_text:
      entry.scope==='preview'&&otherComment?[...otherComment.body_text].slice(0,180).join(''):null;
    const payload=[...(title?[title]:[]),...(bodyFromOther?[]:[text])];
    const chars=payload.reduce((sum,text)=>sum+text.length,0);
    if(chars>49000)return result('content_too_long');
    // Withhold text with recognizable private contact details or pasted login credentials.
    if(payload.some(text=>/[\w.+-]+@[\w.-]+\.[a-z]{2,}|\b(?:bearer\s+ya29\.|(?:access|refresh|id)_token=)|(?:phone|tel[eé]fono|t[eé]l[eé]phone|telefon|whatsapp|电话|電話|微信)[:：\s]+\+?[\d(). -]{7,}/iu.test(text)))
      return result('source_contains_contact_details');

    let data:{translations:{text:string,to?:string}[]}[]=[];
    if(chars){
      const day=new Date().toISOString().slice(0,10),month=day.slice(0,7);
      const daily=limit(env.TRANSLATION_DAILY_LIMIT,10000,100000);
      const monthly=limit(env.TRANSLATION_MONTHLY_LIMIT,200000,1000000);
      const reservation=await one(db,`UPDATE translation_budget SET day_utc=?,month_utc=?,
        day_chars=(CASE WHEN day_utc=? THEN day_chars ELSE 0 END)+?,
        month_chars=(CASE WHEN month_utc=? THEN month_chars ELSE 0 END)+?,reservation_chars=?
        WHERE id=1 AND day_utc<=? AND date('now')=? AND cooldown_until<=unixepoch() AND provider_blocked_at<?
          AND (CASE WHEN day_utc=? THEN day_chars ELSE 0 END)+?<=?
          AND (CASE WHEN month_utc=? THEN month_chars ELSE 0 END)+?<=?
          AND COALESCE((SELECT sum(characters) FROM translation_usage_daily WHERE provider='azure' AND day_utc>=date(?,'-31 day')),0)+?<=?
          AND (SELECT value FROM settings WHERE key='translation_enabled')='true'
          AND ${validLease} AND EXISTS(${currentSql}) RETURNING id`,day,month,day,chars,month,chars,chars,
        day,day,config.verifiedAt,day,chars,daily,month,chars,monthly,day,chars,monthly,...lease,c.id,version);
      if(!reservation)return result('translation_quota_reached');
      const url=new URL(config.url);
      url.searchParams.set('from',azureSourceLocale(source));
      url.searchParams.set('to',translatorTargetLocale(locale));
      const response=await fetch(url,{method:'POST',redirect:'manual',headers:config.headers,
        body:JSON.stringify(payload.map(Text=>({Text}))),signal:AbortSignal.timeout(10000)});
      const metered=response.headers.get('x-metered-usage');
      if(metered&&/^\d{1,9}$/.test(metered)){
        await stmt(db,`UPDATE translation_usage_daily SET metered_characters=metered_characters+?
          WHERE provider='azure' AND day_utc=?`,Number(metered),day).run();
      }
      if(response.status===401||response.status===403||Number(metered)>chars){
        await stmt(db,'UPDATE translation_budget SET provider_blocked_at=max(provider_blocked_at,unixepoch()) WHERE id=1').run();
        return result('translation_provider_paused');
      }
      if(response.status===429||response.status>=500){
        const seconds=Math.min(3600,Math.max(60,Number(response.headers.get('retry-after'))||0));
        await stmt(db,'UPDATE translation_budget SET cooldown_until=max(cooldown_until,unixepoch()+?) WHERE id=1',seconds).run();
      }
      if(!response.ok){retryAfter=120;return result('translation_unavailable');}
      data=await response.json() as typeof data;
      if(!Array.isArray(data)||data.length!==payload.length||data.some(d=>{
        const x=d?.translations?.[0];
        return typeof x?.text!=='string'||!x.text.trim()||(x.to&&!sameLanguage(x.to,translatorTargetLocale(locale)));
      })){
        retryAfter=120;return result('translation_unavailable');
      }
    }
    const translatedTitle=title?data[0].translations[0].text:other?.title_text||'';
    const translatedBody=bodyFromOther||data.at(-1)!.translations[0].text;
    const key=b64(crypto.getRandomValues(new Uint8Array(32)));
    const parameters=topic?[entry.scope,c.id,locale,version,translatedTitle,translatedBody]:
      [entry.scope,c.id,locale,version,translatedBody];
    const inserted=await one(db,`INSERT OR IGNORE INTO ${topic?'topic_translations':'comment_translations'}(
      ${topic?'scope,topic_id,locale,source_version,title_text':'scope,comment_id,locale,source_version'},
      body_text,provider,source_language,product_id,engine_type,projection_token,projection_key)
      SELECT ${parameters.map(()=>'?').join(',')},'azure',?,?,'nmt',?,?
      WHERE ${validLease} AND EXISTS(${currentSql}) RETURNING provider`,
      ...parameters,source,PRODUCT,token,key,...lease,c.id,version);
    if(!inserted)return result('content_changed');
    return {translated:true,title:translatedTitle,body:translatedBody,provider:'azure',generated:true};
  }catch{
    retryAfter=120;
    return result('translation_unavailable');
  }finally{
    if(retryAfter)await stmt(db,`UPDATE translation_jobs SET expires_at=unixepoch()+?
      WHERE content_type=? AND content_id=? AND locale=? AND lease_token=?`,retryAfter,entry.type,c.id,locale,token).run();
    else await stmt(db,`DELETE FROM translation_jobs WHERE content_type=? AND content_id=? AND locale=? AND lease_token=?`,
      entry.type,c.id,locale,token).run();
  }
}

export async function translationRoute(req:Request,env:Env,_user:Row|null,path:string,ctx?:ExecutionContext):Promise<Response|null>{
  if(path!=='/api/translate'||req.method!=='POST')return null;
  const input=await body(req),locale=input.locale;
  if(!locales.includes(locale))fail(400,'invalid_translation_request');
  const legacy=input.items===undefined;
  const inputItems=legacy?[input]:input.items;
  if(!Array.isArray(inputItems)||!inputItems.length||inputItems.length>(input.generate===true?MAX_GENERATION_BATCH:MAX_BATCH))fail(400,'invalid_translation_request');
  const items=inputItems.map(x=>parseItem(x,legacy));
  const rows=await readItems(env.DB,items,locale);
  const config=legacy||input.generate===true?azureConfiguration(env):null;
  const enabled=config&&rows.some(r=>!r.provider)&&await one(env.DB,"SELECT 1 FROM settings WHERE key='translation_enabled' AND value='true'");
  const refreshed=new Map<string,Item>();
  const results=await Promise.all(items.map(async (entry,index)=>{
    const row=rows.find(row=>row.idx===index);
    if(!row){if(legacy)fail(404,'not_found');return result('not_found');}
    if(entry.version!==null&&entry.version!==row.content_version)return result('content_changed');
    if(row.source_lang_mode!=='legacy'&&sameLanguage(row.source_lang,locale))return result('same_language');
    if(row.source_lang_mode!=='legacy'&&row.source_lang==='und')return result('source_language_uncertain');
    if(row.projection_key)return {translated:true,key:row.projection_key};
    if(row.provider)return cached(row);
    if(!legacy&&input.generate!==true)return result('translation_cache_miss');
    if(!config||!enabled)return result('translation_not_configured');
    const {generated,...translation}=await generate(env,entry,row,locale,config);
    if(generated&&entry.page)refreshed.set(entry.page,entry);
    return translation;
  }));
  // A cache hit in a mixed batch may have waited behind an external request.
  // Recheck the whole batch before releasing any content or decryption keys.
  if(enabled&&results.some(item=>item.translated)){
    const latest=await readItems(env.DB,items,locale);
    for(const [i,item] of results.entries()){
      if(!item.translated)continue;
      const current=latest.find(row=>row.idx===i);
      if(!current||current.content_version!==rows.find(row=>row.idx===i)?.content_version||!current.provider){
        results[i]=result('content_changed');
      }else results[i]=current.projection_key?{translated:true,key:current.projection_key}:cached(current);
    }
  }
  if(ctx&&refreshed.size)ctx.waitUntil(refreshProjectionTranslations(env,[...refreshed.values()])
    .catch(()=>console.warn('public_projection_translation_refresh_failed')));
  return json(legacy?results[0]:{items:results});
}
