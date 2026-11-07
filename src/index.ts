import {Env,HttpError,now,hash,rate,json,fail,sameOrigin,currentUser,one,all,stmt} from './core';
import {authRoute} from './auth';
import {contentRoute} from './content';
import {searchRoute} from './search';
import {communityRoute} from './community';
import {translationRoute} from './translation';
import {adminRoute} from './admin';
import {importRoute,importEnabled} from './import';
import {collectRoute} from './collect';
export default {
 async fetch(req:Request,env:Env):Promise<Response>{
  const url=new URL(req.url),path=url.pathname;
  if(!path.startsWith('/api/')){
   const asset=await env.ASSETS.fetch(req);
   if(path==='/'||path==='/index.html'){
    const headers=new Headers(asset.headers);
    if(env.APP_ENV==='preview')headers.set('X-Robots-Tag','noindex, nofollow');
    else headers.delete('X-Robots-Tag');
    return new Response(asset.body,{status:asset.status,statusText:asset.statusText,headers});
   }
   return asset;
  }
  try{
   if(path==='/api/import'||path.startsWith('/api/import/'))return await importRoute(req,env,path);
   if(path==='/api/collect'||path.startsWith('/api/collect/'))return await collectRoute(req,env,path);
   if(path==='/api/uploads'||path.startsWith('/api/uploads/'))fail(403,'image_feature_disabled');
   if(path==='/api/health'){
    let ready=false;try{ready=Boolean(env.DB&&await one(env.DB,"SELECT value FROM settings WHERE key='schema_version' AND value='1'"));}catch{}
    return json({environment:env.APP_ENV==='preview'?'preview':'production',status:ready?'ok':'setup_required',stage:'v1-development',version:'0.2.0-preview.2',databaseConfigured:Boolean(env.DB),databaseReady:ready,imageUploadsEnabled:false,importEnabled:importEnabled(req,env),googleConfigured:Boolean(env.GOOGLE_CLIENT_ID&&env.GOOGLE_CLIENT_SECRET),translationConfigured:env.TRANSLATION_ENABLED==='true'&&Boolean(env.TRANSLATOR_KEY),analyticsConfigured:Boolean(env.ANALYTICS_SALT)},ready?200:503);
   }
   if(!env.DB)fail(503,'database_not_configured');
   if(!['GET','HEAD'].includes(req.method))sameOrigin(req);
   const ip=req.headers.get('cf-connecting-ip')||'local';
   await rate(env.DB,'api:'+await hash(ip+new Date().toISOString().slice(0,10)),180);
   const user=await currentUser(req,env);
   for(const route of [authRoute,communityRoute,contentRoute,searchRoute,translationRoute,adminRoute]){
    const response=await route(req,env,user,path);
    if(response){response.headers.set('x-content-type-options','nosniff');response.headers.set('referrer-policy','no-referrer');return response;}
   }
   fail(404,'not_found');
  }catch(error){
   if(error instanceof HttpError)return json({error:error.message},error.status);
   return json({error:'service_unavailable'},503);
  }
 }
} satisfies ExportedHandler<Env>;
