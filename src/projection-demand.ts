import {Env,Row,id,now,one,stmt} from './core';
import {buildProjection,drainProjection,objectKey,parseObjectKey,projectionConfig,purgeProjection,writeProjection} from './public-projection';

const MISS_HEADER='x-spine-projection-miss';
const MAX_ATTEMPTS=8;

function onlyQueryKeys(query:URLSearchParams,allowed:string[]) {
  let valid=true;
  query.forEach((_,key)=>{if(!allowed.includes(key))valid=false;});
  return valid;
}

function fallbackTarget(req:Request,path:string) {
  const key=req.headers.get(MISS_HEADER);
  if(!key||key.length>220)return null;
  const page=parseObjectKey(key);
  if(!page)return null;
  const query=new URL(req.url).searchParams;
  if(page.scope==='feed'){
    if(path!=='/api/topics'||!onlyQueryKeys(query,['sort','offset'])||
      (query.has('sort')&&query.get('sort')!=='latest'))return null;
    const offset=Number(query.get('offset')||0);
    // A versioned listing may restart from page one while requesting a missing later page.
    return offset===0||offset===(page.index-1)*20?{...page,key}:null;
  }
  if(path!=='/api/topics/'+page.target||!Number.isSafeInteger((page.index-1)*page.pageSize)||
    !onlyQueryKeys(query,['before'])||
    (page.index>1? !/^[1-9][0-9]{0,15}$/.test(query.get('before')||''):query.has('before')))return null;
  return {...page,key,before:query.get('before')};
}

export async function requestProjection(env:Env,req:Request,path:string) {
  const config=projectionConfig(env);
  if(!config?.enabled||!config.onDemand||!config.purgeReady||
    env.PUBLIC_CONTENT_READS!=='true'||env.PUBLIC_CONTENT_FALLBACK!=='true')return;
  const page=fallbackTarget(req,path);
  if(!page)return;
  const {scope,target,index,key}=page;
  const db=env.DB;
  if(await one(db,`SELECT 1 FROM public_projection_demand
    WHERE scope=? AND target=? AND object_index=? AND pending=1`,scope,target,index)){
    await drainDemand(env,config,2);
    return;
  }
  if(scope==='topic'&&!await one(db,"SELECT 1 FROM topics WHERE id=? AND status='published'",target))return;
  const existing=await config.bucket.head(key);
  if(existing&&existing.customMetadata?.visibility!=='invalidated'&&
     (config.separateTranslations?existing.customMetadata?.translationFormat==='separate-v1':existing.customMetadata?.translationFormat!=='separate-v1'))return;
  if('before' in page&&page.before){
    const boundary=await one(db,`SELECT rowid FROM comments WHERE topic_id=? AND status IN ('published','deleted')
      ORDER BY rowid LIMIT 1 OFFSET ?`,target,(index-1)*page.pageSize-1);
    if(boundary?.rowid!==Number(page.before))return;
  }

  await db.batch([
    stmt(db,`INSERT OR IGNORE INTO public_projection(scope,target,state)
      SELECT ?,?,'done' WHERE ?='feed' OR EXISTS(SELECT 1 FROM topics WHERE id=? AND status='published')`,scope,target,scope,target),
    stmt(db,`INSERT INTO public_projection_demand(scope,target,object_index)
      SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM public_projection WHERE scope=? AND target=?)
      ON CONFLICT(scope,target,object_index) DO UPDATE SET pending=1,attempts=0,due_at=unixepoch(),last_error=NULL
      WHERE pending=0 AND (last_error IS NULL OR attempts<? OR due_at<=unixepoch())`,scope,target,index,scope,target,MAX_ATTEMPTS)
  ]);
  await drainDemand(env,config,2);
}

// A freshly cached translation can enrich a page that has already been read.
// Keep the original projection version and its existing reservation and purge lifecycle.
export async function refreshProjectionTranslations(env:Env,items:{type:string;id:string;scope:string;page:string|null;createdAt?:number}[]) {
  const config=projectionConfig(env);
  if(!config?.onDemand||!config.enabled||!config.purgeReady||env.PUBLIC_CONTENT_READS!=='true')return;
  let queued=0;
  for(const item of items){
    const page=item.page&&parseObjectKey(item.page);
    if(!page||(page.scope==='feed'&&(item.type!=='topic'||item.scope!=='summary'))||
      (page.scope==='topic'&&item.type==='topic'&&(item.scope!=='full'||page.target!==item.id||page.index!==1)))continue;
    const object=config.directTranslations?await config.bucket.head(item.page!):null;
    if(item.createdAt!==undefined){
      if(!config.directTranslations)continue;
      if(!object||object.customMetadata?.visibility!=='public')continue;
      const checked=Number(object.customMetadata.translationCheckedAt)||0;
      if(['direct','separate-v1'].includes(object.customMetadata.translationFormat||'')&&
        checked>item.createdAt)continue;
    }
    const changed=await one(env.DB,`UPDATE public_projection_demand SET pending=1,refresh_translations=1,due_at=unixepoch()
      WHERE scope=? AND target=? AND object_index=? AND (reserved=1 OR pending=1) AND last_error IS NULL
      AND refresh_translations=0 RETURNING reserved`,
      page.scope,page.target,page.index);
    // A legacy published page may still be tracked as a contiguous reservation.
    // Adopt the already published key in the same demand queue on its first translation miss.
    const adopted=!changed&&object?.customMetadata?.visibility==='public'&&await one(env.DB,
      `INSERT OR IGNORE INTO public_projection_demand(scope,target,object_index,reserved,refresh_translations)
       SELECT ?,?,?,1,1 WHERE EXISTS(SELECT 1 FROM public_projection WHERE scope=? AND target=? AND state<>'dead')
       RETURNING reserved`,page.scope,page.target,page.index,page.scope,page.target);
    if(changed||adopted)queued++;
  }
  if(queued)await drainDemand(env,config,Math.min(queued+1,4));
}

