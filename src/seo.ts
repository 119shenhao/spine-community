import {Env,Row,all,one} from './core';

// The production domain is the single canonical host, including workers.dev aliases.
const CANONICAL_ORIGIN='https://spine.nbn369.com';
const ID=/^[A-Za-z0-9_-]{1,128}$/;
const TOPICS_PER_SITEMAP=500;
const PRIVATE_PAGES=new Set(['/search','/me','/notifications','/admin','/privacy']);
const escapeHtml=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const plainText=(v:unknown)=>String(v??'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim();
const description=(v:unknown)=>Array.from(plainText(v)).slice(0,160).join('');
const xmlEscape=escapeHtml;
const xmlDate=(timestamp:unknown)=>{
 const n=Number(timestamp);
 return Number.isFinite(n)&&n>0?new Date(n*1000).toISOString().slice(0,10):null;
};
const isPreview=(env:Env)=>env.APP_ENV!=='production';
const pageHeaders=(env:Env,indexable:boolean):Headers=>{
 const headers=new Headers({'content-type':'text/html; charset=utf-8','cache-control':'no-store, max-age=0','pragma':'no-cache','x-content-type-options':'nosniff','referrer-policy':'no-referrer'});
 if(isPreview(env)||!indexable)headers.set('x-robots-tag','noindex, nofollow');
 return headers;
};
function xmlResponse(req:Request,env:Env,value:string,status=200):Response {
 const headers=new Headers({'content-type':'application/xml; charset=utf-8','cache-control':'no-store, max-age=0','x-content-type-options':'nosniff'});
 if(isPreview(env))headers.set('x-robots-tag','noindex, nofollow');
 return new Response(req.method==='HEAD'?null:value,{status,headers});
}
function forbiddenPage(req:Request,env:Env,status=404):Response {
 return new Response(req.method==='HEAD'?null:'<!doctype html><html lang="en"><meta charset="utf-8"><title>Not found — Spine Community</title><main><h1>Not found</h1><a href="/">All discussions</a></main></html>',{status,headers:pageHeaders(env,false)});
}
function pageXml(rows:Row[],homepage=false):string {
 const urls=(homepage?[{loc:CANONICAL_ORIGIN+'/'}]:[]).concat(rows.map(row=>({
  loc:CANONICAL_ORIGIN+'/topic/'+encodeURIComponent(row.id),
  date:xmlDate(row.updated_at||row.created_at)
 })));
 return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'+urls.map(row=>
  '<url><loc>'+xmlEscape(row.loc)+'</loc>'+(row.date?'<lastmod>'+row.date+'</lastmod>':'')+'</url>'
 ).join('\n')+'\n</urlset>';
}
function sitemapIndex(pages:number):string {
 const paths=Array.from({length:pages},(_,i)=>'<sitemap><loc>'+CANONICAL_ORIGIN+'/sitemaps/topics-'+(i+1)+'.xml</loc></sitemap>');
 return '<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'+paths.join('\n')+'\n</sitemapindex>';
}
async function sitemap(req:Request,env:Env,path:string):Promise<Response> {
 if(isPreview(env)||!env.DB)return forbiddenPage(req,env);
 if(path==='/sitemap.xml'){
  const count=await one(env.DB,"SELECT count(*) n FROM topics WHERE status='published'");
  const total=Number(count?.n||0);
  if(total>TOPICS_PER_SITEMAP)return xmlResponse(req,env,sitemapIndex(Math.ceil(total/TOPICS_PER_SITEMAP)));
  const rows=await all(env.DB,"SELECT id,updated_at,created_at FROM topics WHERE status='published' ORDER BY created_at DESC,id DESC LIMIT ?",TOPICS_PER_SITEMAP);
  return xmlResponse(req,env,pageXml(rows,true));
 }
 const match=path.match(/^\/sitemaps\/topics-([1-9][0-9]*)\.xml$/);
 if(!match||Number(match[1])>100000)return forbiddenPage(req,env);
 const index=Number(match[1]);
 const rows=await all(env.DB,"SELECT id,updated_at,created_at FROM topics WHERE status='published' ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?",TOPICS_PER_SITEMAP,(index-1)*TOPICS_PER_SITEMAP);
 if(!rows.length)return forbiddenPage(req,env);
 return xmlResponse(req,env,pageXml(rows));
}
function renderPostBody(body:string):string {
 return body.split(/\r?\n{2,}/).map(part=>'<p>'+escapeHtml(part).replace(/\r?\n/g,'<br>')+'</p>').join('\n');
}
async function indexShell(req:Request,env:Env):Promise<string|null> {
 const url=new URL('/index.html',req.url);
 const asset=await env.ASSETS.fetch(new Request(url.toString(),{method:'GET'}));
 return asset.ok?asset.text():null;
}
function injectMetadata(html:string,canonical:string,title:string,summary:string,topic=false,lang='en'):string {
 html=html.replace(/<html lang="[^"]*">/i,'<html lang="'+escapeHtml(lang)+'">');
 html=html.replace(/<title>[^<]*<\/title>/i,'<title>'+escapeHtml(title)+'</title>');
 html=html.replace(/<meta name="description" content="[^"]*">/i,'<meta name="description" content="'+escapeHtml(summary)+'">');
 const meta='<link rel="canonical" href="'+escapeHtml(canonical)+'">'+
  '<meta property="og:type" content="'+(topic?'article':'website')+'">'+
  '<meta property="og:site_name" content="Spine Community">'+
  '<meta property="og:title" content="'+escapeHtml(title)+'">'+
  '<meta property="og:description" content="'+escapeHtml(summary)+'">'+
  '<meta property="og:url" content="'+escapeHtml(canonical)+'">';
 return html.replace('</head>',meta+'</head>');
}
async function htmlPage(req:Request,env:Env,path:string):Promise<Response> {
 const topic=path.match(/^\/topic\/([^/]+)$/);
 if(path.startsWith('/topic/')&&!topic)return forbiddenPage(req,env);
 let record:Row|null=null;
 if(topic){
  const id=topic[1];
  if(!ID.test(id)||!env.DB)return forbiddenPage(req,env);
  // A fresh D1 status check is intentional: never serve deleted/hidden/draft medical
  // content from a stale public projection or cache.
  record=await one(env.DB,"SELECT t.id,t.title,t.body,t.source_lang,t.created_at,t.updated_at,u.nickname FROM topics t JOIN users u ON u.id=t.author_id WHERE t.id=? AND t.status='published'",id);
  if(!record)return forbiddenPage(req,env);
 }
 const original=await indexShell(req,env);
 if(!original)return forbiddenPage(req,env,503);
 const isPrivate=PRIVATE_PAGES.has(path);
 let html=original;
 if(topic&&record){
  const canonical=CANONICAL_ORIGIN+'/topic/'+encodeURIComponent(record.id);
  const title=String(record.title||'Spine Community')+' | Spine Community';
  html=injectMetadata(html,canonical,title,description(record.body),true,ID.test(record.source_lang)?record.source_lang:'en');
  const main='<main id="main" tabindex="-1"><a href="/" class="back-link">← All discussions</a><article class="panel"><h1>'+escapeHtml(record.title)+'</h1><div class="prose">'+renderPostBody(String(record.body))+'</div><p class="subtle">Shared experience, not medical advice.</p></article></main>';
  if(!/<main id="main" tabindex="-1">[\s\S]*?<\/main>/.test(html))return forbiddenPage(req,env,503);
  html=html.replace(/<main id="main" tabindex="-1">[\s\S]*?<\/main>/,main);
 }else if(!isPrivate){
  html=injectMetadata(html,CANONICAL_ORIGIN+'/', 'Spine Community — Real spine recovery experiences',
   'Read and share personal neck, lumbar spine and back pain experiences, recovery progress and peer support.');
 }else{
  html=html.replace('</head>','<meta name="robots" content="noindex, nofollow"></head>');
 }
 return new Response(req.method==='HEAD'?null:html,{status:200,headers:pageHeaders(env,!isPrivate)});
}
export async function seoRoute(req:Request,env:Env,path:string):Promise<Response|null> {
 const known=path==='/'||path==='/index.html'||PRIVATE_PAGES.has(path)||path.startsWith('/topic/')||
   path==='/sitemap.xml'||path==='/robots.txt'||path.startsWith('/sitemaps/');
 if(!known)return null;
 if(req.method!=='GET'&&req.method!=='HEAD')return new Response(null,{status:405,headers:{allow:'GET, HEAD'}});
 if(path==='/robots.txt'){
  const robots=isPreview(env)?'User-agent: *\nDisallow: /\n':
   'User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /admin\nDisallow: /me\nDisallow: /notifications\nDisallow: /search\nSitemap: '+CANONICAL_ORIGIN+'/sitemap.xml\n';
  const h=new Headers({'content-type':'text/plain; charset=utf-8','cache-control':'no-store, max-age=0'});
  if(isPreview(env))h.set('x-robots-tag','noindex, nofollow');
  return new Response(req.method==='HEAD'?null:robots,{status:200,headers:h});
 }
 if(path==='/sitemap.xml'||path.startsWith('/sitemaps/'))return sitemap(req,env,path);
 if(path==='/index.html')return new Response(null,{status:308,headers:{location:'/', 'cache-control':'no-store'}});
 if(path==='/topic/'||path.startsWith('/topic/'))return htmlPage(req,env,path);
 return htmlPage(req,env,path);
}
