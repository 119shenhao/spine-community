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
 const headers=new Headers({
  'content-type':'text/html; charset=utf-8',
  'cache-control':'no-store, max-age=0',
  'pragma':'no-cache',
  'x-content-type-options':'nosniff',
  'referrer-policy':'no-referrer',
  'x-frame-options':'DENY',
  'permissions-policy':'camera=(), microphone=(), geolocation=()',
  'content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' https://spine-data-dev.nbn369.com https://spine-data.nbn369.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'"
 });
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
 const urls:{loc:string;date?:string|null}[]=(homepage?[{loc:CANONICAL_ORIGIN+'/'}]:[]).concat(rows.map(row=>({
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
 const count=await one(env.DB,"SELECT count(*) n FROM topics WHERE status='published'");
 if(index>Math.ceil(Number(count?.n||0)/TOPICS_PER_SITEMAP))return forbiddenPage(req,env);
 const rows=await all(env.DB,"SELECT id,updated_at,created_at FROM topics WHERE status='published' ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?",TOPICS_PER_SITEMAP,(index-1)*TOPICS_PER_SITEMAP);
 if(!rows.length)return forbiddenPage(req,env);
 return xmlResponse(req,env,pageXml(rows,index===1));
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
  // Read status first. Only published text is eligible for server-rendered indexing.
  // Deleted topics retain their reply placeholder; drafts stay author-accessible
  // in the client app but never reveal any private text in the HTTP response.
  record=await one(env.DB,"SELECT t.id,t.status,CASE WHEN t.status='published' THEN t.title END title,CASE WHEN t.status='published' THEN t.body END body,CASE WHEN t.status='published' THEN t.source_lang END source_lang,t.created_at,t.updated_at,t.reply_count,u.nickname,u.is_system FROM topics t JOIN users u ON u.id=t.author_id WHERE t.id=?",id);
  if(!record)return forbiddenPage(req,env);
 }
 const original=await indexShell(req,env);
 if(!original)return forbiddenPage(req,env,503);
 const isPrivate=PRIVATE_PAGES.has(path)||path.startsWith('/users/');
 let html=original;
 if(topic&&record&&record.status==='published'){
  const canonical=CANONICAL_ORIGIN+'/topic/'+encodeURIComponent(record.id);
  const title=String(record.title||'Spine Community')+' | Spine Community';
  html=injectMetadata(html,canonical,title,description(record.body),true,/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/.test(record.source_lang)?record.source_lang:'und');
  // Google DiscussionForumPosting applies to first-party community members,
  // not imported/synthetic system-author posts. No claimed author profile URLs.
  if(record.is_system===0&&record.nickname&&Number(record.created_at)>0){
   const published=new Date(Number(record.created_at)*1000).toISOString();
   const entry:Record<string,unknown>={
    '@context':'https://schema.org','@type':'DiscussionForumPosting',
    url:canonical,headline:String(record.title),text:String(record.body),
    author:{'@type':'Person',name:String(record.nickname)},datePublished:published,
    commentCount:Number(record.reply_count)||0
   };
   if(Number(record.updated_at)>Number(record.created_at))
    entry.dateModified=new Date(Number(record.updated_at)*1000).toISOString();
   html=html.replace('</head>','<script type="application/ld+json">'+JSON.stringify(entry).replace(/</g,'\\u003c')+'</script></head>');
  }
  const byline=record.is_system===0?'<p class="subtle">Shared by '+escapeHtml(record.nickname)+'</p>':'';
  const main='<main id="main" tabindex="-1"><a href="/" class="back-link">← All discussions</a><article class="panel"><h1>'+escapeHtml(record.title)+'</h1>'+byline+'<div class="prose">'+renderPostBody(String(record.body))+'</div><p class="subtle">Shared experience, not medical advice.</p></article></main>';
  if(!/<main id="main" tabindex="-1">[\s\S]*?<\/main>/.test(html))return forbiddenPage(req,env,503);
  html=html.replace(/<main id="main" tabindex="-1">[\s\S]*?<\/main>/,main);
 }else if(topic&&record){
  // Keep the SPA shell for authors and reply placeholders, but publish no removed
  // or unapproved text to crawlers. Genuine removed posts are 200/noindex;
  // private pending/hidden posts are 404/noindex and hydrate for their author.
  const removed=record.status==='deleted';
  html=html.replace(/<title>[^<]*<\/title>/i,
    '<title>'+(removed?'Post removed':'Post unavailable')+' — Spine Community</title>');
  html=html.replace('</head>','<meta name="robots" content="noindex, nofollow"></head>');
  if(removed)html=html.replace(/<main id="main" tabindex="-1">[\s\S]*?<\/main>/,
    '<main id="main" tabindex="-1"><article class="panel"><h1>Post removed</h1><p>The original post is no longer available. Replies may remain accessible.</p></article></main>');
  return new Response(req.method==='HEAD'?null:html,{status:removed?200:404,headers:pageHeaders(env,false)});
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
   path==='/sitemap.xml'||path==='/robots.txt'||path.startsWith('/sitemaps/')||path.startsWith('/users/');
 if(!known)return null;
 if(req.method!=='GET'&&req.method!=='HEAD')return new Response(null,{status:405,headers:{allow:'GET, HEAD'}});
 if(path==='/robots.txt'){
  const robots=isPreview(env)?'User-agent: *\nDisallow: /\n':
   'User-agent: *\nAllow: /\nSitemap: '+CANONICAL_ORIGIN+'/sitemap.xml\n';
  const h=new Headers({'content-type':'text/plain; charset=utf-8','cache-control':'no-store, max-age=0'});
  if(isPreview(env))h.set('x-robots-tag','noindex, nofollow');
  return new Response(req.method==='HEAD'?null:robots,{status:200,headers:h});
 }
 if(path==='/sitemap.xml'||path.startsWith('/sitemaps/'))return sitemap(req,env,path);
 if(path==='/index.html')return new Response(null,{status:308,headers:{location:'/', 'cache-control':'no-store'}});
 if(path==='/topic/'||path.startsWith('/topic/'))return htmlPage(req,env,path);
 return htmlPage(req,env,path);
}
