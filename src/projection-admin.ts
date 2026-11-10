import {Env,Row,all,one,stmt,body,json,requireRole,fail,now,id,rate} from './core';
import {buildProjection,FEED_LIMIT,objectKey,parseObjectKey,payloadHash,splitLocaleData,projectionConfig} from './public-projection';
import {drainPublicContent} from './projection-demand';

const ROOT='/api/admin/public-projection';
const SCAN_BUDGET=5000;
const CHECK_BATCH=5;
const REPAIR_BATCH=10;
const REPAIR_PAGE_LIMIT=500;
const VALID_TARGET=/^[A-Za-z0-9_-]{1,128}$/;

type Config=NonNullable<ReturnType<typeof projectionConfig>>;
const scanAt=(env:Env,scanId:string)=>one(env.DB,'SELECT * FROM public_projection_scan WHERE id=? AND environment=?',scanId,env.APP_ENV);
const audit=(env:Env,user:Row,scanId:string,action:string,reason:string)=>
  stmt(env.DB,`INSERT INTO moderation_actions(id,actor_id,target_type,target_id,action,reason)
    VALUES(?,?,'setting',?,?,?)`,id(),user.id,'public-projection:'+scanId,action,reason);
const hasReservedPage=(alias:string)=>`(${alias}.last_object>0 OR EXISTS(
  SELECT 1 FROM public_projection_demand d WHERE d.scope=${alias}.scope AND d.target=${alias}.target AND d.reserved=1))`;
const owns='EXISTS(SELECT 1 FROM public_projection_scan WHERE id=? AND lease=?)';

async function scanReport(env:Env,scan:Row,after:string) {
  const counts=await all(env.DB,`SELECT result,count
    FROM public_projection_scan_count WHERE scan_id=? AND count>0`,scan.id);
  const items=await all(env.DB,`SELECT i.object_key,i.expected_version,i.expected_hash,i.r2_version,i.r2_hash,i.result,
    p.published_version,p.state purge_state,p.last_error purge_error,i.repair_version
    FROM public_projection_scan_item i LEFT JOIN public_projection p ON p.scope=i.scope AND p.target=i.target
    WHERE i.scan_id=? AND i.result IS NOT NULL AND i.result NOT IN ('ok','ignored') AND i.object_key>? ORDER BY i.object_key LIMIT 51`,scan.id,after);
  const stats=Object.fromEntries(counts.map(r=>[r.result,r.count]));
  const next=items.length>50?items[49].object_key:null;
  return {
    id:scan.id,target:scan.target,phase:scan.phase,paused:Boolean(scan.paused),error:scan.error,
    expected_count:scan.expected_count,checked_count:scan.checked_count,
    listed_count:scan.listed_count,counts:stats,items:items.slice(0,50),next
  };
}

