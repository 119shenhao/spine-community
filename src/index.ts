import {Env,HttpError,now,hash,rate,json,fail,sameOrigin,currentUser,one,all,stmt} from './core';
import {authRoute} from './auth';
import {contentRoute} from './content';
import {searchRoute} from './search';
import {communityRoute} from './community';
import {translationRoute} from './translation';
import {adminRoute} from './admin';
import {importRoute,importEnabled} from './import';
import {collectRoute} from './collect';
import {drainProjection,projectionConfig} from './public-projection';
import {projectionAdminRoute} from './projection-admin';

function wakeProjection(env:Env,ctx:ExecutionContext|undefined) {
 const config=projectionConfig(env);
 if(!ctx||!config?.enabled||!config.purgeReady)return;
 ctx.waitUntil(drainProjection(env).catch(()=>console.warn('public_projection_drain_failed')));
}

function changesProjection(path:string,method:string) {
 if(method==='PATCH'&&path==='/api/me')return true;
 if(method==='POST'&&['/api/admin/content','/api/admin/privacy','/api/admin/taxonomy','/api/admin/public-projection/repair','/api/admin/public-projection/retry'].includes(path))return true;
 if(path.endsWith('/like'))return false; // Count updates are debounced in D1 and drained with the queue.
 return ['POST','PATCH','PUT','DELETE'].includes(method)&&
  (/^\/api\/topics(?:\/[^/]+(?:\/(?:comments|like))?)?$/.test(path)||/^\/api\/comments\/[^/]+(?:\/like)?$/.test(path));
}

export default {
 async fetch(req:Request,env:Env,ctx?:ExecutionContext):Promise<Response>{
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
   if(path==='/api/import'||path.startsWith('/api/import/')){
    const response=await importRoute(req,env,path);
    if(req.method==='POST'&&response.status===201)wakeProjection(env,ctx);
    return response;
   }
   if(path==='/api/collect'||path.startsWith('/api/collect/')){
    const response=await collectRoute(req,env,path);
    if(response.ok&&req.method==='POST'&&['/api/collect/complete','/api/collect/long/finish'].includes(path))wakeProjection(env,ctx);
    return response;
   }
   if(path==='/api/uploads'||path.startsWith('/api/uploads/'))fail(403,'image_feature_disabled');
   if(path==='/api/health'){
    let ready=false,projectionReady=false;
    try{
     const row=env.DB&&await one(env.DB,`SELECT value,EXISTS(SELECT 1 FROM sqlite_master WHERE type='table'
       AND name='public_projection_scan_count') projection FROM settings WHERE key='schema_version' AND value='1'`);
     ready=Boolean(row);projectionReady=Boolean(row?.projection);
    }catch{}
    const config=projectionConfig(env);
    const projectionEnabled=Boolean(projectionReady&&config?.enabled&&config.purgeReady);
    const publicContent={
     baseUrl:projectionEnabled&&env.PUBLIC_CONTENT_READS==='true'?config!.base:null,
     fallback:env.PUBLIC_CONTENT_FALLBACK==='true',
     ready:projectionReady,enabled:Boolean(config?.enabled),purgeConfigured:Boolean(config?.purgeReady),
     zoneConfigured:Boolean(config?.zoneConfigured),tokenConfigured:Boolean(config?.tokenConfigured)
    };
    return json({environment:env.APP_ENV==='preview'?'preview':'production',status:ready?'ok':'setup_required',stage:'v1-development',version:'0.2.0-cdn.3',publicContent,databaseConfigured:Boolean(env.DB),databaseReady:ready,imageUploadsEnabled:false,importEnabled:importEnabled(req,env),googleConfigured:Boolean(env.GOOGLE_CLIENT_ID&&env.GOOGLE_CLIENT_SECRET),translationConfigured:env.TRANSLATION_ENABLED==='true'&&Boolean(env.TRANSLATOR_KEY),analyticsConfigured:Boolean(env.ANALYTICS_SALT)},ready?200:503);
   }
   if(!env.DB)fail(503,'database_not_configured');
   if(!['GET','HEAD'].includes(req.method))sameOrigin(req);
   const ip=req.headers.get('cf-connecting-ip')||'local';
   await rate(env.DB,'api:'+await hash(ip+new Date().toISOString().slice(0,10)),180);
   const user=await currentUser(req,env);
   for(const route of [authRoute,communityRoute,contentRoute,searchRoute,translationRoute,projectionAdminRoute,adminRoute]){
    const response=await route(req,env,user,path);
    if(response){if(response.ok&&changesProjection(path,req.method))wakeProjection(env,ctx);response.headers.set('x-content-type-options','nosniff');response.headers.set('referrer-policy','no-referrer');return response;}
   }
   fail(404,'not_found');
  }catch(error){
   if(error instanceof HttpError)return json({error:error.message},error.status);
   return json({error:'service_unavailable'},503);
  }
 },
 async scheduled(_event:ScheduledController,env:Env,ctx:ExecutionContext) {
  if(env.APP_ENV==='production')wakeProjection(env,ctx);
 }
} satisfies ExportedHandler<Env>;
