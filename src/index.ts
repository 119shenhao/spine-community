import {Env,HttpError,now,hash,rate,json,fail,sameOrigin,currentUser,one,all,stmt} from './core';
import {authRoute} from './auth';
import {contentRoute} from './content';
import {searchRoute} from './search';
import {communityRoute} from './community';
import {translationRoute,translationConfigured,translationSetup} from './translation';
import {adminRoute} from './admin';
import {importRoute,importEnabled} from './import';
import {collectRoute} from './collect';
import {projectionConfig} from './public-projection';
import {drainPublicContent,requestProjection} from './projection-demand';
import {projectionAdminRoute} from './projection-admin';
import {projectionViewerRoute} from './projection-viewer';

function wakeProjection(env:Env,ctx:ExecutionContext|undefined) {
 const config=projectionConfig(env);
 if(!ctx||!config?.enabled||!config.purgeReady)return;
 ctx.waitUntil(drainPublicContent(env).catch(()=>console.warn('public_projection_drain_failed')));
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
    let ready=false,projectionReady=false,translationReady=false,translationEnabled=false,translationCacheAvailable=false;
    const config=projectionConfig(env);
    try{
     const row=env.DB&&await one(env.DB,`SELECT value,EXISTS(SELECT 1 FROM sqlite_master WHERE type='table'
       AND name='public_projection_scan_count') projection,EXISTS(SELECT 1 FROM sqlite_master WHERE type='table'
       AND name='public_projection_demand') demand,
       EXISTS(SELECT 1 FROM pragma_table_info('topic_translations') WHERE name='projection_key') translation,
       (SELECT value FROM settings WHERE key='translation_enabled') translationEnabled,
       EXISTS(SELECT 1 FROM topic_translations) OR EXISTS(SELECT 1 FROM comment_translations) cachedTranslations FROM settings WHERE key='schema_version' AND value='1'`);
     ready=Boolean(row);translationReady=Boolean(row?.translation);translationEnabled=row?.translationEnabled==='true';translationCacheAvailable=Boolean(row?.cachedTranslations);projectionReady=Boolean(row?.projection&&(!config?.onDemand||row?.demand));
    }catch{}
    const projectionEnabled=Boolean(projectionReady&&config?.enabled&&config.purgeReady);
    const publicContent={
     baseUrl:projectionEnabled&&env.PUBLIC_CONTENT_READS==='true'?config!.base:null,
     ...(projectionEnabled&&env.PUBLIC_CONTENT_READS==='true'?{signedIn:true,directTranslations:config!.directTranslations,separateTranslations:config!.separateTranslations,pageSize:config!.pageSize}:{}),
     onDemand:projectionEnabled&&Boolean(config?.onDemand),
     fallback:env.PUBLIC_CONTENT_FALLBACK==='true',
     ready:projectionReady,enabled:Boolean(config?.enabled),purgeConfigured:Boolean(config?.purgeReady),
     zoneConfigured:Boolean(config?.zoneConfigured),tokenConfigured:Boolean(config?.tokenConfigured)
    };
    return json({environment:env.APP_ENV==='preview'?'preview':'production',status:ready?'ok':'setup_required',stage:'v1-development',version:'0.4.0-translation-provider-controls.1',publicContent,databaseConfigured:Boolean(env.DB),databaseReady:ready,imageUploadsEnabled:false,importEnabled:importEnabled(req,env),googleConfigured:Boolean(env.GOOGLE_CLIENT_ID&&env.GOOGLE_CLIENT_SECRET),translationReady,translationCacheAvailable,...(env.APP_ENV==='preview'?{translationSetup:{...translationSetup(env),databaseEnabled:translationEnabled}}:{}),translationConfigured:translationReady&&translationEnabled&&translationConfigured(env),analyticsConfigured:Boolean(env.ANALYTICS_SALT)},ready?200:503);
   }
   if(!env.DB)fail(503,'database_not_configured');
   if(!['GET','HEAD'].includes(req.method))sameOrigin(req);
   const ip=req.headers.get('cf-connecting-ip')||'local';
   await rate(env.DB,'api:'+await hash(ip+new Date().toISOString().slice(0,10)),180);
   const user=await currentUser(req,env);
   for(const route of [authRoute,communityRoute,contentRoute,searchRoute,translationRoute,projectionViewerRoute,projectionAdminRoute,adminRoute]){
    const response=await route(req,env,user,path,ctx);
    if(!response)continue;
    if(response.ok){
     if(changesProjection(path,req.method))wakeProjection(env,ctx);
     if(ctx&&req.method==='GET'&&req.headers.has('x-spine-projection-miss')){
      ctx.waitUntil(requestProjection(env,req,path).catch(()=>console.warn('public_projection_request_failed')));
     }
    }
    response.headers.set('x-content-type-options','nosniff');
    response.headers.set('referrer-policy','no-referrer');
    return response;
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