async function startScan(env:Env,config:Config,user:Row,input:Row) {
  const target=input.target||null;
  if(target!==null&&(typeof target!=='string'||!VALID_TARGET.test(target)))fail(400,'invalid_topic_id');
  const batch=input.batch_size??100;
  if(!Number.isInteger(batch)||batch<1||batch>100)fail(400,'invalid_batch_size');
  const scanId=id();
  // One D1 batch freezes the key inventory and versions. Stop after budget+1
  // rows, then drop an oversized inventory rather than silently truncating it.
  const snapshot=stmt(env.DB,`WITH RECURSIVE
    sizes AS (
      SELECT p.scope,p.target,p.version,
        CASE WHEN ? THEN p.last_object ELSE max(1,p.last_object,
          CASE WHEN p.scope='feed' THEN min(?,(SELECT (count(*)+19)/20 FROM topics WHERE status='published'))
          WHEN EXISTS(SELECT 1 FROM topics t WHERE t.id=p.target AND t.status IN ('published','deleted'))
          THEN (SELECT (count(*)+?-1)/? FROM comments c WHERE c.topic_id=p.target AND c.status IN ('published','deleted'))
          ELSE 1 END) END objects
      FROM public_projection p WHERE (? IS NULL OR (p.scope='topic' AND p.target=?))
    ),
    pages(scope,target,version,objects,n) AS (
      SELECT scope,target,version,objects,1 FROM sizes WHERE objects>0
      UNION ALL SELECT scope,target,version,objects,n+1 FROM pages WHERE n<objects LIMIT ?
    ),
    expected(scope,target,version,n) AS (
      SELECT scope,target,version,n FROM pages
      UNION ALL SELECT s.scope,s.target,s.version,d.object_index FROM sizes s
      JOIN public_projection_demand d USING(scope,target) WHERE ? AND d.reserved=1 AND d.object_index>s.objects
    )
    INSERT INTO public_projection_scan_item(scan_id,object_key,scope,target,object_index,expected_version)
    SELECT ?,CASE WHEN scope='feed' THEN 'feeds/latest/page-'||n||'.json'
      WHEN n=1 THEN 'topics/'||target||'/detail.json'
      ELSE 'topics/'||target||'/comments/'||?||'page-'||n||'.json' END,scope,target,n,version FROM expected LIMIT ?`,
    Number(config.onDemand),FEED_LIMIT,config.pageSize,config.pageSize,target,target,SCAN_BUDGET+1,Number(config.onDemand),scanId,config.pageSize===20?'size-20/':'',SCAN_BUDGET+1);
  if(await one(env.DB,"SELECT id FROM public_projection_scan WHERE environment=? AND phase IN ('listing','comparing')",env.APP_ENV))fail(409,'scan_already_active');
  try{
    await env.DB.batch([
      stmt(env.DB,`INSERT INTO public_projection_scan(id,actor_id,environment,target,batch_size,include_orphans,deep)
        VALUES(?,?,?,?,?,?,?)`,scanId,user.id,env.APP_ENV,target,batch,input.include_orphans===true?1:0,input.deep===true?1:0),
      snapshot,
      stmt(env.DB,`UPDATE public_projection_scan SET expected_count=(SELECT count(*) FROM public_projection_scan_item WHERE scan_id=?) WHERE id=?`,scanId,scanId),
      stmt(env.DB,"UPDATE public_projection_scan SET phase='partial',error='scan_budget_exceeded' WHERE id=? AND expected_count>?",scanId,SCAN_BUDGET),
      stmt(env.DB,"DELETE FROM public_projection_scan_item WHERE scan_id=? AND EXISTS(SELECT 1 FROM public_projection_scan WHERE id=? AND phase='partial')",scanId,scanId),
      audit(env,user,scanId,'scan_started',target?'Topic '+target:'All projection prefixes')
    ]);
  }catch(error){
    if(await one(env.DB,"SELECT id FROM public_projection_scan WHERE environment=? AND phase IN ('listing','comparing')",env.APP_ENV))fail(409,'scan_already_active');
    throw error;
  }
  return json({scan:await scanReport(env,(await scanAt(env,scanId))!,''),purge_ready:config.purgeReady},201);
}

function metadataVersion(metadata:Record<string,string>|undefined) {
  const n=Number(metadata?.projectionVersion);
  return Number.isSafeInteger(n)&&n>0?n:0;
}

async function listBatch(env:Env,config:Config,scan:Row,lease:string) {
  const prefixes=scan.target?[`topics/${scan.target}/`]:['feeds/','topics/'];
  const listed=await config.bucket.list({
    prefix:prefixes[scan.prefix_index],limit:scan.batch_size,include:['customMetadata'],
    ...(scan.cursor?{cursor:scan.cursor}:{})
  });
  if(listed.truncated&&(!listed.cursor||listed.cursor===scan.cursor))throw Error('invalid_r2_cursor');
  const count=scan.listed_count+listed.objects.length;
  if(count>SCAN_BUDGET){
    await stmt(env.DB,`UPDATE public_projection_scan SET phase='partial',error='r2_budget_exceeded' WHERE id=? AND lease=?`,scan.id,lease).run();
    return;
  }
  const entries=listed.objects.flatMap(obj=>{
    const key=parseObjectKey(obj.key);
    return key?[{key:obj.key,...key,version:metadataVersion(obj.customMetadata),hash:obj.customMetadata?.payloadHash||null}]:[];
  });
  const nextPrefix=scan.prefix_index+(listed.truncated?0:1);
  const phase=nextPrefix>=prefixes.length?'comparing':'listing';
  const record=stmt(env.DB,`INSERT INTO public_projection_scan_item(scan_id,object_key,scope,target,object_index,r2_version,r2_hash)
    SELECT ?,j.value->>'key',j.value->>'scope',j.value->>'target',j.value->>'index',j.value->>'version',j.value->>'hash'
    FROM json_each(?) j WHERE ${owns}
    ON CONFLICT(scan_id,object_key) DO UPDATE SET r2_version=excluded.r2_version,r2_hash=excluded.r2_hash`,scan.id,JSON.stringify(entries),scan.id,lease);
  await env.DB.batch([record,stmt(env.DB,`UPDATE public_projection_scan SET phase=?,prefix_index=?,cursor=?,
    listed_count=?,error=NULL WHERE id=? AND lease=?`,phase,nextPrefix,listed.truncated?listed.cursor:null,count,scan.id,lease)]);
}