type Config=NonNullable<ReturnType<typeof projectionConfig>>;
// Existing projections reserve a contiguous range. New reads reserve the exact
// key before writing it so a later mutation can fence even an interrupted PUT.
const pendingInvalidation=`p.state='pending' AND
  (p.next_object<=p.last_object OR EXISTS(SELECT 1 FROM public_projection_demand d
   WHERE d.scope=p.scope AND d.target=p.target AND d.reserved=1 AND d.object_index>=p.next_object))`;

export async function drainPublicContent(env:Env,limit=2) {
  const config=projectionConfig(env);
  if(!config?.onDemand)return drainProjection(env,limit);
  if(!config.enabled||!config.purgeReady)return {processed:0,failed:0,configured:false};
  return drainDemand(env,config,limit);
}

async function drainDemand(env:Env,config:Config,limit:number) {
  const db=env.DB;
  let processed=0,failed=0,followUp=false;
  for(let i=0;i<limit;i++){
    // Avoid an expensive UPDATE + correlated full queue scan on the hot empty path.
    // A cheap due-time probe is sufficient to decide whether a claim is possible.
    // Both checks stay in D1, so leases remain atomically owned by the UPDATE below.
    const due=now();
    const ready=await one(db,`SELECT
      EXISTS(SELECT 1 FROM public_projection p
        WHERE ${pendingInvalidation} AND p.due_at<=? AND p.lease_until<=? LIMIT 1) invalidation,
      EXISTS(SELECT 1 FROM public_projection_demand d
        JOIN public_projection p ON p.scope=d.scope AND p.target=d.target
        WHERE d.pending=1 AND d.due_at<=? AND p.lease_until<=? AND p.state<>'dead' LIMIT 1) demand`,
      due,due,due,due);
    if(!ready?.invalidation&&!ready?.demand)break;
    const token=id();
    const task=await one(db,`UPDATE public_projection SET lease=?,lease_until=?
      WHERE (scope,target)=(SELECT p.scope,p.target FROM public_projection p WHERE ${pendingInvalidation}
        AND p.due_at<=? AND p.lease_until<=? ORDER BY p.priority DESC,p.due_at,p.updated_at,p.scope,p.target LIMIT 1)
      RETURNING *`,token,now()+90,now(),now());
    const claim=task||await one(db,`UPDATE public_projection SET lease=?,lease_until=?,state='done'
      WHERE (scope,target)=(SELECT p.scope,p.target FROM public_projection_demand d JOIN public_projection p USING(scope,target)
        WHERE d.pending=1 AND d.due_at<=? AND p.lease_until<=? AND p.state<>'dead' AND NOT (${pendingInvalidation})
        ORDER BY d.due_at,d.scope,d.target,d.object_index LIMIT 1) RETURNING *`,token,now()+90,now(),now());
    if(!claim)break;
    let page:Row|null=null,stage=task?'projection_invalidation_failed':'projection_read_failed';
    const {scope,target,version}=claim;
    try{
      if(task){
        const reserved=await one(db,`SELECT min(object_index) idx FROM public_projection_demand
          WHERE scope=? AND target=? AND reserved=1 AND object_index>=?`,scope,target,task.next_object);
        const index=task.next_object<=task.last_object?task.next_object:Number(reserved?.idx);
        if(!index)continue;
        const next=await one(db,`SELECT 1 FROM public_projection_demand
          WHERE scope=? AND target=? AND reserved=1 AND object_index>? LIMIT 1`,scope,target,index);
        const publicData=scope==='feed'||Boolean(await one(db,`SELECT 1 FROM topics
          WHERE id=? AND status IN ('published','deleted')`,target));
        const key=objectKey(scope,target,index,config.pageSize);
        // An empty object fences an older publisher that was interrupted after reserving this key.
        const localeKeys=await writeProjection(config,key,scope,target,version,publicData?{}:null,publicData);
        stage='purge_failed';
        await purgeProjection(env,config,key,task.priority>=2,localeKeys);
        const done=index>=task.last_object&&!next;
        const updated=await one(db,`UPDATE public_projection SET next_object=?,
          published_version=CASE WHEN ? THEN version ELSE published_version END,state=?,attempts=0,last_error=NULL,due_at=?
          WHERE scope=? AND target=? AND lease=? AND version=? RETURNING version`,
          done?1:index+1,done?1:0,done?'done':'pending',now(),scope,target,token,version);
        if(updated)processed++;
      }else{
        page=await one(db,`SELECT * FROM public_projection_demand
          WHERE scope=? AND target=? AND pending=1 AND due_at<=? ORDER BY due_at,object_index LIMIT 1`,scope,target,now());
        if(!page)continue;
        const index=page.object_index;
        if(page.refresh_translations)await stmt(db,`UPDATE public_projection_demand SET refresh_translations=0
          WHERE scope=? AND target=? AND object_index=?`,scope,target,index).run();
        const checkedAt=now();
        const current=await buildProjection(db,scope,target,index,config.directTranslations,config.pageSize);
        if(current.version!==version)continue;
        const publicTopic=scope==='feed'||Boolean(await one(db,"SELECT 1 FROM topics WHERE id=? AND status='published'",target));
        const hasPage=current.data!==null&&publicTopic;
        if(hasPage){
          stage='r2_publish_failed';
          const reserved=await one(db,`UPDATE public_projection_demand SET reserved=1
            WHERE scope=? AND target=? AND object_index=? AND EXISTS(SELECT 1 FROM public_projection p
              WHERE p.scope=? AND p.target=? AND p.version=? AND p.lease=? AND p.lease_until>?) RETURNING reserved`,
            scope,target,index,scope,target,version,token,now());
          if(!reserved)continue;
          const key=objectKey(scope,target,index,config.pageSize);
          const localeKeys=await writeProjection(config,key,scope,target,version,current.data,false,checkedAt,Boolean(page.refresh_translations));
          stage='purge_failed';
          await purgeProjection(env,config,key,false,localeKeys);
        }
        // If a write won the race, leave the request queued for the new version.
        const checkpoint=await db.batch<Row>([
          stmt(db,`UPDATE public_projection SET state='done',published_version=version,next_object=1,attempts=0,last_error=NULL
            WHERE scope=? AND target=? AND lease=? AND version=?`,scope,target,token,version),
          stmt(db,`DELETE FROM public_projection_demand WHERE scope=? AND target=? AND object_index=? AND reserved=0
            AND NOT ? AND EXISTS(SELECT 1 FROM public_projection p WHERE p.scope=? AND p.target=? AND p.lease=? AND p.version=?)`,
            scope,target,index,Number(hasPage),scope,target,token,version),
          stmt(db,`UPDATE public_projection_demand SET pending=refresh_translations,attempts=0,last_error=NULL
            WHERE scope=? AND target=? AND object_index=? AND EXISTS(SELECT 1 FROM public_projection p
              WHERE p.scope=? AND p.target=? AND p.lease=? AND p.version=?) RETURNING pending`,scope,target,index,scope,target,token,version)
        ]);
        if(i===limit-1&&!followUp&&checkpoint[2].results[0]?.pending){followUp=true;limit++;}
        processed++;
      }
    }catch(error){
      const code=error instanceof Error&&/^(?:purge_(?:http_[0-9]{3}|rejected|unavailable)|r2_version_ahead|r2_conditional_write_conflict)$/.test(error.message)?error.message:stage;
      const attempts=Number((task||page)?.attempts||0)+1;
      const due=now()+Math.min(3600,15*2**(attempts-1));
      if(task)await stmt(db,`UPDATE public_projection SET attempts=?,last_error=?,state=?,due_at=?
        WHERE scope=? AND target=? AND lease=? AND version=?`,attempts,code,attempts>=MAX_ATTEMPTS?'dead':'pending',
        due,scope,target,token,version).run();
      else if(page)await stmt(db,`UPDATE public_projection_demand SET attempts=?,last_error=?,pending=?,due_at=?
        WHERE scope=? AND target=? AND object_index=? AND EXISTS(SELECT 1 FROM public_projection p
          WHERE p.scope=? AND p.target=? AND p.lease=? AND p.version=?)`,attempts,code,attempts<MAX_ATTEMPTS?1:0,
        due,scope,target,page.object_index,scope,target,token,version).run();
      console.warn('public_projection_failure',JSON.stringify({scope,target,version,attempts,code}));
      failed++;
    }finally{
      await stmt(db,'UPDATE public_projection SET lease=NULL,lease_until=0 WHERE scope=? AND target=? AND lease=?',scope,target,token).run();
    }
  }
  return {processed,failed,configured:true};
}
