import {Env,Row,all,one,stmt,now,fail,json,body,lang,locales} from './core';
import {getContent} from './content';
export async function translationRoute(req:Request,env:Env,u:Row|null,path:string):Promise<Response|null>{
  if(path!=='/api/translate'||req.method!=='POST')return null;
  const b=await body(req),type=b.type==='comment'?'comment':'topic',locale=lang(b.locale),scope=type==='topic'&&b.scope==='summary'?'summary':'full';
  if(!locales.includes(locale)||typeof b.id!=='string')fail(400,'invalid_translation_request');
  const c=await getContent(env,type,b.id,u);if(c.status!=='published')fail(404,'not_found');
  if(c.source_lang.toLowerCase()===locale.toLowerCase())return json({translated:false,reason:'same_language'});
  const table=type==='topic'?'topic_translations':'comment_translations',key=type==='topic'?'topic_id':'comment_id';
  const cacheArgs=type==='topic'?[c.id,locale,c.content_version,scope]:[c.id,locale,c.content_version];
  const cache=await one(env.DB,`SELECT * FROM ${table} WHERE ${key}=? AND locale=? AND source_version=? ${type==='topic'?'AND scope=?':''}`,...cacheArgs);
  if(cache)return json({translated:true,title:cache.title_text,body:cache.body_text,provider:cache.provider});
  const setting=await one(env.DB,"SELECT value FROM settings WHERE key='translation_enabled'");
  if(env.TRANSLATION_ENABLED!=='true'||setting?.value!=='true'||!env.TRANSLATOR_KEY)return json({translated:false,reason:'translation_not_configured'});
  const title=type==='topic'?c.title:'',text=scope==='summary'?c.body.slice(0,260):c.body;
  const chars=title.length+text.length;if(chars>32000)return json({translated:false,reason:'content_too_long'});
  const lockLocale=locale+':'+scope;
  const lock=await one(env.DB,`INSERT INTO translation_jobs VALUES(?,?,?,?,?) ON CONFLICT(content_type,content_id,locale) DO UPDATE SET source_version=excluded.source_version,expires_at=excluded.expires_at WHERE translation_jobs.expires_at<? RETURNING content_id`,type,c.id,lockLocale,c.content_version,now()+20,now());
  if(!lock)return json({translated:false,reason:'translation_in_progress'});
  try{
    const day=new Date().toISOString().slice(0,10),month=day.slice(0,7);
    const daily=Math.max(0,Math.min(Number(env.TRANSLATION_DAILY_LIMIT)||10000,100000)),monthly=Math.max(0,Math.min(Number(env.TRANSLATION_MONTHLY_LIMIT)||200000,1000000));
    const reservation=await one(env.DB,`UPDATE translation_budget SET day_utc=?,month_utc=?,day_chars=(CASE WHEN day_utc=? THEN day_chars ELSE 0 END)+?,month_chars=(CASE WHEN month_utc=? THEN month_chars ELSE 0 END)+? WHERE id=1 AND (CASE WHEN day_utc=? THEN day_chars ELSE 0 END)+?<=? AND (CASE WHEN month_utc=? THEN month_chars ELSE 0 END)+?<=? RETURNING id`,day,month,day,chars,month,chars,day,chars,daily,month,chars,monthly);
    if(!reservation)return json({translated:false,reason:'translation_quota_reached'});
    await stmt(env.DB,`INSERT INTO translation_usage_daily(provider,day_utc,characters,requests) VALUES('azure',?,?,1) ON CONFLICT(provider,day_utc) DO UPDATE SET characters=characters+excluded.characters,requests=requests+1`,day,chars).run();
    const headers:Record<string,string>={'content-type':'application/json','Ocp-Apim-Subscription-Key':env.TRANSLATOR_KEY};if(env.TRANSLATOR_REGION)headers['Ocp-Apim-Subscription-Region']=env.TRANSLATOR_REGION;
    const res=await fetch('https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&to='+encodeURIComponent(locale),{method:'POST',headers,body:JSON.stringify((title?[title,text]:[text]).map(Text=>({Text}))),signal:AbortSignal.timeout(8000)});
    if(!res.ok)return json({translated:false,reason:'translation_unavailable'});
    const data=await res.json() as {translations:{text:string}[]}[];
    if(!Array.isArray(data)||data.length!==(title?2:1)||data.some(d=>typeof d.translations?.[0]?.text!=='string'))return json({translated:false,reason:'translation_unavailable'});
    const translatedTitle=title?data[0].translations[0].text:'',translatedBody=data.at(-1)!.translations[0].text;
    // Conditional cache write prevents an in-flight translation resurrecting deleted/edited text.
    if(type==='topic')await stmt(env.DB,`INSERT OR REPLACE INTO topic_translations(scope,topic_id,locale,source_version,title_text,body_text,provider) SELECT ?,id,?,content_version,?,?,'azure' FROM topics WHERE id=? AND status='published' AND content_version=?`,scope,locale,translatedTitle,translatedBody,c.id,c.content_version).run();
    else await stmt(env.DB,`INSERT OR REPLACE INTO comment_translations(comment_id,locale,source_version,body_text,provider) SELECT id,?,content_version,?,'azure' FROM comments WHERE id=? AND status='published' AND content_version=?`,locale,translatedBody,c.id,c.content_version).run();
    const check=await getContent(env,type,c.id,u);if(check.status!=='published'||check.content_version!==c.content_version)return json({translated:false,reason:'content_changed'});
    return json({translated:true,title:translatedTitle,body:translatedBody,provider:'azure'});
  }catch{return json({translated:false,reason:'translation_unavailable'});}
  finally{await stmt(env.DB,'DELETE FROM translation_jobs WHERE content_type=? AND content_id=? AND locale=?',type,c.id,lockLocale).run();}
}