async function compareItem(env:Env,config:Config,scan:Row,item:Row) {
  let expectedHash:string|null=null;
  let result='check_failed';
  try{
    if(item.expected_version===null){
      const current=await buildProjection(env.DB,item.scope,item.target,item.object_index,config.directTranslations,config.pageSize);
      result=current.data?'changed_during_scan':scan.include_orphans?'orphan':'ignored';
    }else{
      const current=await buildProjection(env.DB,item.scope,item.target,item.object_index,config.directTranslations,config.pageSize);
      if(current.version!==item.expected_version)result='changed_during_scan';
      else{
        expectedHash=await payloadHash(config.separateTranslations?splitLocaleData(current.data).source:current.data);
        result=item.r2_version===null?'missing'
          :item.r2_version<current.version?'outdated'
          :item.r2_version!==current.version?'mismatch'
          :item.r2_hash===expectedHash?'ok'
          :config.onDemand&&item.r2_hash===await payloadHash(config.separateTranslations?splitLocaleData({}).source:{})?'ignored':'mismatch';
        if(result==='ok'&&scan.deep){
          const object=await config.bucket.get(item.object_key);
          if(!object)result='missing';
          else{
            const envelope=await object.json() as Row;
            if(envelope.schemaVersion!==1||envelope.contentVersion!==current.version||
              (item.scope==='topic'&&envelope.topicId!==item.target)||await payloadHash(envelope.data)!==expectedHash)result='mismatch';
          }
        }
      }
    }
  }catch{result='check_failed';}
  return {expectedHash,result};
}

async function compareBatch(env:Env,config:Config,scan:Row,lease:string) {
  const items=await all(env.DB,`SELECT * FROM public_projection_scan_item WHERE scan_id=? AND result IS NULL
    ORDER BY object_key LIMIT ?`,scan.id,Math.min(scan.batch_size,CHECK_BATCH));
  const writes=[];
  for(const item of items){
    const {expectedHash,result}=await compareItem(env,config,scan,item);
    writes.push(stmt(env.DB,`UPDATE public_projection_scan_item SET expected_hash=?,result=?
      WHERE scan_id=? AND object_key=? AND result IS NULL AND ${owns}`,expectedHash,result,scan.id,item.object_key,scan.id,lease));
  }
  if(items.length){await env.DB.batch(writes);return;}
  // A write after the individual comparison must still show up in the report.
  await env.DB.batch([
    stmt(env.DB,`UPDATE public_projection_scan_item AS i SET result='changed_during_scan'
      WHERE scan_id=? AND expected_version IS NOT NULL AND expected_version IS NOT
      (SELECT version FROM public_projection p WHERE p.scope=i.scope AND p.target=i.target) AND ${owns}`,scan.id,scan.id,lease),
    stmt(env.DB,`UPDATE public_projection_scan SET phase=CASE
      WHEN EXISTS(SELECT 1 FROM public_projection_scan_item WHERE scan_id=? AND result IN ('check_failed','changed_during_scan'))
      OR EXISTS(SELECT 1 FROM public_projection p WHERE (? IS NULL OR (p.scope='topic' AND p.target=?))
        AND (NOT ? OR ${hasReservedPage('p')})
        AND NOT EXISTS(SELECT 1 FROM public_projection_scan_item i WHERE i.scan_id=? AND i.scope=p.scope AND i.target=p.target))
      THEN 'partial' ELSE 'complete' END,error=NULL WHERE id=? AND lease=?`,
      scan.id,scan.target,scan.target,Number(config.onDemand),scan.id,scan.id,lease)
  ]);
}

async function advanceScan(env:Env,config:Config,scan:Row) {
  const token=id();
  const lease=await one(env.DB,`UPDATE public_projection_scan SET lease=?,lease_until=?
    WHERE id=? AND phase IN ('listing','comparing') AND paused=0 AND lease_until<=? RETURNING *`,token,now()+90,scan.id,now());
  if(!lease)fail(409,'scan_busy_or_paused');
  try{
    if(lease.phase==='listing')await listBatch(env,config,lease,token);
    else await compareBatch(env,config,lease,token);
  }catch{
    await stmt(env.DB,`UPDATE public_projection_scan SET error='batch_failed_retry'
      WHERE id=? AND lease=?`,scan.id,token).run();
  }finally{
    await stmt(env.DB,'UPDATE public_projection_scan SET lease=NULL,lease_until=0 WHERE id=? AND lease=?',scan.id,token).run();
  }
}

async function repair(env:Env,config:Config,user:Row,scan:Row,input:Row) {
  if(!config.enabled||!config.purgeReady)fail(503,'projection_purge_not_configured');
  if(!['complete','partial'].includes(scan.phase))fail(409,'scan_not_finished');
  if(input.confirm!==true)fail(400,'repair_confirmation_required');
  if(!Array.isArray(input.keys)||input.keys.length<1||input.keys.length>REPAIR_BATCH||
    input.keys.some((key:unknown)=>typeof key!=='string'||key.length>220))fail(400,'invalid_repair_keys');
  const items=await all(env.DB,`SELECT * FROM public_projection_scan_item
    WHERE scan_id=? AND object_key IN (SELECT value FROM json_each(?))`,scan.id,JSON.stringify(input.keys));
  if(items.length!==new Set(input.keys).size||items.some(item=>
    !['missing','outdated','mismatch','orphan'].includes(item.result)||!parseObjectKey(item.object_key)))fail(400,'invalid_repair_keys');
  const writes=[];
  for(const item of items){
    if(item.repair_version!==null)continue;
    if(item.object_index>REPAIR_PAGE_LIMIT||Number(item.r2_version)>Number.MAX_SAFE_INTEGER-1000)fail(400,'repair_budget_exceeded');
    // Bump beyond the observed object and rebuild from current D1, not scan data.
    // An orphan is replaced with a versioned withdrawn envelope through the same outbox.
    writes.push(stmt(env.DB,`INSERT INTO public_projection(scope,target,version,last_object,priority)
      SELECT ?,?,?,?,2 WHERE EXISTS(SELECT 1 FROM public_projection_scan_item WHERE scan_id=? AND object_key=? AND repair_version IS NULL)
      ON CONFLICT(scope,target) DO UPDATE SET version=max(version+1,excluded.version),last_object=max(last_object,excluded.last_object),
        state='pending',priority=2,due_at=unixepoch(),updated_at=unixepoch(),next_object=1,attempts=0`,
      item.scope,item.target,Math.max(1,Number(item.r2_version)+1),config.onDemand?0:item.object_index,scan.id,item.object_key));
    if(config.onDemand)writes.push(stmt(env.DB,`INSERT INTO public_projection_demand(scope,target,object_index,reserved,pending)
      SELECT ?,?,?,1,? WHERE EXISTS(SELECT 1 FROM public_projection_scan_item WHERE scan_id=? AND object_key=? AND repair_version IS NULL)
      ON CONFLICT(scope,target,object_index) DO UPDATE SET reserved=1,pending=excluded.pending,
        attempts=0,last_error=NULL,due_at=unixepoch()`,item.scope,item.target,item.object_index,Number(item.result!=='orphan'),scan.id,item.object_key));
    writes.push(stmt(env.DB,`UPDATE public_projection_scan_item SET repair_version=
      (SELECT version FROM public_projection WHERE scope=? AND target=?) WHERE scan_id=? AND object_key=? AND repair_version IS NULL`,
      item.scope,item.target,scan.id,item.object_key));
  }
  if(writes.length)await env.DB.batch([...writes,audit(env,user,scan.id,'repair_confirmed',`${items.length} selected keys`)]);
  return json({scan:await scanReport(env,(await scanAt(env,scan.id))!,'')});
}

export async function projectionAdminRoute(req:Request,env:Env,user:Row|null,path:string):Promise<Response|null> {
  if(path!==ROOT&&!path.startsWith(ROOT+'/'))return null;
  const owner=requireRole(user,true),config=projectionConfig(env);
  if(!config)fail(503,'projection_not_configured');
  const url=new URL(req.url),operation=path.slice(ROOT.length);
  if(req.method==='GET'&&operation===''){
    const requested=url.searchParams.get('scan');
    const scan=requested?await scanAt(env,requested):await one(env.DB,
      'SELECT * FROM public_projection_scan WHERE environment=? ORDER BY created_at DESC,rowid DESC LIMIT 1',env.APP_ENV);
    const queue=await all(env.DB,`SELECT state,count(*) count,min(updated_at) oldest FROM (
      SELECT p.state,p.updated_at FROM public_projection p WHERE NOT ? OR ${hasReservedPage('p')}
      UNION ALL SELECT CASE WHEN d.pending=1 THEN 'pending' ELSE 'dead' END,p.updated_at
      FROM public_projection_demand d JOIN public_projection p USING(scope,target)
      WHERE ? AND (d.pending=1 OR d.last_error IS NOT NULL)
      ) GROUP BY state`,Number(config.onDemand),Number(config.onDemand));
    const failed=await all(env.DB,`SELECT scope,target,version,published_version,attempts,due_at,state,last_error,object_index
      FROM (SELECT scope,target,version,published_version,attempts,due_at,state,last_error,priority,updated_at,next_object object_index
        FROM public_projection WHERE last_error IS NOT NULL AND state<>'done'
        UNION ALL SELECT d.scope,d.target,p.version,p.published_version,d.attempts,d.due_at,
          CASE WHEN d.pending=1 THEN 'pending' ELSE 'dead' END,d.last_error,p.priority,p.updated_at,d.object_index
        FROM public_projection_demand d JOIN public_projection p USING(scope,target)
        WHERE ? AND d.last_error IS NOT NULL)
      ORDER BY priority DESC,updated_at LIMIT 25`,Number(config.onDemand));
    return json({scan:scan?await scanReport(env,scan,url.searchParams.get('after')||''):null,
      queue,failed:failed.map(row=>({...row,key:objectKey(row.scope,row.target,row.object_index,config.pageSize)})),purge_ready:config.purgeReady,enabled:config.enabled,preview:env.APP_ENV==='preview'});
  }
  if(req.method!=='POST')fail(405,'method_not_allowed');
  await rate(env.DB,'projection-admin:'+owner.id,30,60);
  const input=await body(req);
  if(operation==='/start'){
    await rate(env.DB,'projection-scans:'+owner.id,6,86400);
    return startScan(env,config,owner,input);
  }
  if(operation==='/drain'){
    if(env.APP_ENV!=='preview')fail(403,'preview_only');
    await rate(env.DB,'projection-drain:'+owner.id,12,60);
    return json(await drainPublicContent(env,4));
  }
  if(operation==='/retry'){
    if(!config.enabled||!config.purgeReady)fail(503,'projection_purge_not_configured');
    const key=typeof input.key==='string'&&parseObjectKey(input.key);
    if(!key||input.confirm!==true)fail(400,'repair_confirmation_required');
    await env.DB.batch([
      stmt(env.DB,`UPDATE public_projection SET state='pending',attempts=0,due_at=unixepoch()
        WHERE scope=? AND target=? AND state<>'done'`,key.scope,key.target),
      ...(config.onDemand?[stmt(env.DB,`UPDATE public_projection_demand
        SET pending=1,attempts=0,due_at=unixepoch(),last_error=NULL
        WHERE scope=? AND target=? AND object_index=? AND (pending=1 OR last_error IS NOT NULL)`,
        key.scope,key.target,key.index)]:[]),
      audit(env,owner,key.target,'retry_confirmed',key.scope)
    ]);
    return json({ok:true});
  }
  const scan=typeof input.scan==='string'?await scanAt(env,input.scan):null;
  if(!scan)fail(404,'scan_not_found');
  if(operation==='/repair')return repair(env,config,owner,scan,input);
  if(!['listing','comparing'].includes(scan.phase))fail(409,'scan_not_active');
  if(operation==='/step')await advanceScan(env,config,scan);
  else if(operation==='/pause'||operation==='/resume'||operation==='/cancel'){
    const changed=await one(env.DB,`UPDATE public_projection_scan SET paused=?,phase=CASE WHEN ? THEN 'partial' ELSE phase END,
      error=CASE WHEN ? THEN 'scan_cancelled' ELSE error END
      WHERE id=? AND phase IN ('listing','comparing') AND lease_until<=? RETURNING id`,
      operation==='/pause'?1:0,operation==='/cancel'?1:0,operation==='/cancel'?1:0,scan.id,now());
    if(!changed)fail(409,'scan_busy');
  }else fail(404,'not_found');
  return json({scan:await scanReport(env,(await scanAt(env,scan.id))!,'')});
}
