import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,writeFileSync,mkdirSync,readdirSync} from 'node:fs';
import ts from 'typescript';
import {spawnSync} from 'node:child_process';
mkdirSync('.test-build',{recursive:true});
for(const file of readdirSync('src').filter(f=>f.endsWith('.ts'))){const source=readFileSync('src/'+file,'utf8');const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace(/from '(\.\/[^']+)'/g,"from '$1.js'");writeFileSync('.test-build/'+file.replace('.ts','.js'),js);}
const {default:worker}=await import('../.test-build/index.js');
const {hash,now}=await import('../.test-build/core.js');
const {verifyGoogle}=await import('../.test-build/auth.js');
class D1 {
 constructor(){this.db=new DatabaseSync(':memory:');this.db.exec('PRAGMA foreign_keys=ON');for(const dir of ['migrations/v1','migrations/preview-only'])for(const f of readdirSync(dir).filter(f=>f.endsWith('.sql')).sort())this.db.exec(readFileSync(dir+'/'+f,'utf8'));}
 prepare(sql){return new Prepared(this,sql);}
 async batch(stmts){this.db.exec('BEGIN');try{const results=[];for(const s of stmts)results.push(await s.all());this.db.exec('COMMIT');return results;}catch(e){this.db.exec('ROLLBACK');throw e;}}
}
class Prepared {
 constructor(db,sql,args=[]){this.db=db;this.sql=sql;this.args=args;}
 bind(...args){return new Prepared(this.db,this.sql,args);}
 async all(){try{const s=this.db.db.prepare(this.sql);const rows=s.all(...this.args);return {results:rows,success:true,meta:{changes:Number(this.db.db.prepare('SELECT changes() c').get().c)}};}catch(e){e.message+=' SQL: '+this.sql;throw e;}}
 async first(col){const r=(await this.all()).results[0]||null;return col?r?.[col]:r;}
 async run(){return this.all();}
}
async function fixture(){const DB=new D1();for(const uid of ['alice','bob','carol','admin','mod']){DB.db.prepare('INSERT INTO users(id,nickname) VALUES(?,?)').run(uid,uid);DB.db.prepare('INSERT INTO user_sessions(id,user_id,token_hash,expires_at) VALUES(?,?,?,?)').run(uid,uid,await hash(uid+'-token'),now()+3600);}DB.db.exec("INSERT INTO user_roles(user_id,role) VALUES('admin','admin'),('mod','moderator')");
 const env={DB,ASSETS:{fetch:async()=>new Response('static')}};
 const call=async(path,method='GET',data,user='alice',extra={},ctx)=>{const headers={origin:'https://preview.test','user-agent':'Test Browser',...extra};if(user)headers.cookie='sc_session='+user+'-token';if(data!==undefined)headers['content-type']='application/json';const req=new Request('https://preview.test'+path,{method,headers,body:data===undefined?undefined:JSON.stringify(data)});const r=await worker.fetch(req,env,ctx);return {status:r.status,data:await r.json(),headers:r.headers};};
 const topic=async(title='A story of lower back pain',body='Pain when sitting and morning stiffness',user='alice',extra={})=>{const r=await call('/api/topics','POST',{title,body,source_lang:'en',...extra},user);assert.equal(r.status,201,JSON.stringify(r));return r.data.id;};
 return {DB,env,call,topic};
}
test('schema and constraints: all DDL, FKs, progress author and cross-topic parent',async()=>{const {DB,topic,call}=await fixture();const a=await topic(),b=await topic('Other','Other body');const c=await call('/api/topics/'+a+'/comments','POST',{body:'reply'},'bob');assert.equal(c.status,201);assert.throws(()=>DB.db.prepare("INSERT INTO comments(id,topic_id,author_id,parent_comment_id,body,status) VALUES('bad',?,'alice',?,'bad','published')").run(b,c.data.id));assert.throws(()=>DB.db.prepare("INSERT INTO comments(id,topic_id,author_id,kind,progress_seq,body,status) VALUES('bad2',?,'bob','progress',1,'bad','published')").run(a));assert.equal(DB.db.prepare('PRAGMA foreign_key_check').all().length,0);});
test('authentication, origin check, upload denial and ordinary publication',async()=>{const {call,topic}=await fixture();assert.equal((await call('/api/topics','POST',{title:'x',body:'y'},null)).status,401);assert.equal((await call('/api/topics','POST',{title:'x',body:'y'},'alice',{origin:'https://evil.test'})).status,403);assert.equal((await call('/api/uploads/a','GET',undefined,null)).status,403);assert.equal((await call('/api/auth/google','GET')).status,503);const id=await topic();const r=await call('/api/topics/'+id,'GET',undefined,null);assert.equal(r.status,200);assert.equal(r.data.topic.status,'published');assert.equal(r.data.topic.terms.length,0);});
test('unique idempotent likes, self-likes, undo, no self-notifications',async()=>{const {call,topic,DB}=await fixture();const id=await topic();for(let i=0;i<2;i++)assert.equal((await call('/api/topics/'+id+'/like','PUT',{},'alice')).data.like_count,1);assert.equal((await call('/api/notifications','GET')).data.unread,0);await call('/api/topics/'+id+'/like','PUT',{},'bob');assert.equal((await call('/api/notifications','GET')).data.unread,1);assert.equal((await call('/api/topics/'+id+'/like','DELETE',{},'bob')).data.like_count,1);assert.equal((await call('/api/notifications','GET')).data.unread,0);assert.equal(DB.db.prepare('SELECT count(*) n FROM topic_likes').get().n,1);});
test('progress authorship, independent bookmark/follow, notifications and direct replies',async()=>{const {call,topic}=await fixture();const id=await topic();await call('/api/topics/'+id+'/bookmark','PUT',{},'bob');await call('/api/topics/'+id+'/follow','PUT',{},'carol');assert.equal((await call('/api/topics/'+id+'/comments','POST',{body:'fake',kind:'progress'},'bob')).status,403);const p=await call('/api/topics/'+id+'/comments','POST',{body:'My first progress',kind:'progress'},'alice');assert.equal(p.status,201);assert.equal((await call('/api/notifications','GET',undefined,'bob')).data.unread,0);assert.equal((await call('/api/notifications','GET',undefined,'carol')).data.unread,1);assert.equal((await call('/api/notifications','GET',undefined,'alice')).data.unread,0);const r=await call('/api/topics/'+id+'/comments','POST',{body:'Thank you',parent_comment_id:p.data.id},'bob');assert.equal(r.status,201);const detail=await call('/api/topics/'+id);assert.equal(detail.data.progress[0].id,p.data.id);assert.equal(detail.data.comments.filter(c=>c.id===p.data.id).length,1);assert.equal(detail.data.comments[0].progress_seq,1);});
test('deletion removes source, cached translations and FTS but preserves other replies',async()=>{const {call,topic,DB}=await fixture();const id=await topic('Sensitive heading','Sensitive body'),reply=await call('/api/topics/'+id+'/comments','POST',{body:'Other participant'},'bob');DB.db.prepare("INSERT INTO topic_translations(topic_id,locale,source_version,title_text,body_text,provider) VALUES(?,'zh-CN',1,'缓存标题','缓存正文','test')").run(id);assert.equal((await call('/api/topics/'+id,'DELETE',{},'bob')).status,403);await call('/api/topics/'+id,'DELETE',{},'alice');const r=await call('/api/topics/'+id,'GET',undefined,null);assert.equal(r.data.topic.body,null);assert.equal(r.data.topic.title,null);assert.equal(r.data.comments[0].id,reply.data.id);assert.equal(DB.db.prepare('SELECT count(*) n FROM topic_translations').get().n,0);assert.equal(DB.db.prepare('SELECT count(*) n FROM topics_search WHERE topic_id=?').get(id).n,0);assert.equal((await call('/api/translate','POST',{id,type:'topic',locale:'zh-CN'})).status,404);assert.equal((await call('/api/topics?q=Sensitive')).data.topics.length,0);});
test('deleted parent comment keeps children, invalidates translation and count',async()=>{const {call,topic,DB}=await fixture();const id=await topic(),a=await call('/api/topics/'+id+'/comments','POST',{body:'parent'},'bob');await call('/api/topics/'+id+'/comments','POST',{body:'child',parent_comment_id:a.data.id},'carol');DB.db.prepare("INSERT INTO comment_translations(comment_id,locale,source_version,body_text,provider) VALUES(?,'zh-CN',1,'私密缓存','test')").run(a.data.id);await call('/api/comments/'+a.data.id,'DELETE',{},'bob');const detail=await call('/api/topics/'+id);assert.equal(detail.data.comments[0].body,null);assert.equal(detail.data.comments[1].body,'child');assert.equal(detail.data.topic.reply_count,1);assert.equal(DB.db.prepare('SELECT count(*) n FROM comment_translations').get().n,0);});
test('seven-language concepts, untagged text, Chinese short terms and strict/similar filters',async()=>{const {call,topic}=await fixture();const id=await topic();for(const q of ['腰痛','dor lombar','lombalgie','坐着疼','morning stiffness','腰椎']){const r=await call('/api/topics?q='+encodeURIComponent(q));assert.equal(r.status,200,JSON.stringify(r));assert(r.data.topics.some(x=>x.id===id),q);}const zh=await topic('长期腰痛久坐','这些是无标签的两字搜索测试','bob',{source_lang:'zh-CN'});assert((await call('/api/topics?q='+encodeURIComponent('腰痛'))).data.topics.some(x=>x.id===zh));const filtered=await call('/api/topics?body_part=neck&treatment=surgery');assert.equal(filtered.data.topics.length,0);const similar=await call('/api/topics?q='+encodeURIComponent('腰痛')+'&body_part=neck');assert.equal(similar.data.similar,true);assert(similar.data.topics[0].relaxed.includes('body_part'));});
test('moderation low/medium/high, report count never hides, role revocation is immediate',async()=>{const {call,topic,DB}=await fixture();const id=await topic();for(const uid of ['alice','bob','carol','mod'])await call('/api/reports','POST',{type:'topic',id,reason:'Concern'},uid);assert.equal((await call('/api/topics/'+id,'GET',undefined,null)).data.topic.status,'published');assert.equal((await call('/api/admin/overview','GET',undefined,'bob')).status,403);assert.equal((await call('/api/admin/content','POST',{type:'topic',id,action:'delete',reason:'test'},'mod')).status,403);assert.equal((await call('/api/admin/content','POST',{type:'topic',id,action:'hide',reason:'test'},'mod')).status,200);assert.equal((await call('/api/topics/'+id,'GET',undefined,null)).status,404);await call('/api/admin/content','POST',{type:'topic',id,action:'publish',reason:'restore'},'admin');await call('/api/admin/roles','POST',{user_id:'mod',enabled:false,reason:'revoke'},'admin');assert.equal((await call('/api/admin/overview','GET',undefined,'mod')).status,403);const mid=await topic('Links','https://a.test https://b.test https://c.test','bob');assert.equal((await call('/api/topics/'+mid,'GET',undefined,null)).status,404);assert.equal((await call('/api/topics/'+mid,'GET',undefined,'bob')).data.topic.status,'pending_review');const blocked=await topic('guaranteed cure','buy now https://scam.test','carol');assert.equal((await call('/api/topics/'+blocked,'GET',undefined,'carol')).data.topic.status,'blocked');assert.equal((await call('/api/appeals','POST',{type:'topic',id:blocked,reason:'Please review'},'carol')).status,201);});
test('sanctions protect all writes, permissions hide identity credentials',async()=>{const {call,topic}=await fixture();const id=await topic();assert.equal((await call('/api/admin/sanctions','POST',{user_id:'bob',action:'mute',days:2,reason:'bad duration'},'mod')).status,400);await call('/api/admin/sanctions','POST',{user_id:'bob',action:'mute',days:1,reason:'test'},'mod');assert.equal((await call('/api/topics/'+id+'/comments','POST',{body:'should be denied'},'bob')).status,403);assert.equal((await call('/api/admin/sanctions','POST',{user_id:'carol',action:'ban',reason:'test'},'mod')).status,403);const admin=await call('/api/admin/overview','GET',undefined,'mod');assert.equal(admin.data.users.length,0);const serialized=JSON.stringify(admin.data);assert(!serialized.includes('token_hash'));assert(!serialized.includes('provider_subject'));});
test('translation disabled fallback and editing invalidates old versions',async()=>{const {call,topic,DB}=await fixture();const id=await topic();assert.equal((await call('/api/translate','POST',{type:'topic',id,locale:'zh-CN'})).data.reason,'translation_not_configured');DB.db.prepare("INSERT INTO topic_translations(topic_id,locale,source_version,title_text,body_text,provider) VALUES(?,'zh-CN',1,'旧标题','旧正文','test')").run(id);await call('/api/topics/'+id,'PATCH',{title:'Edited',body:'Edited text',source_lang:'en',symptom_duration_days:55});assert.equal(DB.db.prepare('SELECT count(*) n FROM topic_translations').get().n,0);assert.equal((await call('/api/topics/'+id)).data.topic.symptom_duration_days,55);});
test('translation quota diagnostics are read-only and owner-only',async()=>{
 const {env,DB,call}=await fixture();
 const day=new Date().toISOString().slice(0,10),month=day.slice(0,7);
 Object.assign(env,{TRANSLATION_DAILY_LIMIT:'100',TRANSLATION_MONTHLY_LIMIT:'300',
   TRANSLATOR_F0_VERIFIED_AT:new Date(Date.now()-60000).toISOString()});
 DB.db.prepare("UPDATE settings SET value='true' WHERE key='translation_enabled'").run();
 DB.db.prepare(`UPDATE translation_budget SET day_utc=?,month_utc=?,day_chars=100,month_chars=180,
   cooldown_until=0,provider_blocked_at=0 WHERE id=1`).run(day,month);
 DB.db.prepare("INSERT INTO translation_usage_daily(provider,day_utc,characters,requests) VALUES('azure',?,250,1)").run(day);
 assert.equal((await call('/api/admin/translation-budget','GET',undefined,null)).status,401);
 assert.equal((await call('/api/admin/translation-budget','GET',undefined,'mod')).status,403);
 const response=await call('/api/admin/translation-budget','GET',undefined,'admin');
 assert.equal(response.status,200,JSON.stringify(response));
 const budget=response.data;
 assert.equal(budget.dayUTC,day);
 assert.deepEqual(budget.daily,{limit:100,reserved:100,remaining:0});
 assert.deepEqual(budget.monthly,{limit:300,reserved:180,remaining:120});
 assert.deepEqual(budget.rolling31Day,{limit:300,recorded:250,remaining:50});
 assert(budget.blockers.includes('daily_limit_reached'));
 assert.equal(budget.provider.cooldownActive,false);
 assert.equal(budget.provider.blockedSinceVerification,false);
 assert.equal(DB.db.prepare('SELECT day_chars FROM translation_budget WHERE id=1').get().day_chars,100);
});

test('administrator can set Azure budgets without resetting usage or enabling unintegrated providers',async t=>{
 const {call,env,DB,topic}=await fixture();
 mockTranslator(env,DB);
 const before=await call('/api/admin/translation-providers','GET',undefined,'admin');
 assert.equal(before.status,200,JSON.stringify(before));
 assert.equal(before.data.activeProvider,'azure');
 const azure=before.data.providers.find(p=>p.id==='azure'),ali=before.data.providers.find(p=>p.id==='aliyun');
 assert.equal(azure.daily.limit,200000);
 assert.equal(azure.monthly.limit,1800000);
 assert.equal(azure.freeMonthly,2000000);
 assert.equal(ali.implemented,false);
 assert.equal(ali.selectable,false);
 assert.equal((await call('/api/admin/translation-providers','GET',undefined,null)).status,401);
 assert.equal((await call('/api/admin/translation-providers','GET',undefined,'mod')).status,403);
 const save=async(daily,monthly,provider='azure')=>call('/api/admin/translation-providers','POST',
  {provider,active_provider:provider,daily_limit:daily,monthly_limit:monthly},'admin');
 assert.equal((await save(200000,2000000)).status,400);
 assert.equal((await save(300,200)).status,400);
 assert.equal((await save(200,500,'aliyun')).status,400);
 assert.equal((await call('/api/admin/translation-providers','POST',{
  provider:'azure',active_provider:'azure',daily_limit:200,monthly_limit:500},'mod')).status,403);
 const day=new Date().toISOString().slice(0,10),month=day.slice(0,7);
 DB.db.prepare("UPDATE translation_budget SET day_utc=?,month_utc=?,day_chars=150,month_chars=150 WHERE id=1").run(day,month);
 const changed=await save(200,500);
 assert.equal(changed.status,200,JSON.stringify(changed));
 assert.equal(changed.data.providers.find(p=>p.id==='azure').daily.remaining,50);
 assert.equal(DB.db.prepare('SELECT day_chars FROM translation_budget WHERE id=1').get().day_chars,150);
 assert.equal(DB.db.prepare("SELECT value FROM settings WHERE key='translation_azure_daily_limit'").get().value,'200');
 const tid=await topic('Test Azure quota','Text longer than fifty characters that cannot fit the remaining daily budget.');
 let requestCount=0;
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  requestCount++;
  return translatedByMock(url,options);
 });
 const denied=await translationBatch(call,[translationItem(tid)],{locale:'zh-CN'});
 assert.equal(denied.data.items[0].reason,'translation_quota_reached',JSON.stringify(denied.data));
 assert.equal(requestCount,0);
 const allowed=await save(300,500);
 assert.equal(allowed.status,200);
 const success=await translationBatch(call,[translationItem(tid)],{locale:'zh-CN'});
 assert.equal(success.data.items[0].translated,true,JSON.stringify(success.data));
 assert.equal(requestCount,1);
 assert.equal((await call('/api/admin/translation-providers','GET',undefined,'admin')).data.providers[0].daily.limit,300);
 assert.equal(DB.db.prepare("SELECT count(*) n FROM moderation_actions WHERE target_id='translation_azure_budget'").get().n,2);
});

test('entry HTML prevents stale SPA modules and versioning preserves admin navigation',async()=>{
 const source=readFileSync('scripts/prepare-build.mjs','utf8');
 assert.match(source,/createVersionedFrontend/);
 assert.match(source,/createHash\('sha256'\)/);
 assert.match(source,/\/\_app\//);
 const app=readFileSync('public/app.js','utf8');
 assert.match(app,/translationProviders/);
 assert.match(app,/languageReview/);
 const {DB,env}=await fixture();
 const origin='https://preview.test';
 const response=await worker.fetch(new Request(origin+'/?utm_source=chatgpt.com'),
  {...env,APP_ENV:'preview',ASSETS:{fetch:async()=>new Response('<html>test</html>',{
   headers:{'content-type':'text/html','cache-control':'public, max-age=31536000'}
  })}});
 assert.equal(response.status,200);
 assert.equal(response.headers.get('cache-control'),'no-store, max-age=0');
 assert.equal(response.headers.get('pragma'),'no-cache');
 assert.equal(response.headers.get('x-robots-tag'),'noindex, nofollow');
});

test('deployed browser modules pass JavaScript syntax validation',async()=>{
 const {spawnSync}=await import('node:child_process');
 for(const path of ['public/app.js','public/translation-admin.js','public/language-admin.js','public/i18n.js','public/i18n-zh-tw.js','public/public-content.js','public/translation-ui.js']){
  const result=spawnSync(process.execPath,['--check',path],{encoding:'utf8'});
  assert.equal(result.status,0,path+' browser syntax error:\n'+result.stderr);
 }
});

test('translation provider editor renders independent Azure budget and unavailable Aliyun',async()=>{
 const app=readFileSync('public/app.js','utf8'),view=readFileSync('public/translation-admin.js','utf8');
 assert.match(app,/translationProviders/);
 assert.match(app,/id==='translation-provider-form'/);
 assert.match(view,/name="daily_limit"/);
 assert.match(view,/name="monthly_limit"/);
 assert.match(view,/name="active_provider"/);
 assert.match(view,/not_integrated/);
 const {renderTranslationAdmin}=await import('../public/translation-admin.js');
 const target={innerHTML:''};
 await renderTranslationAdmin(target,async()=>({activeProvider:'azure',capMonthly:1900000,providers:[
  {id:'azure',name:'Azure',active:true,implemented:true,selectable:true,freeMonthly:2000000,
   status:'ready',daily:{limit:200000,reserved:9982,remaining:190018},
   monthly:{limit:1800000,reserved:9982,remaining:1790018},
   rolling31Day:{limit:1800000,recorded:9982,remaining:1790018}},
  {id:'aliyun',name:'Alibaba',active:false,implemented:false,selectable:false,status:'not_integrated'}
 ]}),x=>String(x),'zh-CN');
 assert.match(target.innerHTML,/value="200000"/);
 assert.match(target.innerHTML,/value="1800000"/);
 assert.match(target.innerHTML,/max="1900000"/);
 assert.match(target.innerHTML,/Alibaba/);
 assert.match(target.innerHTML,/value="aliyun"[^>]*disabled/);
 assert.match(target.innerHTML,/不能启用/);
});

test('translation reservation hard limit and race with deletion',async()=>{const {call,topic,env,DB}=await fixture();const id=await topic('A title','A longer body for translating');Object.assign(env,{TRANSLATION_ENABLED:'true',TRANSLATOR_KEY:'test',TRANSLATOR_F0_VERIFIED_AT:new Date(Date.now()-60000).toISOString(),TRANSLATION_DAILY_LIMIT:'60',TRANSLATION_MONTHLY_LIMIT:'60'});DB.db.exec("UPDATE settings SET value='true' WHERE key='translation_enabled'");const original=globalThis.fetch;let requests=0;globalThis.fetch=async()=>{requests++;await call('/api/topics/'+id,'DELETE',{},'alice');return Response.json([{translations:[{text:'标题'}]},{translations:[{text:'正文'}]}]);};try{const r=await call('/api/translate','POST',{type:'topic',id,locale:'zh-CN'});assert.equal(r.data.translated,false);assert.equal(DB.db.prepare('SELECT count(*) n FROM topic_translations').get().n,0);const id2=await topic('Another title','Enough text to hit monthly limit');const result=await call('/api/translate','POST',{type:'topic',id:id2,locale:'zh-CN'});assert.equal(result.data.reason,'translation_quota_reached');assert.equal(requests,1);}finally{globalThis.fetch=original;}});
test('pageview metrics require site-owner opt-in and exclude ordinary API requests',async()=>{
 const {call,topic,DB}=await fixture();
 await topic();await call('/api/topics');
 assert.equal(DB.db.prepare('SELECT count(*) n FROM daily_traffic_metrics').get().n,0);
 const disabled=await call('/api/pageview','POST',{path:'/'});
 assert.equal(disabled.status,200);
 assert.equal(disabled.data.recorded,false);
 assert.equal(disabled.data.reason,'analytics_disabled');
 assert.equal(DB.db.prepare('SELECT count(*) n FROM daily_traffic_metrics').get().n,0);
 assert.equal((await call('/api/health')).data.analyticsEnabled,false);
 assert.equal((await call('/api/admin/overview','GET',undefined,'admin')).data.analyticsEnabled,false);
 const payload={key:'analytics_enabled',value:'true',reason:'Enable traffic stats in admin UI'};
 assert.equal((await call('/api/admin/settings','POST',payload,'alice')).status,403);
 assert.equal((await call('/api/admin/settings','POST',payload,'mod')).status,403);
 assert.equal((await call('/api/admin/settings','POST',{...payload,value:'yes'},'admin')).status,400);
 assert.equal((await call('/api/admin/settings','POST',{...payload,key:'unknown'},'admin')).status,400);
 assert.equal((await call('/api/admin/settings','POST',payload,'admin')).status,200);
 assert.equal((await call('/api/health')).data.analyticsEnabled,true);
 assert.equal((await call('/api/admin/overview','GET',undefined,'admin')).data.analyticsEnabled,true);
 const first=await call('/api/pageview','POST',{path:'/'});
 assert.equal(first.status,200,JSON.stringify(first));
 assert.equal(first.data.recorded,true);
 const visitorCookie=first.headers.get('set-cookie')?.match(/sc_visitor=([^;]+)/)?.[1];
 assert(visitorCookie);
 const second=await call('/api/pageview','POST',{path:'/topic/example'},null,{cookie:'sc_visitor='+visitorCookie});
 assert.equal(second.data.recorded,true);
 assert.equal(DB.db.prepare('SELECT pv FROM daily_traffic_metrics').get().pv,2);
 assert.equal(DB.db.prepare('SELECT uv_estimate FROM daily_traffic_metrics').get().uv_estimate,1);
 assert.equal(DB.db.prepare('SELECT count(*) n FROM traffic_visitors').get().n,1);
 assert.equal((await call('/api/admin/settings','POST',{key:'analytics_enabled',value:'false',reason:'Disable traffic stats'},'admin')).status,200);
 assert.equal((await call('/api/health')).data.analyticsEnabled,false);
 assert.equal((await call('/api/pageview','POST',{path:'/topic/example'})).data.recorded,false);
 assert.equal(DB.db.prepare('SELECT pv FROM daily_traffic_metrics').get().pv,2);
 assert.equal((await call('/api/admin/overview','GET',undefined,'admin')).data.metrics[0].pv,2);
 assert.equal(DB.db.prepare("SELECT count(*) n FROM moderation_actions WHERE target_id='analytics_enabled'").get().n,2);
 assert.equal((await call('/api/me/export')).data.profile.id,'alice');
 assert.equal((await call('/api/privacy-requests','POST',{type:'account_delete'})).status,201);
 assert.equal((await call('/api/privacy-requests')).data.items.length,1);
});

test('traffic switch is available in community analytics with client/server off gates',()=>{
 const app=readFileSync('public/app.js','utf8');
 const server=readFileSync('src/community.ts','utf8');
 const locale=readFileSync('public/i18n.js','utf8');
 assert.match(app,/data-action="toggle-analytics"/);
 assert.match(app,/state\.user\.role==='admin'\?/);
 assert.match(app,/if\(action==='toggle-analytics'\)/);
 assert.match(app,/state\.health\?\.analyticsEnabled===true\)send\('\/api\/pageview'/);
 assert.match(server,/if\(!await analyticsEnabled\(env.DB\)\)return json\(\{ok:true,recorded:false,reason:'analytics_disabled'\}\)/);
 assert.doesNotMatch(server,/ANALYTICS_SALT/);
 assert.match(locale,/analyticsToggle:/);
 assert.match(locale,/analyticsEnable:/);
});
test('notification focus can reach comments after page one and progress-only pagination works',async()=>{const {call,topic,DB}=await fixture();const id=await topic();for(let i=0;i<55;i++)DB.db.prepare("INSERT INTO comments(id,topic_id,author_id,body,status) VALUES(?,?,'bob',?,'published')").run('c'+i,id,'Reply '+i);const r=await call('/api/topics/'+id+'?focus=c54');assert.equal(r.status,200);assert(r.data.comments.some(c=>c.id==='c54'));});
test('Google JWT signature, audience, nonce and expiration verification',async()=>{const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);const jwk=await crypto.subtle.exportKey('jwk',pair.publicKey);const encode=o=>Buffer.from(JSON.stringify(o)).toString('base64url');const make=async extra=>{const h=encode({alg:'RS256',kid:'test'}),p=encode({iss:'https://accounts.google.com',aud:'client',sub:'google-user',nonce:'nonce',iat:now(),exp:now()+300,...extra});const sig=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(h+'.'+p));return h+'.'+p+'.'+Buffer.from(sig).toString('base64url');};const original=globalThis.fetch;globalThis.fetch=async()=>Response.json({keys:[{...jwk,kid:'test'}]});try{assert.equal((await verifyGoogle(await make({}),'client','nonce')).sub,'google-user');await assert.rejects(()=>verifyGoogle(makeToken,'client','bad'));const bad=await make({aud:'evil'});await assert.rejects(()=>verifyGoogle(bad,'client','nonce'));const expired=await make({exp:now()-1});await assert.rejects(()=>verifyGoogle(expired,'client','nonce'));const nonce=await make({nonce:'wrong'});await assert.rejects(()=>verifyGoogle(nonce,'client','nonce'));}finally{globalThis.fetch=original;}var makeToken='invalid';});
test('owner fulfils deletion request: source/cache removal, sessions revoked, other replies intact',async()=>{const {call,topic,DB}=await fixture();const id=await topic('My test data','A private detail','bob');const c=await call('/api/topics/'+id+'/comments','POST',{body:'Another person reply'},'carol');await call('/api/privacy-requests','POST',{type:'account_delete'},'bob');const p=DB.db.prepare("SELECT id FROM privacy_requests WHERE user_id='bob'").get().id;const r=await call('/api/admin/privacy','POST',{id:p,status:'fulfill',reason:'Test user request'},'admin');assert.equal(r.status,200,JSON.stringify(r));assert.equal((await call('/api/me','GET',undefined,'bob')).data.user,null);const detail=await call('/api/topics/'+id,'GET',undefined,null);assert.equal(detail.data.topic.body,null);assert(detail.data.comments.some(x=>x.id===c.data.id));assert.equal(DB.db.prepare('PRAGMA foreign_key_check').all().length,0);});
test('editing a manually hidden post cannot bypass moderator review',async()=>{const {call,topic}=await fixture();const id=await topic();await call('/api/admin/content','POST',{type:'topic',id,action:'hide',reason:'Needs review'},'admin');const edited=await call('/api/topics/'+id,'PATCH',{title:'Changed title',body:'Changed body'},'alice');assert.equal(edited.data.status,'pending_review');assert.equal((await call('/api/topics/'+id,'GET',undefined,null)).status,404);});

const IMPORT_ORIGIN='https://feature-v1-community-build-20261106-spine-community.119shenhao.workers.dev';
async function importFixture(){
 const f=await fixture();Object.assign(f.env,{APP_ENV:'preview',IMPORT_ENABLED:'true',IMPORT_DB:f.DB});
 f.imp=async(path,data,options={})=>{
  const req=new Request((options.origin||IMPORT_ORIGIN)+path,{method:options.method||'POST',headers:{'content-type':'application/json',...options.headers},body:data===undefined?undefined:JSON.stringify(data)});
  const res=await worker.fetch(req,options.env||f.env);
  return {status:res.status,data:await res.json()};
 };
 return f;
}
test('imports fail closed before any DB access for production, missing config and spoofed origin',async()=>{
 const poison={prepare(){throw Error('DB accessed');},batch(){throw Error('DB accessed');}};
 const good={APP_ENV:'preview',IMPORT_ENABLED:'true',DB:poison,IMPORT_DB:poison};
 for(const env of [{},{...good,APP_ENV:'production'},{...good,IMPORT_ENABLED:'false'},{...good,IMPORT_DB:undefined},{...good,APP_ENV:undefined}]){
  for(const method of ['POST','GET','OPTIONS']){
   const r=await worker.fetch(new Request(IMPORT_ORIGIN+'/api/import/batch?APP_ENV=preview&IMPORT_ENABLED=true',{method,headers:{authorization:'Bearer fake'}}),env);
   assert.equal(r.status,403);assert.equal((await r.json()).error,'import_disabled');
  }
 }
 for(const origin of ['https://spine-community.119shenhao.workers.dev','https://evil.test']){
  const r=await worker.fetch(new Request(origin+'/api/import/batch',{method:'POST',headers:{host:new URL(IMPORT_ORIGIN).host}}),good);
  assert.equal((await r.json()).error,'import_disabled');
 }
});
test('unknown user is seeded once and cannot obtain identity, session, role or login',async()=>{
 const {DB,imp,env}=await importFixture();
 for(let i=0;i<2;i++)assert.deepEqual((await imp('/api/import/account',undefined,{method:'GET'})).data.account,{id:'system-unknown-import',nickname:'Anonymous',canLogin:false});
 const uid='system-unknown-import';
 assert.equal(DB.db.prepare('SELECT count(*) n FROM users WHERE is_system=1').get().n,1);
 assert.throws(()=>DB.db.prepare("INSERT INTO auth_identities(id,user_id,provider,provider_subject) VALUES('fake',?,'google','fake')").run(uid));
 assert.throws(()=>DB.db.prepare("INSERT INTO user_sessions(id,user_id,token_hash,expires_at) VALUES('fake',?,'fake',9999999999)").run(uid));
 assert.throws(()=>DB.db.prepare("INSERT INTO user_roles(user_id,role) VALUES(?,'admin')").run(uid));
 // Even if a future bug bypasses the DB trigger, the Worker refuses a system account session.
 DB.db.exec('DROP TRIGGER system_session_insert');
 DB.db.prepare('INSERT INTO user_sessions(id,user_id,token_hash,expires_at) VALUES(?,?,?,?)').run('forged',uid,await hash('forged'),now()+300);
 const r=await worker.fetch(new Request(IMPORT_ORIGIN+'/api/me',{headers:{cookie:'sc_session=forged'}}),env);
 assert.equal((await r.json()).user,null);
 DB.db.exec('DROP TRIGGER system_identity_insert');
 DB.db.prepare("INSERT INTO auth_identities(id,user_id,provider,provider_subject) VALUES('bad',?,'google','fake')").run(uid);
 const {login}=await import('../.test-build/auth.js');
 await assert.rejects(()=>login(new Request(IMPORT_ORIGIN),env,'fake'),e=>e.status===403);
});
test('anonymous batch imports all content as unknown user with nesting, search, counts and no progress',async()=>{
 const {DB,imp,call}=await importFixture();
 const r=await imp('/api/import/batch',{topics:[{title:'Import feature test',body:'Fictional development text',source_lang:'en',terms:['lower-back'],comments:[{body:'Parent reply',replies:[{body:'Nested reply'}]}]},{title:'Second test',body:'More fictional development text'}]});
 assert.equal(r.status,201,JSON.stringify(r));
 assert.equal(r.data.imported.topics,2);assert.equal(r.data.imported.comments,2);
 const tid=r.data.results[0].id;
 const detail=await call('/api/topics/'+tid,'GET',undefined,null);
 assert.equal(detail.data.topic.nickname,'Anonymous');assert.equal(detail.data.topic.reply_count,2);
 assert.equal(detail.data.comments[1].parent_comment_id,detail.data.comments[0].id);
 assert(detail.data.comments.every(c=>c.author_id==='system-unknown-import'&&c.nickname==='Anonymous'&&c.kind==='regular'&&c.progress_seq===null));
 assert.equal(detail.data.progress.length,0);assert.equal(DB.db.prepare('SELECT count(*) n FROM notifications').get().n,0);
 assert((await call('/api/topics?q=Import')).data.topics.some(t=>t.id===tid));
 assert.equal(DB.db.prepare('PRAGMA foreign_key_check').all().length,0);
});
test('single-topic and existing-topic replies import without cookies or origin, and cannot edit or impersonate',async()=>{
 const {imp,call,DB}=await importFixture();
 const t=await imp('/api/import/topics',{title:'Standalone test topic',body:'Fictional test content'});assert.equal(t.status,201,JSON.stringify(t));
 const tid=t.data.results[0].id;
 const a=await imp('/api/import/comments',{topic_id:tid,body:'First test reply'});assert.equal(a.status,201);
 const b=await imp('/api/import/comments',{topic_id:tid,parent_comment_id:a.data.results[0].id,body:'Child test reply'});assert.equal(b.status,201);
 assert.equal((await call('/api/topics/'+tid,'GET',undefined,null)).data.topic.reply_count,2);
 assert.equal((await imp('/api/import/topics',{title:'bad',body:'bad',author_id:'admin'})).status,400);
 assert.equal((await imp('/api/import/comments',{topic_id:tid,body:'bad',kind:'progress'})).status,400);
 assert.equal((await imp('/api/import/topics',{title:'bad',body:'bad',source_url:'https://example.test'})).status,400);
 assert.equal((await imp('/api/import/topics',{}, {method:'PATCH'})).status,405);
 assert.equal((await call('/api/topics/'+tid,'PATCH',{title:'tamper',body:'tamper'},null)).status,401);
 assert.equal((await call('/api/topics/'+tid,'PATCH',{title:'tamper',body:'tamper'},'alice')).status,403);
 assert.equal(DB.db.prepare('SELECT count(*) n FROM auth_identities WHERE user_id=?').get('system-unknown-import').n,0);
});
test('identical imports replay the original IDs without duplicate content, counters or metrics',async()=>{
 const {imp,DB}=await importFixture();
 const a=await imp('/api/import/topics',{title:'Replay test',body:'Replay body',comments:[{body:'Replay reply'}]});
 const b=await imp('/api/import/topics',{comments:[{body:'Replay reply'}],body:'Replay body',title:'Replay test'});
 assert.equal(a.status,201);assert.equal(b.status,200);assert.equal(b.data.replayed,true);assert.deepEqual(a.data.results,b.data.results);
 assert.equal(DB.db.prepare('SELECT count(*) n FROM topics').get().n,1);assert.equal(DB.db.prepare('SELECT count(*) n FROM comments').get().n,1);
 assert.equal(DB.db.prepare('SELECT new_topics FROM daily_community_metrics').get().new_topics,1);
});
test('cross-topic, missing and hidden parent rejection keeps batches atomic',async()=>{
 const {imp,DB}=await importFixture();
 const a=await imp('/api/import/topics',{title:'First',body:'First body',comments:[{body:'First reply'}]});
 const b=await imp('/api/import/topics',{title:'Second',body:'Second body'});
 const tid=b.data.results[0].id,cid=a.data.results[1].id;
 const before=DB.db.prepare('SELECT count(*) n FROM topics').get().n;
 const cross=await imp('/api/import/batch',{topics:[{title:'Must rollback',body:'Not saved'}],comments:[{topic_id:tid,parent_comment_id:cid,body:'Wrong parent'}]});
 assert.equal(cross.status,400);assert.equal(cross.data.error,'cross_topic_reply');
 assert.equal(DB.db.prepare('SELECT count(*) n FROM topics').get().n,before);
 assert.equal((await imp('/api/import/comments',{topic_id:tid,parent_comment_id:'missing',body:'test'})).status,404);
 DB.db.prepare("UPDATE comments SET status='hidden' WHERE id=?").run(cid);
 assert.equal((await imp('/api/import/comments',{topic_id:a.data.results[0].id,parent_comment_id:cid,body:'test'})).status,404);
 DB.db.prepare("UPDATE topics SET status='hidden' WHERE id=?").run(tid);
 assert.equal((await imp('/api/import/comments',{topic_id:tid,body:'test'})).status,404);
});
test('import validation limits, moderation and origin checks remain active',async()=>{
 const {imp,DB}=await importFixture();
 assert.equal((await imp('/api/import/batch',{})).status,400);
 assert.equal((await imp('/api/import/topics',{title:'',body:'test'})).status,400);
 assert.equal((await imp('/api/import/batch',{topics:Array.from({length:11},()=>({title:'test',body:'test'}))})).data.error,'too_many_topics');
 assert.equal((await imp('/api/import/topics',{title:'test',body:'test',comments:Array.from({length:50},()=>({body:'test'}))})).data.error,'too_many_items');
 assert.equal((await imp('/api/import/topics',{title:'test',body:'x'.repeat(150001)})).status,413);
 assert.equal((await imp('/api/import/topics',{title:'test',body:'test'},{headers:{origin:'https://evil.test'}})).status,403);
 assert.equal((await imp('/api/import/topics',{title:'test',body:'test'},{headers:{'content-type':'text/plain'}})).status,415);
 let deep={body:'deep'};for(let i=0;i<8;i++)deep={body:'deep',replies:[deep]};
 assert.equal((await imp('/api/import/topics',{title:'deep',body:'test',comments:[deep]})).data.error,'reply_depth_exceeded');
 const blocked=await imp('/api/import/topics',{title:'guaranteed cure',body:'buy now https://scam.test'});assert.equal(blocked.data.results[0].status,'blocked');
 assert.equal(DB.db.prepare('SELECT count(*) n FROM topics_search').get().n,0);
});
test('database failure rolls back content and replay record so retry can succeed',async()=>{
 const {imp,DB}=await importFixture();
 DB.db.exec("CREATE TRIGGER forced_import_failure BEFORE INSERT ON topics BEGIN SELECT RAISE(ABORT,'test failure'); END");
 const payload={title:'Rollback test',body:'Rollback text'};
 assert.equal((await imp('/api/import/topics',payload)).status,503);
 assert.equal(DB.db.prepare('SELECT count(*) n FROM import_batches').get().n,0);
 assert.equal(DB.db.prepare('SELECT count(*) n FROM topics').get().n,0);
 DB.db.exec('DROP TRIGGER forced_import_failure');
 assert.equal((await imp('/api/import/topics',payload)).status,201);
});
test('preview import uses only IMPORT_DB and never falls back to the normal DB binding',async()=>{
 const {imp,env,DB}=await importFixture();
 env.DB={prepare(){throw Error('Wrong database');},batch(){throw Error('Wrong database');}};
 assert.equal((await imp('/api/import/topics',{title:'Isolated',body:'Isolated test'})).status,201);
 assert.equal(DB.db.prepare('SELECT count(*) n FROM topics').get().n,1);
 for(let i=0;i<30;i++)await imp('/api/import/batch',{comments:[]});
 assert.equal((await imp('/api/import/topics',{title:'Over limit',body:'test'})).status,429);
});


test('main-topic content fingerprints prevent same source across different API batches and preserve original language',async()=>{
 const {imp,DB}=await importFixture();
 const first=await imp('/api/import/batch',{topics:[{title:'  BACK  pain ',body:'Pain\nwhen sitting',source_lang:'en',comments:[{body:'First reply',replies:[{body:'Child reply'}]}]}]});
 assert.equal(first.status,201,JSON.stringify(first));
 const duplicate=await imp('/api/import/topics',{title:'back pain',body:'pain when sitting',source_lang:'en',comments:[{body:'A new reply must not be added'}]});
 assert.equal(duplicate.status,200,JSON.stringify(duplicate));
 assert.equal(duplicate.data.imported.topics,0);
 assert.equal(duplicate.data.imported.comments,0);
 assert.equal(duplicate.data.skipped.topics,1);
 assert.equal(duplicate.data.results[0].id,first.data.results[0].id);
 assert.equal(DB.db.prepare('SELECT count(*) n FROM topics').get().n,1);
 assert.equal(DB.db.prepare('SELECT count(*) n FROM comments').get().n,2);
 const stored=DB.db.prepare('SELECT title,body,source_lang,content_hash FROM topics').get();
 assert.equal(stored.title,'BACK  pain');
 assert.equal(stored.body,'Pain\nwhen sitting');
 assert.equal(stored.source_lang,'en');
 assert.equal(stored.content_hash.length,64);
 assert.throws(()=>DB.db.prepare("INSERT INTO topics(id,author_id,title,body,status,content_hash) VALUES('duplicate','system-unknown-import','X','X','published',?)").run(stored.content_hash));
});
test('same batch repeated topic is skipped, including replies; normal topic writes participate in fingerprint dedup',async()=>{
 const {imp,DB,topic,call}=await importFixture();
 const a=await imp('/api/import/batch',{topics:[{title:'ABC',body:'DEF',comments:[{body:'Only this reply'}]},{title:'abc',body:'def',comments:[{body:'Skipped reply'}]}]});
 assert.equal(a.status,201);assert.equal(a.data.imported.topics,1);assert.equal(a.data.skipped.topics,1);assert.equal(a.data.imported.comments,1);
 assert.equal(DB.db.prepare('SELECT count(*) n FROM topics').get().n,1);assert.equal(DB.db.prepare('SELECT count(*) n FROM comments').get().n,1);
 const duplicateUser=await call('/api/topics','POST',{title:'Abc',body:'Def'},'bob');assert.equal(duplicateUser.status,409);
 const fresh=await topic('Another','Other body');
 const edited=await call('/api/topics/'+fresh,'PATCH',{title:'ABC',body:'DEF'},'alice');assert.equal(edited.status,409);
});
test('source sync receipt excludes a thread forever even after its replies change',async()=>{
 const {imp,DB}=await importFixture();
 const a=await imp('/api/import/topics',{title:'Snapshot',body:'Original content',comments:[{body:'At first sync'}]});
 const id=a.data.results[0].id;
 DB.db.prepare("INSERT INTO topic_sync_receipts(source_topic_id,production_topic_id,content_hash,transferred_comments) SELECT id,id,content_hash,1 FROM topics WHERE id=?").run(id);
 await imp('/api/import/comments',{topic_id:id,body:'Added later'});
 const pending=DB.db.prepare("SELECT count(*) n FROM topics t WHERE author_id='system-unknown-import' AND status='published' AND NOT EXISTS(SELECT 1 FROM topic_sync_receipts s WHERE s.source_topic_id=t.id)").get();
 assert.equal(pending.n,0);
 assert.equal(DB.db.prepare('SELECT transferred_comments FROM topic_sync_receipts WHERE source_topic_id=?').get(id).transferred_comments,1);
});
test('sync helper fingerprint matches Worker and maintains parent-first ordering without copying hidden-parent branches',async()=>{
 const {topicFingerprint}=await import('../.test-build/core.js');
 const {fingerprint,sortComments}=await import('../scripts/sync-preview-to-production.mjs');
 assert.equal(fingerprint('  BACK  Pain ',' A\nB '),await topicFingerprint('back pain','a b'));
 const source=[{id:'child',parent_comment_id:'root',status:'published'},{id:'hiddenChild',parent_comment_id:'hidden',status:'published'},{id:'root',parent_comment_id:null,status:'published'},{id:'hidden',parent_comment_id:null,status:'hidden'}];
 assert.deepEqual(sortComments(source).map(x=>x.id),['root','child']);
});


test('one-time production SQL snapshot writes topic and nested replies, and repeated execution stays idempotent',async()=>{
 const {DB}=await fixture();
 const {buildInserts,fingerprint}=await import('../scripts/sync-preview-to-production.mjs');
 const src={id:'source-topic-1',title:"Patient's original experience",body:'English discussion',source_lang:'en',symptom_duration_days:null,created_at:1234567};
 const hashValue=fingerprint(src.title,src.body);
 const comments=[
  {id:'parent1',parent_comment_id:null,kind:'regular',author_id:'system-unknown-import',body:"I'm recovering",source_lang:'en',status:'published',created_at:1234568},
  {id:'child1',parent_comment_id:'parent1',kind:'regular',author_id:'system-unknown-import',body:'Thank you',source_lang:'en',status:'published',created_at:1234569}
 ];
 const sql=buildInserts(src,comments,[],hashValue);
 DB.db.exec(sql);
 DB.db.exec(sql);
 assert.equal(DB.db.prepare('SELECT count(*) n FROM topics WHERE id=?').get(src.id).n,1);
 assert.equal(DB.db.prepare('SELECT count(*) n FROM comments WHERE topic_id=?').get(src.id).n,2);
 assert.equal(DB.db.prepare('SELECT reply_count FROM topics WHERE id=?').get(src.id).reply_count,2);
 assert.equal(DB.db.prepare('SELECT parent_comment_id FROM comments WHERE id=?').get('child1').parent_comment_id,'parent1');
 assert.equal(DB.db.prepare('SELECT content_hash FROM topics WHERE id=?').get(src.id).content_hash,hashValue);
 assert.equal(DB.db.prepare('PRAGMA foreign_key_check').all().length,0);
});


test('production sync maps arbitrary published topic/reply authors to Unknown User and keeps progress/nesting without duplicates',async()=>{
 const {DB}=await fixture();
 const {buildInserts,fingerprint,sortComments}=await import('../scripts/sync-preview-to-production.mjs');
 const topic={id:'preview-user-topic',author_id:'bob',title:'Personal recovery notes',body:'Six weeks later',source_lang:'en',symptom_duration_days:42,created_at:1234567};
 const all=[
  {id:'grandchild',author_id:'alice',parent_comment_id:'child',kind:'regular',progress_seq:null,body:'Third level',source_lang:'en',status:'published',created_at:1234571},
  {id:'child',author_id:'carol',parent_comment_id:'progress1',kind:'regular',progress_seq:null,body:'Reply to progress',source_lang:'en',status:'published',created_at:1234570},
  {id:'progress1',author_id:'bob',parent_comment_id:null,kind:'progress',progress_seq:1,body:'Week six improvement',source_lang:'en',status:'published',created_at:1234569},
  {id:'hidden',author_id:'bob',parent_comment_id:null,kind:'regular',progress_seq:null,body:'Hidden',source_lang:'en',status:'hidden',created_at:1234572},
  {id:'hidden-child',author_id:'alice',parent_comment_id:'hidden',kind:'regular',progress_seq:null,body:'Should remain hidden',source_lang:'en',status:'published',created_at:1234573},
  {id:'deleted',author_id:'alice',parent_comment_id:null,kind:'regular',progress_seq:null,body:null,source_lang:'en',status:'deleted',created_at:1234574},
  {id:'after-deleted',author_id:'carol',parent_comment_id:'deleted',kind:'regular',progress_seq:null,body:'Preserve thread hierarchy',source_lang:'en',status:'published',created_at:1234575},
 ];
 const selected=sortComments(all);
 assert.deepEqual(selected.map(x=>x.id),['progress1','child','grandchild','deleted','after-deleted']);
 const sql=buildInserts(topic,selected,[],fingerprint(topic.title,topic.body));
 DB.db.exec(sql);DB.db.exec(sql);
 assert.equal(DB.db.prepare('SELECT author_id FROM topics WHERE id=?').get(topic.id).author_id,'system-unknown-import');
 const rows=DB.db.prepare('SELECT id,author_id,parent_comment_id,kind,progress_seq,body FROM comments WHERE topic_id=? ORDER BY created_at').all(topic.id);
 assert.equal(rows.length,5);
 assert.ok(rows.every(x=>x.author_id==='system-unknown-import'));
 assert.equal(rows.find(x=>x.id==='progress1').kind,'progress');
 assert.equal(rows.find(x=>x.id==='progress1').progress_seq,1);
 assert.equal(rows.find(x=>x.id==='grandchild').parent_comment_id,'child');
 assert.equal(rows.find(x=>x.id==='deleted').body,null);
 assert.equal(rows.find(x=>x.id==='after-deleted').parent_comment_id,'deleted');
 assert.equal(DB.db.prepare('SELECT reply_count FROM topics WHERE id=?').get(topic.id).reply_count,4);
 assert.equal(DB.db.prepare('PRAGMA foreign_key_check').all().length,0);
 const wrong={...all[2],kind:'unsupported'};
 assert.throws(()=>buildInserts(topic,[wrong],[],fingerprint(topic.title,topic.body)),/Unsupported source comment kind/);
});


test('one-time sync publishes only manually confirmed or current-version verified languages',async()=>{
 const {DB}=await fixture();
 const {resolveSyncLanguage,buildInserts,fingerprint}=await import('../scripts/sync-preview-to-production.mjs');
 const manual={id:'manual',status:'published',source_lang:'es',source_lang_mode:'manual',content_version:3};
 const auto={id:'auto',status:'published',source_lang:'fr',source_lang_mode:'legacy',content_version:2,
  verified_version:2,verified_language:'en',verified_method:'tinyld-heavy',verified_score:.87};
 const stale={id:'stale',status:'published',source_lang:'en',source_lang_mode:'auto',content_version:3,
  verified_version:2,verified_language:'en',verified_method:'tinyld-heavy',verified_score:.99};
 const admin={id:'admin-proof',status:'published',source_lang:'fr',source_lang_mode:'legacy',content_version:2,
  verified_version:2,verified_language:'ja',verified_method:'admin-manual',verified_score:null};
 const deleted={...admin,status:'deleted'};
 assert.deepEqual([resolveSyncLanguage(manual).label,resolveSyncLanguage(auto).label,
   resolveSyncLanguage(stale).label,resolveSyncLanguage(admin).label,resolveSyncLanguage(deleted).label],
  ['es','en','und','ja','und']);
 assert.equal(resolveSyncLanguage(admin).mode,'manual');
 const topic={...auto,id:'verified-topic',title:'Original title',body:'Original text',
   symptom_duration_days:null,created_at:1234};
 const comments=[
  {...manual,id:'manual-reply',parent_comment_id:null,kind:'regular',progress_seq:null,body:'Gracias',created_at:1235},
  {...stale,id:'stale-reply',parent_comment_id:null,kind:'regular',progress_seq:null,body:'Old text',created_at:1236},
  {...admin,id:'admin-reply',parent_comment_id:null,kind:'regular',progress_seq:null,body:'Confirmed language',created_at:1237},
  {...deleted,id:'removed-reply',parent_comment_id:null,kind:'regular',progress_seq:null,body:null,created_at:1238}
 ];
 const sql=buildInserts(topic,comments,[],fingerprint(topic.title,topic.body));
 DB.db.exec(sql);DB.db.exec(sql);
 const stored=DB.db.prepare('SELECT source_lang,source_lang_mode FROM topics WHERE id=?').get(topic.id);
 assert.equal(stored.source_lang,'en');assert.equal(stored.source_lang_mode,'auto');
 const proof=DB.db.prepare('SELECT content_version,language,method,score FROM content_language_verifications WHERE content_id=?').get(topic.id);
 assert.equal(proof.content_version,1,'new production content starts at version 1');
 assert.equal(proof.language,'en');assert.equal(proof.method,'tinyld-heavy');
 assert.equal(proof.score,.87);
 assert.equal(DB.db.prepare('SELECT source_lang FROM comments WHERE id=?').get('manual-reply').source_lang,'es');
 assert.equal(DB.db.prepare('SELECT source_lang_mode FROM comments WHERE id=?').get('manual-reply').source_lang_mode,'manual');
 assert.equal(DB.db.prepare('SELECT source_lang FROM comments WHERE id=?').get('stale-reply').source_lang,'und');
 assert.equal(DB.db.prepare('SELECT source_lang_mode FROM comments WHERE id=?').get('stale-reply').source_lang_mode,'legacy');
 assert.equal(DB.db.prepare('SELECT source_lang FROM comments WHERE id=?').get('admin-reply').source_lang,'ja');
 assert.equal(DB.db.prepare('SELECT source_lang_mode FROM comments WHERE id=?').get('admin-reply').source_lang_mode,'manual');
 assert.equal(DB.db.prepare('SELECT source_lang FROM comments WHERE id=?').get('removed-reply').source_lang,'und');
 assert.equal(DB.db.prepare('SELECT source_lang_mode FROM comments WHERE id=?').get('removed-reply').source_lang_mode,'legacy');
 assert.equal(DB.db.prepare("SELECT count(*) n FROM content_language_verifications WHERE content_id IN ('manual-reply','stale-reply','removed-reply')").get().n,0);
 assert.equal(DB.db.prepare("SELECT method FROM content_language_verifications WHERE content_id='admin-reply'").get().method,'admin-manual');
 assert.equal(DB.db.prepare('PRAGMA foreign_key_check').all().length,0);
});

test('Mayo staged content accepts non-English hints and verifies the published original',async()=>{
 const {collect,claim,DB}=await collectFixture();
 const source='multilingual-long-test';
 const token=(await claim('mayoclinic',[source])).data.results[0].lease_token;
 const call=(action,extra={})=>collect('/api/collect/long/'+action,{
  site:'mayoclinic',source_id:source,lease_token:token,...extra
 });
 const title='我的腰椎疼痛康复过程';
 const body='这个腰椎疼痛困扰我很多年，后来开始康复训练，现在慢慢恢复了正常活动。';
 const start=await call('start',{expected_pages:1,title,body,source_lang:'zh-CN'});
 assert.equal(start.status,200,JSON.stringify(start.data));
 const reply='我也是腰椎疼痛的患者，之前久坐会加重，现在经过治疗有所缓解。';
 const page=await call('page',{page_number:1,comments:[{source_comment_id:'1',parent_source_comment_id:null,body:reply,source_lang:'zh-CN'}]});
 assert.equal(page.status,200,JSON.stringify(page.data));
 const result=await call('finish');
 assert.equal(result.status,200,JSON.stringify(result.data));
 const topic=DB.db.prepare('SELECT source_lang,source_lang_mode FROM topics WHERE id=?').get(result.data.topic_id);
 assert.equal(topic.source_lang,'zh-CN');
 assert.equal(topic.source_lang_mode,'auto');
 const row=DB.db.prepare('SELECT id,source_lang,source_lang_mode FROM comments WHERE topic_id=?').get(result.data.topic_id);
 assert.equal(row.source_lang,'zh-CN');assert.equal(row.source_lang_mode,'auto');
 const proof=DB.db.prepare('SELECT method FROM content_language_verifications WHERE content_id=?').get(result.data.topic_id);
 assert.equal(proof.method,'tinyld-heavy');
});

test('language audit CLI is explicit and read-only by default',()=>{
 const help=spawnSync(process.execPath,['scripts/audit-original-languages.mjs','--help'],{encoding:'utf8'});
 assert.equal(help.status,0,help.stderr);
 assert.match(help.stdout,/read-only/);
 const invalid=spawnSync(process.execPath,['scripts/audit-original-languages.mjs','--target=other'],{encoding:'utf8'});
 assert.notEqual(invalid.status,0);
 assert.match(invalid.stderr,/Select exactly one audit target/);
});
// Collection coordination test fixtures never access the network or production database.
async function collectFixture(){
 const f=await importFixture();
 Object.assign(f.env,{COLLECT_ENABLED:'true'});
 f.collect=async(path,data,options={})=>{
  const method=options.method||'POST',search=options.search||'';
  const headers={...(data!==undefined?{'Content-Type':'application/json'}:{}),...options.headers};
  const req=new Request((options.origin||IMPORT_ORIGIN)+path+search,{method,headers,body:data===undefined?undefined:JSON.stringify(data)});
  const res=await worker.fetch(req,options.env||f.env);
  return {status:res.status,data:await res.json()};
 };
 f.claim=async(site,ids,collector='deepseek')=>f.collect('/api/collect/claim',{site,source_ids:ids,collector_id:collector});
 f.exclude=async(site='tieba',search='')=>f.collect('/api/collect/exclusions',undefined,{method:'GET',search:'?site='+site+search});
 return f;
}
test('ask39 candidate precheck excludes old rejected IDs before discovery selection, without mutation',async()=>{
 const {collect,DB}=await collectFixture();
 const rows=['111111','222222','333333'].map(source_id=>({source_id,url:'https://ask.39.net/question/'+source_id+'.html'}));
 assert.equal((await collect('/api/collect/queue',{site:'ask39',action:'enqueue',items:rows})).status,200);
 assert.equal((await collect('/api/collect/queue',{site:'ask39',action:'mark',items:[
  {source_id:'111111',status:'rejected',reason:'patient_narrative_too_short'}
 ]})).status,200);
 DB.db.prepare("UPDATE collector_candidates SET status='retry',retry_at=unixepoch()+3600 WHERE site='ask39' AND source_id='222222'").run();
 const input={site:'ask39',action:'check',items:['111111','222222','333333','444444'].map(source_id=>({source_id}))};
 const result=await collect('/api/collect/queue',input);
 assert.equal(result.status,200,JSON.stringify(result));
 assert.equal(result.data.site,'ask39');
 assert.equal(result.data.status,'checked');
 assert.deepEqual(result.data.excluded.sort((a,b)=>a.source_id.localeCompare(b.source_id)),[
  {source_id:'111111',status:'rejected'},{source_id:'222222',status:'retry'}
 ]);
 assert.equal(DB.db.prepare("SELECT status FROM collector_candidates WHERE site='ask39' AND source_id='111111'").get().status,'rejected');
 assert.equal((await collect('/api/collect/queue',{...input,items:[{source_id:'111111'},{source_id:'111111'}]})).status,400);
 DB.db.prepare("UPDATE collector_candidates SET retry_at=unixepoch()-1 WHERE site='ask39' AND source_id='222222'").run();
 const refreshed=await collect('/api/collect/queue',input);
 assert.equal(refreshed.status,200);
 assert.deepEqual(refreshed.data.excluded,[{source_id:'111111',status:'rejected'}]);
});
test('collector is available on preview without credentials and blocked in production before touching DB',async()=>{
 const poison={prepare(){throw Error('A DB was accessed');},batch(){throw Error('A DB was accessed');}};
 const base={DB:poison,IMPORT_DB:poison,APP_ENV:'preview',IMPORT_ENABLED:'true',COLLECT_ENABLED:'true'};
 for(const env of [{}, {...base,APP_ENV:'production'}, {...base,COLLECT_ENABLED:'false'}, {...base,IMPORT_DB:undefined}]){
  const r=await worker.fetch(new Request(IMPORT_ORIGIN+'/api/collect/exclusions?site=tieba'),env);
  assert.equal(r.status,403);
  assert.equal((await r.json()).error,'collect_disabled');
 }
 const {collect,claim,exclude}=await collectFixture();
 const list=await exclude();
 assert.equal(list.status,200);
 assert.deepEqual(list.data.items,[]);
 const result=await claim('tieba',['12345']);
 assert.equal(result.status,200);
 assert.equal(result.data.results[0].result,'granted');
 assert.equal(result.data.lease_seconds,6*60*60);
 const remaining=result.data.results[0].lease_expires_at-now();
 assert(remaining>=6*60*60-5 && remaining<=6*60*60+1,remaining);
 const release=await collect('/api/collect/release',{site:'tieba',source_id:'12345',lease_token:result.data.results[0].lease_token});
 assert.equal(release.status,200);
});
test('exclusions page through active claims and completed entries, omitting expired leases',async()=>{
 const {claim,exclude,DB}=await collectFixture();
 const result=await claim('tieba',['100','300','200']);
 assert.equal(result.status,200,JSON.stringify(result));
 assert(result.data.results.every(r=>r.result==='granted'&&r.lease_token.length>=32));
 const first=await exclude('tieba','&limit=2');
 assert.deepEqual(first.data.items.map(x=>x.source_id),['100','200']);
 assert.equal(first.data.next_cursor,'200');
 const later=await exclude('tieba','&limit=2&cursor=200');
 assert.deepEqual(later.data.items.map(x=>x.source_id),['300']);
 DB.db.prepare('UPDATE collect_sources SET lease_expires_at=? WHERE site=? AND source_id=?').run(now()-5,'tieba','200');
 const fresh=await exclude();
 assert.deepEqual(fresh.data.items.map(x=>x.source_id),['100','300']);
 assert.equal((await exclude('tieba','&limit=999')).status,400);
 assert.equal((await exclude('tieba','&cursor=%2Fbad')).status,400);
});
test('atomic claim grants only one worker; expiry and release make a source claimable again',async()=>{
 const {claim,exclude,collect,DB}=await collectFixture();
 const [a,b]=await Promise.all([claim('tieba',['95153'],'deepseek'),claim('tieba',['95153'],'claude')]);
 const outcomes=[a.data.results[0],b.data.results[0]];
 assert.deepEqual(outcomes.map(x=>x.result).sort(),['granted','in_progress']);
 const first=outcomes.find(x=>x.result==='granted');
 const denied=await collect('/api/collect/release',{site:'tieba',source_id:'95153',lease_token:'fake-token-with-sufficient-length-00000000000'});
 assert.equal(denied.status,409);
 const release=await collect('/api/collect/release',{site:'tieba',source_id:'95153',lease_token:first.lease_token});
 assert.equal(release.status,200);
 assert.equal((await exclude()).data.items.length,0);
 const next=await claim('tieba',['95153'],'claude');
 assert.equal(next.data.results[0].result,'granted');
 DB.db.prepare('UPDATE collect_sources SET lease_expires_at=? WHERE site=? AND source_id=?').run(now()-5,'tieba','95153');
 assert.equal((await exclude()).data.items.length,0);
 const retry=await claim('tieba',['95153'],'deepseek');
 assert.equal(retry.data.results[0].result,'granted');
 assert.notEqual(retry.data.results[0].lease_token,next.data.results[0].lease_token);
 const old=await collect('/api/collect/complete',{site:'tieba',source_id:'95153',lease_token:next.data.results[0].lease_token,topic:{title:'Old lease',body:'Old lease is invalid'}});
 assert.equal(old.status,409);assert.equal(old.data.error,'claim_not_owned_or_expired');
});
test('complete atomically stores original-language nested replies and immediately updates future exclusions',async()=>{
 const {claim,collect,exclude,DB}=await collectFixture();
 const r=await claim('reddit',['f72abc']);const lease=r.data.results[0].lease_token;
 const topic={title:'Life after back pain',body:'I can walk again after rehab.',source_lang:'en',
  comments:[{body:'Take your time.',source_lang:'en',replies:[{body:'Thank you!',source_lang:'en'}]}]};
 const first=await collect('/api/collect/complete',{site:'reddit',source_id:'f72abc',lease_token:lease,topic});
 assert.equal(first.status,201,JSON.stringify(first));
 assert.deepEqual(first.data.imported,{topics:1,comments:2});
 assert.equal(first.data.duplicate,false);
 const dbTopic=DB.db.prepare('SELECT title,body,source_lang,content_hash FROM topics WHERE id=?').get(first.data.topic_id);
 assert.equal(dbTopic.title,topic.title);assert.equal(dbTopic.body,topic.body);assert.equal(dbTopic.source_lang,'en');
 assert.equal(dbTopic.content_hash.length,64);
 const comments=DB.db.prepare('SELECT id,parent_comment_id,body,source_lang FROM comments WHERE topic_id=? ORDER BY rowid').all(first.data.topic_id);
 assert.equal(comments.length,2);assert.equal(comments[1].parent_comment_id,comments[0].id);
 assert.deepEqual(comments.map(x=>x.body),['Take your time.','Thank you!']);
 assert.deepEqual((await exclude('reddit')).data.items,[{source_id:'f72abc',status:'completed',lease_expires_at:null}]);
 assert.equal((await claim('reddit',['f72abc'])).data.results[0].result,'completed');
 const replay=await collect('/api/collect/complete',{site:'reddit',source_id:'f72abc',lease_token:lease,topic});
 assert.equal(replay.status,200);assert.equal(replay.data.already_completed,true);
 assert.equal(DB.db.prepare('SELECT count(*) n FROM topics').get().n,1);
 assert.equal(DB.db.prepare('SELECT count(*) n FROM comments').get().n,2);
 const altered=await collect('/api/collect/complete',{site:'reddit',source_id:'f72abc',lease_token:lease,topic:{...topic,body:'Altered'}});
 assert.equal(altered.status,409);assert.equal(altered.data.error,'completion_payload_mismatch');
});
test('same source cannot finalize with another collector token or without active lease',async()=>{
 const {claim,collect,DB}=await collectFixture();
 const r=await claim('tieba',['19547']);const lease=r.data.results[0].lease_token;
 assert.throws(()=>DB.db.prepare('INSERT INTO collect_finalize_guard(site,source_id,lease_token_hash) VALUES(?,?,?)').run('tieba','19547','fake'));
 const forged=await collect('/api/collect/complete',{site:'tieba',source_id:'19547',lease_token:'a'.repeat(64),topic:{title:'Forged',body:'Bad'}});
 assert.equal(forged.status,409);
 DB.db.prepare('UPDATE collect_sources SET lease_expires_at=? WHERE site=? AND source_id=?').run(now()-1,'tieba','19547');
 const late=await collect('/api/collect/complete',{site:'tieba',source_id:'19547',lease_token:lease,topic:{title:'Late',body:'Expired'}});
 assert.equal(late.status,409);
 assert.equal(DB.db.prepare('SELECT count(*) n FROM topics').get().n,0);
 assert.equal(DB.db.prepare('SELECT count(*) n FROM collect_finalize_guard').get().n,0);
});
test('same content from another original site is not re-imported, but both source IDs enter exclusions',async()=>{
 const {claim,collect,exclude,DB}=await collectFixture();
 const one=await claim('tieba',['111']);
 const draft={title:'Same discussion',body:'My back feels better this week.',source_lang:'en',comments:[{body:'Earlier reply.'}]};
 const first=await collect('/api/collect/complete',{site:'tieba',source_id:'111',lease_token:one.data.results[0].lease_token,topic:draft});
 assert.equal(first.status,201);
 const two=await claim('reddit',['a12bc']);
 const duplicate=await collect('/api/collect/complete',{site:'reddit',source_id:'a12bc',lease_token:two.data.results[0].lease_token,topic:{...draft,comments:[{body:'This reply should never be added'}]}});
 assert.equal(duplicate.status,200,JSON.stringify(duplicate));
 assert.equal(duplicate.data.duplicate,true);
 assert.equal(duplicate.data.topic_id,first.data.topic_id);
 assert.equal(DB.db.prepare('SELECT count(*) n FROM topics').get().n,1);
 assert.equal(DB.db.prepare('SELECT count(*) n FROM comments').get().n,1);
 assert.equal((await exclude('tieba')).data.items[0].status,'completed');
 assert.equal((await exclude('reddit')).data.items[0].status,'completed');
});
test('existing posts from direct import are matched by fingerprint and recorded as collected',async()=>{
 const {imp,claim,collect,DB}=await collectFixture();
 const draft={title:'A pre-existing imported post',body:'A post already in the database.',source_lang:'en',comments:[{body:'First comment'}]};
 const imported=await imp('/api/import/topics',draft);assert.equal(imported.status,201);
 const claimed=await claim('tieba',['212']);
 const response=await collect('/api/collect/complete',{site:'tieba',source_id:'212',lease_token:claimed.data.results[0].lease_token,topic:draft});
 assert.equal(response.status,200);assert.equal(response.data.duplicate,true);
 assert.equal(DB.db.prepare('SELECT count(*) n FROM comments').get().n,1);
 assert.equal(DB.db.prepare('SELECT count(*) n FROM topics').get().n,1);
});
test('completion failure rolls back content and claim status, and retry can succeed',async()=>{
 const {claim,collect,DB}=await collectFixture();
 const r=await claim('tieba',['221']);const lease=r.data.results[0].lease_token;
 DB.db.exec("CREATE TRIGGER forced_collect_failure BEFORE INSERT ON topics BEGIN SELECT RAISE(ABORT,'forced'); END");
 const payload={site:'tieba',source_id:'221',lease_token:lease,topic:{title:'Rollback case',body:'This should rollback.',comments:[{body:'A reply'}]}};
 const failed=await collect('/api/collect/complete',payload);
 assert.equal(failed.status,503,JSON.stringify(failed));
 assert.equal(DB.db.prepare('SELECT count(*) n FROM topics').get().n,0);
 assert.equal(DB.db.prepare('SELECT count(*) n FROM comments').get().n,0);
 assert.equal(DB.db.prepare('SELECT count(*) n FROM collect_finalize_guard').get().n,0);
 assert.equal(DB.db.prepare("SELECT state FROM collect_sources WHERE site='tieba' AND source_id='221'").get().state,'claimed');
 DB.db.exec('DROP TRIGGER forced_collect_failure');
 const success=await collect('/api/collect/complete',payload);
 assert.equal(success.status,201,JSON.stringify(success));
});
test('collection input validation, origin checks, ID validation and comment depth enforce limits',async()=>{
 const {claim,collect,DB}=await collectFixture();
 assert.equal((await claim('tieba',['bad-id'])).status,400);
 assert.equal((await claim('tieba',Array(31).fill('12'))).status,400);
 assert.equal((await claim('tieba',['1','1'])).status,400);
 assert.equal((await collect('/api/collect/claim',{site:'tieba',source_ids:['1'],collector_id:'evil user'})).status,400);
 assert.equal((await collect('/api/collect/claim',{site:'tieba',source_ids:['1'],collector_id:'ai'}, {headers:{origin:'https://evil.test'}})).status,403);
 const got=await claim('tieba',['1234']);
 let deep={body:'nested'};
 for(let i=0;i<8;i++)deep={body:'nested',replies:[deep]};
 const bad=await collect('/api/collect/complete',{site:'tieba',source_id:'1234',lease_token:got.data.results[0].lease_token,topic:{title:'Deep replies',body:'Too deep',comments:[deep]}});
 assert.equal(bad.status,400);assert.equal(bad.data.error,'reply_depth_exceeded');
 assert.equal(DB.db.prepare('SELECT count(*) n FROM topics').get().n,0);
});


test('numeric-leading source site 120ask supports exclusions, claim, complete and release without changing existing site rules',async()=>{
 const {collect,claim,exclude,DB}=await collectFixture();
 const before=await exclude('120ask');assert.equal(before.status,200);
 assert.deepEqual(before.data.items,[]);
 const claimed=await claim('120ask',['481624202','481624203'],'grok');
 assert.equal(claimed.status,200,JSON.stringify(claimed));
 assert(claimed.data.results.every(x=>x.result==='granted'));
 assert.equal(claimed.data.lease_seconds,21600);
 const active=await exclude('120ask');
 assert.deepEqual(active.data.items.map(x=>x.source_id),['481624202','481624203']);
 assert(active.data.items.every(x=>x.status==='claimed'));
 const first=claimed.data.results[0];
 const topic={title:'Synthetic 120ask example',body:'This is synthetic text for a validation test, not a real patient story.',source_lang:'en',comments:[{body:'Synthetic reply',source_lang:'en'}]};
 const completed=await collect('/api/collect/complete',{site:'120ask',source_id:first.source_id,lease_token:first.lease_token,topic});
 assert.equal(completed.status,201,JSON.stringify(completed));
 assert.equal(completed.data.imported.topics,1);
 assert.equal(completed.data.imported.comments,1);
 const blocked=await claim('120ask',[first.source_id],'otherai');
 assert.equal(blocked.data.results[0].result,'completed');
 const second=claimed.data.results[1];
 const released=await collect('/api/collect/release',{site:'120ask',source_id:second.source_id,lease_token:second.lease_token});
 assert.equal(released.status,200);
 const final=await exclude('120ask');
 assert.deepEqual(final.data.items.map(x=>x.source_id),[first.source_id]);
 assert.equal(final.data.items[0].status,'completed');
 assert.equal(DB.db.prepare('SELECT count(*) n FROM collect_sources WHERE site=? AND state=?').get('120ask','completed').n,1);
 // Preserve existing input restrictions: site must contain 2-32 lowercase ASCII alphanumeric/_/- characters.
 for(const badSite of ['-120ask','_120ask','120.ask','120/ask','120 ask','A120ask','1','a'.repeat(33)]){
  const bad=await exclude(badSite);
  assert.equal(bad.status,400,badSite+': '+JSON.stringify(bad.data));
  assert.equal(bad.data.error,'invalid_site');
 }
 assert.equal((await exclude('tieba')).status,200);
 assert.equal((await exclude('reddit')).status,200);
});


test('sign out revokes the session and clears the cookie, including for repeated requests',async()=>{
 const {call,DB}=await fixture();
 const before=await call('/api/me');assert.equal(before.status,200);assert.equal(before.data.user.id,'alice');
 const response=await call('/api/auth/logout','POST',{});
 assert.equal(response.status,200);assert.equal(response.data.ok,true);
 assert.match(response.headers.get('set-cookie')||'',/sc_session=;/);
 assert.match(response.headers.get('set-cookie')||'',/Max-Age=0/);
 assert(DB.db.prepare("SELECT revoked_at FROM user_sessions WHERE id='alice'").get().revoked_at);
 const after=await call('/api/me');assert.equal(after.status,200);assert.equal(after.data.user,null);
 assert.equal((await call('/api/auth/logout','POST',{})).status,200);
});

test('the desktop and mobile account menu exposes a discoverable sign out action',()=>{
 const app=readFileSync('public/app.js','utf8');
 const css=readFileSync('public/styles.css','utf8');
 assert.match(app,/<details class="account-menu"><summary/);
 assert.match(app,/data-action="logout"/);
 assert.match(app,/account-dropdown/);
 assert.match(css,/\.account-dropdown\{/);
 assert.match(css,/\.account-trigger:focus-visible/);
 assert.match(css,/@media\(max-width:700px\)/);
});


test('Google OAuth client IDs remain separated across production and preview config',()=>{
 const cfg=JSON.parse(readFileSync('wrangler.jsonc','utf8'));
 assert.equal(cfg.vars?.GOOGLE_CLIENT_ID,'294338107553-k5bts5abj3tg85lt82moelv40sph3tuh.apps.googleusercontent.com');
 assert.equal(cfg.previews?.vars?.GOOGLE_CLIENT_ID,'294338107553-bht5pr4qa112e9knbst517b0mvb9pus9.apps.googleusercontent.com');
 assert.notEqual(cfg.vars.GOOGLE_CLIENT_ID,cfg.previews.vars.GOOGLE_CLIENT_ID);
 assert.equal('GOOGLE_CLIENT_SECRET' in (cfg.vars||{}),false);
 assert.equal('GOOGLE_CLIENT_SECRET' in (cfg.previews.vars||{}),false);
 assert.equal(cfg.d1_databases[0].database_name,'spine-community-db');
 assert.equal(cfg.previews.d1_databases[0].database_name,'spine-community-db-preview');
});

test('likes, bookmarks and follows patch only matching buttons and cached content',async()=>{
 const {applyInteractionResult}=await import('../public/interaction-ui.js');
 const topic={id:'topic-a',liked:false,like_count:1,bookmarked:false,followed:false};
 const duplicate={id:'topic-a',liked:false,like_count:1,bookmarked:false,followed:false};
 const comment={id:'comment-a',topic_id:'topic-a',liked:false,like_count:0};
 const state={topic,feed:[duplicate],comments:[comment]};
 const button=(action,id,type='topic')=>{
  const count={textContent:'1'},classes=new Set();
  return {dataset:{action,id,type,active:'false'},classList:{toggle:(k,on)=>on?classes.add(k):classes.delete(k),contains:k=>classes.has(k)},setAttribute(k,v){this[k]=v;},querySelector:selector=>selector==='[data-like-count]'?count:null,count,innerHTML:''};
 };
 const like=button('like','topic-a'),anotherLike=button('like','topic-a'),commentLike=button('like','comment-a','comment'),bookmark=button('bookmark','topic-a'),follow=button('follow','topic-a'),unrelated=button('like','other');
 const buttons=[like,anotherLike,commentLike,bookmark,follow,unrelated],icon=key=>'('+key+')',translate=key=>key;
 applyInteractionResult(state,'like','topic','topic-a',{active:true,like_count:4},buttons,icon,translate);
 for(const b of [like,anotherLike]){assert.equal(b.dataset.active,'true');assert.equal(b['aria-pressed'],'true');assert.equal(b.classList.contains('active'),true);assert.equal(b.count.textContent,'4');}
 assert.equal(topic.like_count,4);assert.equal(duplicate.like_count,4);assert.equal(comment.like_count,0);assert.equal(unrelated.dataset.active,'false');
 applyInteractionResult(state,'like','topic','topic-a',{active:false,like_count:3},buttons,icon,translate);
 assert.equal(like.dataset.active,'false');assert.equal(like.classList.contains('active'),false);assert.equal(like.count.textContent,'3');
 applyInteractionResult(state,'like','comment','comment-a',{active:true,like_count:1},buttons,icon,translate);
 assert.equal(commentLike.count.textContent,'1');assert.equal(comment.liked,true);assert.equal(topic.liked,false);
 applyInteractionResult(state,'bookmark','topic','topic-a',{active:true},buttons,icon,translate);
 assert.equal(bookmark.innerHTML,'(bookmark)bookmarked');assert.equal(bookmark['aria-pressed'],'true');assert.equal(topic.bookmarked,true);assert.equal(duplicate.bookmarked,true);
 applyInteractionResult(state,'bookmark','topic','topic-a',{active:false},buttons,icon,translate);
 assert.equal(bookmark.innerHTML,'(bookmark)bookmark');assert.equal(topic.bookmarked,false);
 applyInteractionResult(state,'follow','topic','topic-a',{active:true},buttons,icon,translate);
 assert.equal(follow.innerHTML,'(follow)followed');assert.equal(follow.classList.contains('active'),true);assert.equal(topic.followed,true);
 applyInteractionResult(state,'follow','topic','topic-a',{active:false},buttons,icon,translate);
 assert.equal(follow.innerHTML,'(follow)follow');assert.equal(follow['aria-pressed'],'false');assert.equal(topic.followed,false);
 assert.throws(()=>applyInteractionResult(state,'like','topic','topic-a',{active:true},buttons,icon,translate),/invalid_interaction_response/);
 assert.equal(like.count.textContent,'3');
});

test('reaction handlers keep current page and scroll position instead of re-rendering',()=>{
 const app=readFileSync('public/app.js','utf8');
 const start=app.indexOf("if(['like','bookmark','follow'].includes(action))");
 const end=app.indexOf("if(action==='reply')",start);
 assert.ok(start>=0&&end>start);
 const handler=app.slice(start,end);
 assert.match(handler,/applyInteractionResult\(/);
 assert.doesNotMatch(handler,/await render\(/);
 assert.match(handler,/result=await api\(/);
 assert.match(handler,/card\?\.remove\(\)/);
 assert.match(app,/data-like-count/);
 assert.match(app,/aria-pressed/);
});

test('reply creation and edits return a ready-to-render comment and exact server count',async()=>{
 const {call,topic}=await fixture();
 const topicId=await topic('Looking for advice','My neck and lower back are sore');
 const root=await call('/api/topics/'+topicId+'/comments','POST',{body:'After walking for a month, things improved',source_lang:'en'},'bob');
 assert.equal(root.status,201);
 assert.equal(root.data.id,root.data.comment.id);
 assert.equal(root.data.comment.topic_id,topicId);
 assert.equal(root.data.comment.nickname,'bob');
 assert.equal(root.data.comment.parent_comment_id,null);
 assert.equal(root.data.comment.kind,'regular');
 assert.equal(root.data.comment.like_count,0);
 assert.equal(root.data.comment.liked,false);
 assert.equal(root.data.reply_count,1);
 const nested=await call('/api/topics/'+topicId+'/comments','POST',{body:'Thank you for the update',parent_comment_id:root.data.id,source_lang:'en'},'carol');
 assert.equal(nested.status,201);
 assert.equal(nested.data.comment.parent_comment_id,root.data.id);
 assert.equal(nested.data.comment.nickname,'carol');
 assert.equal(nested.data.reply_count,2);
 const edit=await call('/api/comments/'+nested.data.id,'PATCH',{body:'Thank you. That is useful.',source_lang:'en'},'carol');
 assert.equal(edit.status,200);
 assert.equal(edit.data.ok,true);
 assert.equal(edit.data.comment.id,nested.data.id);
 assert.equal(edit.data.comment.body,'Thank you. That is useful.');
 assert.equal(edit.data.reply_count,2);
 const progress=await call('/api/topics/'+topicId+'/comments','POST',{body:'Four week recovery update',kind:'progress',source_lang:'en'},'alice');
 assert.equal(progress.status,201);
 assert.equal(progress.data.comment.kind,'progress');
 assert.equal(progress.data.comment.progress_seq,1);
 assert.equal(progress.data.reply_count,3);
 const detail=await call('/api/topics/'+topicId,'GET',undefined,'alice');
 assert.equal(detail.data.topic.reply_count,3);
 assert.ok(detail.data.comments.some(c=>c.id===root.data.id));
 assert.ok(detail.data.comments.some(c=>c.id===nested.data.id));
 assert.ok(detail.data.comments.some(c=>c.id===progress.data.id));
});

test('reply UI state appends or updates only the relevant comment, count and progress',async()=>{
 const {applyReplyResult}=await import('../public/reply-ui.js');
 const existing={id:'older',topic_id:'topic-a',body:'Original'};
 const state={topic:{id:'topic-a',reply_count:1},comments:[existing],progress:[]};
 const reply={id:'new-reply',topic_id:'topic-a',kind:'regular',status:'published',body:'New content'};
 const created=applyReplyResult(state,{id:reply.id,status:'published',comment:reply,reply_count:2});
 assert.equal(created.insert,true);
 assert.equal(state.comments.length,2);
 assert.equal(state.comments.at(-1),reply);
 assert.equal(state.topic.reply_count,2);
 assert.equal(state.comments[0],existing);
 const duplicate=applyReplyResult(state,{id:reply.id,comment:reply,reply_count:2});
 assert.equal(duplicate.insert,false);
 assert.equal(state.comments.length,2);
 const updated={...reply,body:'Edited content'};
 const edit=applyReplyResult(state,{comment:updated,reply_count:2},true);
 assert.equal(edit.insert,false);
 assert.equal(state.comments.at(-1).body,'Edited content');
 const update={id:'progress-1',topic_id:'topic-a',kind:'progress',status:'published',body:'Recovery day 1',progress_seq:1,created_at:1234};
 applyReplyResult(state,{id:update.id,comment:update,reply_count:3});
 assert.equal(state.progress[0].body,'Recovery day 1');
 assert.equal(state.progress.length,1);
 const another={...update,id:'progress-2',body:'Recovery day 2',progress_seq:2,created_at:1235};
 applyReplyResult(state,{id:another.id,comment:another,reply_count:4});
 assert.deepEqual(state.progress.map(p=>p.id),['progress-2','progress-1']);
 applyReplyResult(state,{comment:{...update,body:'Recovery day 1 corrected'},reply_count:4},true);
 assert.equal(state.progress[1].body,'Recovery day 1 corrected');
 const flagged={...another,status:'pending_review',body:'Updated but pending'};
 applyReplyResult(state,{comment:flagged,reply_count:3},true);
 assert.deepEqual(state.progress.map(p=>p.id),['progress-1']);
 assert.equal(state.topic.reply_count,3);
 assert.throws(()=>applyReplyResult(state,{id:'wrong',comment:reply,reply_count:999}),/invalid_comment_response/);
 assert.throws(()=>applyReplyResult(state,{comment:{...reply,topic_id:'another-topic'},reply_count:2}),/invalid_comment_response/);
 assert.throws(()=>applyReplyResult(state,{comment:reply,reply_count:-1}),/invalid_comment_response/);
 assert.throws(()=>applyReplyResult(state,{comment:{...reply,id:'missing'},reply_count:4},true),/comment_not_loaded/);
 assert.equal(state.comments.length,4);
});

test('reply form locally inserts and focuses posted comment without full page refresh',()=>{
 const app=readFileSync('public/app.js','utf8'),css=readFileSync('public/styles.css','utf8');
 const start=app.indexOf("if(form.id==='root-reply'||form.id==='reply-form')");
 const end=app.indexOf("if(form.id==='report-form')",start);
 assert.ok(start>=0&&end>start);
 const handler=app.slice(start,end);
 assert.match(handler,/updateReplyUI\(result,edit\)/);
 assert.doesNotMatch(handler,/await render\(/);
 assert.doesNotMatch(handler,/location.hash\s*=/);
 assert.match(app,/insertAdjacentHTML\('beforeend',commentHtml\(comment\)\)/);
 assert.match(app,/scrollIntoView\(\{behavior:'smooth',block:'center'\}\)/);
 assert.match(app,/data-reply-count/);
 assert.match(app,/data\.comments\.filter\(c=>!existing\.has\(c\.id\)\)/);
 assert.match(css,/\.comment\.just-posted/);
});

test('production pages are indexable while preview pages and indicators stay isolated',async()=>{
 const {env,call}=await fixture();
 const html=readFileSync('public/index.html','utf8');
 const headers=readFileSync('public/_headers','utf8');
 const client=readFileSync('public/app.js','utf8');
 const cfg=JSON.parse(readFileSync('wrangler.jsonc','utf8'));
 assert(!html.includes('name="robots"'));
 assert(!headers.includes('X-Robots-Tag: noindex'));
 assert.deepEqual(cfg.assets.run_worker_first,['/api/*','/','/index.html','/topic/*','/search','/me','/notifications','/admin','/privacy','/robots.txt','/sitemap.xml','/sitemaps/*']);
 assert.equal(cfg.vars.APP_ENV,'production');
 assert.equal(cfg.previews.vars.APP_ENV,'preview');
 assert(client.includes('badge.hidden=!isPreview()'));
 assert(client.includes("t(isPreview()?'privacyText':'privacyProduction')"));
 env.ASSETS={fetch:async()=>new Response('<html>example</html>',{headers:{'content-type':'text/html','X-Robots-Tag':'noindex, nofollow'}})};
 env.APP_ENV='production';
 assert.equal((await call('/api/health')).data.environment,'production');
 const prod=await worker.fetch(new Request('https://spine.nbn369.com/'),env);
 assert.equal(prod.status,200);
 assert.equal(prod.headers.get('X-Robots-Tag'),null);
 assert.equal((await worker.fetch(new Request('https://spine.nbn369.com/index.html'),env)).status,308);
 env.APP_ENV='preview';
 assert.equal((await call('/api/health')).data.environment,'preview');
 const preview=await worker.fetch(new Request('https://preview.test/'),env);
 assert.equal(preview.status,200);
 assert.equal(preview.headers.get('X-Robots-Tag'),'noindex, nofollow');
 assert.equal((await worker.fetch(new Request('https://preview.test/index.html'),env)).status,308);
});

test('visitor language survives a Google login callback and account default English',async()=>{
 const {initialLocale}=await import('../public/locale.js');
 const {languages}=await import('../public/i18n.js');
 const store=new Map();
 const storage={getItem:key=>store.get(key)??null,setItem:(key,value)=>store.set(key,value)};
 // A first-time Chinese browser has not manually opened the language selector.
 assert.equal(initialLocale(storage,'zh-CN',languages),'zh-CN');
 assert.equal(store.get('sc_locale'),'zh-CN');
 // After OAuth redirect, the logged-in user can have preferred_locale='en'.
 // The interface remains Chinese because local browser choice was persisted.
 const account={preferred_locale:'en'};
 assert.equal(account.preferred_locale,'en');
 assert.equal(initialLocale(storage,'en-US',languages),'zh-CN');
 // An explicit language selection must win over browser and database defaults.
 storage.setItem('sc_locale','ja');
 assert.equal(initialLocale(storage,'zh-CN',languages),'ja');
 store.delete('sc_locale');
 assert.equal(initialLocale(storage,'pt-PT',languages),'pt-BR');
 store.delete('sc_locale');
 assert.equal(initialLocale(storage,'fr-FR',languages),'fr');
 store.delete('sc_locale');
 assert.equal(initialLocale(storage,'unknown',languages),'en');
 const client=readFileSync('public/app.js','utf8');
 assert(client.includes("initialLocale(localStorage,navigator.language,languages)"));
 assert(!client.includes("state.user.preferred_locale))locale="));
 assert(client.includes("localStorage.setItem('sc_locale',locale)"));
});

test('discussion-first home keeps search form on search page and places post button beside My space',async()=>{
 const {feedParams,sortRoute}=await import('../public/feed-ui.js');
 const {dictionaries,languages}=await import('../public/i18n.js');
 const app=readFileSync('public/app.js','utf8');
 const css=readFileSync('public/styles.css','utf8');
 for(const locale of languages)assert(dictionaries[locale].newPost,'missing post button translation: '+locale);
 assert.equal(dictionaries['zh-CN'].newPost,'发帖');
 const nav=app.match(/\$\('#sidebar'\)\.innerHTML=`<nav class="primary-nav">(.*?)<\/nav>/)?.[1];
 assert(nav,'sidebar navigation missing');
 assert(nav.indexOf("nav('mySpace'")>=0,'My space navigation missing');
 assert(nav.indexOf('data-action="compose"')>nav.indexOf("nav('mySpace'"),'Post button must follow My space');
 assert(nav.includes('class="nav-link nav-compose"'));
 assert(app.includes("if(action==='compose')return composer()")||app.includes("if(action==='compose')return composer();"),'Post nav must use existing compose action');
 assert(app.includes("isSearch?searchForm(query):''"),'Only the search page should render the search card');
 assert(!app.includes('<section class="hero">'),'Home hero must not push the feed down');
 assert(css.includes('.sidebar .nav-compose'),'Post button needs navigation styles');
 assert.equal(feedParams(new URLSearchParams(),false).get('sort'),'latest');
 assert.equal(feedParams(new URLSearchParams(),true).has('sort'),false);
 assert.equal(feedParams(new URLSearchParams('sort=discussion'),false).get('sort'),'discussion');
 assert.equal(sortRoute('/',new URLSearchParams(),'discussion'),'/?sort=discussion');
 assert.equal(sortRoute('/search',new URLSearchParams('q=back'),'latest'),'/search?q=back&sort=latest');
 const page2=feedParams(new URLSearchParams(),false);
 page2.set('offset','20');
 assert.equal(page2.toString(),'sort=latest&offset=20');
});

test('Traditional Chinese covers Taiwan, Hong Kong and Macau with fully localized UI',async()=>{
 const {initialLocale}=await import('../public/locale.js');
 const {languages,dictionaries}=await import('../public/i18n.js');
 const {traditionalChinese}=await import('../public/i18n-zh-tw.js');
 const html=readFileSync('public/index.html','utf8');
 const keys=[...readFileSync('public/i18n.js','utf8').matchAll(/^([A-Za-z][A-Za-z0-9_]*):\[/gm)].map(m=>m[1]);
 assert(languages.includes('zh-TW'));
 assert(html.includes('<option value="zh-TW">繁體中文</option>'));
 assert.deepEqual(Object.keys(traditionalChinese).sort(),keys.sort());
 assert.equal(dictionaries['zh-TW'].login,'登入');
 assert.equal(dictionaries['zh-TW'].newPost,'發帖');
 assert.equal(dictionaries['zh-TW'].neck,'頸部與頸椎');
 assert.equal(dictionaries['zh-TW'].reply,'回覆');
 assert.equal(dictionaries['zh-TW'].settings,'帳號與隱私');
 assert.equal(dictionaries['zh-CN'].home,'全部讨论');
 assert(languages.every(l=>dictionaries[l].home&&dictionaries[l].newPost));
 for(const raw of ['zh-TW','zh-HK','zh-MO','zh-Hant','zh-Hant-TW','zh-Hant-HK','zh-hk']){
  const store=new Map();
  const storage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v)};
  assert.equal(initialLocale(storage,raw,languages),'zh-TW',raw);
  assert.equal(store.get('sc_locale'),'zh-TW');
  // Google sign-in reload does not reset the persisted choice.
  assert.equal(initialLocale(storage,'en-US',languages),'zh-TW',raw+' after reload');
 }
 for(const raw of ['zh-CN','zh-SG','zh-Hans','zh']){
  const store=new Map();
  const storage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v)};
  assert.equal(initialLocale(storage,raw,languages),'zh-CN',raw);
 }
 {
  const store=new Map([['sc_locale','zh-CN']]);
  const storage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v)};
  assert.equal(initialLocale(storage,'zh-HK',languages),'zh-CN','explicit selection must win');
  store.set('sc_locale','zh-HK');
  assert.equal(initialLocale(storage,'en',languages),'zh-TW','legacy saved Hong Kong locale');
  assert.equal(store.get('sc_locale'),'zh-TW');
 }
});
test('Traditional Chinese profile, content language, taxonomy and translation API are accepted',async()=>{
 const {call}=await fixture();
 const labels=await call('/api/taxonomy?locale=zh-TW');
 assert.equal(labels.status,200);
 assert.equal(labels.data.terms.find(t=>t.id==='neck').label,'頸部與頸椎');
 assert.equal(labels.data.terms.find(t=>t.id==='physical-therapy').label,'物理治療與復健訓練');
 const me=await call('/api/me','PATCH',{nickname:'測試使用者',preferred_locale:'zh-TW',public_region:'香港'});
 assert.equal(me.status,200,JSON.stringify(me));
 const profile=await call('/api/me');
 assert.equal(profile.data.user.preferred_locale,'zh-TW');
 const post=await call('/api/topics','POST',{title:'頸椎與腰椎復健經驗',body:'這是繁體中文的測試貼文。',source_lang:'zh-TW'});
 assert.equal(post.status,201,JSON.stringify(post));
 const topic=await call('/api/topics/'+post.data.id,'GET',undefined,null);
 assert.equal(topic.data.topic.source_lang,'zh-TW');
 const reply=await call('/api/topics/'+post.data.id+'/comments','POST',{body:'謝謝分享',source_lang:'zh-TW'});
 assert.equal(reply.status,201);
 const {translatorTargetLocale}=await import('../.test-build/translation.js');
 assert.equal(translatorTargetLocale('zh-TW'),'zh-Hant');
 assert.equal(translatorTargetLocale('zh-CN'),'zh-Hans');
 const translation=await call('/api/translate','POST',{type:'topic',id:post.data.id,locale:'zh-TW'},null);
 assert.equal(translation.status,200);
 assert.equal(translation.data.reason,'same_language');
});

test('Default posting language follows interface unless the user selects a fixed language',async()=>{
 const {postingLanguage,profilePostingLanguageOptions}=await import('../public/posting-language.js');
 const {languages,dictionaries}=await import('../public/i18n.js');
 const {traditionalChinese}=await import('../public/i18n-zh-tw.js');
 assert.equal(dictionaries['zh-CN'].postingLanguage,'默认发帖语言');
 assert.equal(dictionaries['zh-CN'].followInterface,'跟随界面语言');
 assert.equal(dictionaries['zh-TW'].postingLanguage,'預設發帖語言');
 assert.equal(traditionalChinese.followInterface,'跟隨介面語言');
 assert(languages.every(locale=>dictionaries[locale].postingLanguage&&dictionaries[locale].followInterface));
 const auto={preferred_locale:'en',preferred_locale_mode:'auto'};
 assert.equal(postingLanguage(auto,'zh-CN',languages),'zh-CN');
 assert.equal(postingLanguage(auto,'zh-TW',languages),'zh-TW');
 assert.equal(postingLanguage(auto,'en',languages),'en');
 assert.equal(postingLanguage(auto,'ja',languages),'ja');
 const fixed={preferred_locale:'fr',preferred_locale_mode:'manual'};
 assert.equal(postingLanguage(fixed,'zh-CN',languages),'fr');
 assert.equal(postingLanguage(fixed,'zh-TW',languages),'fr');
 assert.equal(postingLanguage(null,'zh-CN',languages),'zh-CN');
 const formOpts=profilePostingLanguageOptions(auto,'zh-CN',languages,key=>dictionaries['zh-CN'][key],(selected,includeOther)=>includeOther===false?'<option>'+selected+'</option>':'unexpected');
 assert(formOpts.includes('value="auto" selected'));
 assert(formOpts.includes('跟随界面语言'));
 assert(formOpts.includes('简体中文'));
 const fixedOpts=profilePostingLanguageOptions(fixed,'zh-CN',languages,key=>dictionaries['zh-CN'][key],selected=>selected);
 assert(!fixedOpts.includes('value="auto" selected'));
 assert(fixedOpts.includes('fr'));
 const code=readFileSync('public/app.js','utf8');
 assert(code.includes("t('postingLanguage')"));
 assert(code.includes("profilePostingLanguageOptions(u,locale,languages,t,languageOptions)"));
 assert(code.includes('const preferred=postingLanguage(state.user,locale,languages)'));
 assert(code.includes('sourceFields(editing?c:null)'));
 assert(code.includes("{source_lang_mode:'auto'}"));
});

test('Migrated accounts preserve non-English choices, and allow returning to automatic posting language',async()=>{
 const {call,DB}=await fixture();
 const before=await call('/api/me');
 assert.equal(before.data.user.preferred_locale,'en');
 assert.equal(before.data.user.preferred_locale_mode,'auto');
 // Apply the new migration against an isolated copy of the previous schema.
 const legacyDB=new DatabaseSync(':memory:');
 legacyDB.exec('PRAGMA foreign_keys=ON');
 for(const f of readdirSync('migrations/v1').filter(f=>f.endsWith('.sql')&&!f.startsWith('0007_')).sort())legacyDB.exec(readFileSync('migrations/v1/'+f,'utf8'));
 legacyDB.prepare("INSERT INTO users(id,nickname,preferred_locale) VALUES('old-french','French member','fr')").run();
 legacyDB.prepare("INSERT INTO users(id,nickname,preferred_locale) VALUES('old-english','English member','en')").run();
 const migration=readFileSync('migrations/v1/0007_default_posting_language.sql','utf8');
 legacyDB.exec(migration);
 assert.equal(legacyDB.prepare("SELECT preferred_locale_mode FROM users WHERE id='old-french'").get().preferred_locale_mode,'manual');
 assert.equal(legacyDB.prepare("SELECT preferred_locale_mode FROM users WHERE id='old-english'").get().preferred_locale_mode,'auto');
 assert.equal(legacyDB.prepare('PRAGMA foreign_key_check').all().length,0);
 legacyDB.close();
 const fixed=await call('/api/me','PATCH',{nickname:'Alice',preferred_locale:'zh-TW',public_region:'台灣'});
 assert.equal(fixed.status,200);
 let user=(await call('/api/me')).data.user;
 assert.equal(user.preferred_locale,'zh-TW');
 assert.equal(user.preferred_locale_mode,'manual');
 assert.equal(user.public_region,'台灣');
 const reset=await call('/api/me','PATCH',{nickname:'Alice',preferred_locale:'auto',public_region:'台灣'});
 assert.equal(reset.status,200);
 user=(await call('/api/me')).data.user;
 assert.equal(user.preferred_locale_mode,'auto');
 assert.equal(user.preferred_locale,'zh-TW','reset keeps a stored language without forcing it on the UI');
 const invalid=await call('/api/me','PATCH',{nickname:'Alice',preferred_locale:'not-a-language'});
 assert.equal(invalid.status,400);
 const legacy=await call('/api/me','PATCH',{nickname:'Alice',preferred_locale:'en'});
 assert.equal(legacy.status,200,'legacy clients with a concrete locale remain compatible');
 assert.equal((await call('/api/me')).data.user.preferred_locale_mode,'manual');
});

test('post/reply language menus use 简体中文 and 繁體中文 rather than region labels',async()=>{
 const source=readFileSync('public/app.js','utf8');
 const menuLine=source.split('\n').find(line=>line.startsWith('function languageOptions('));
 assert(menuLine,'shared post/reply language options function must exist');
 assert(menuLine.includes("l==='zh-CN'?'简体中文'"));
 assert(menuLine.includes("l==='zh-TW'?'繁體中文'"));
 assert(menuLine.includes('includeOther=true'));
 assert(menuLine.includes("...(includeOther?['und']:[])"));
 assert(source.includes('sourceFields(c)'));
 assert(source.includes('sourceFields(editing?c:null)'));
 assert(source.includes('profilePostingLanguageOptions(u,locale,languages,t,languageOptions)'));
 assert(!source.includes('<option value="custom"'),'do not offer manual language-code input in the UI');
 assert(!source.includes('name="source_language_code"'),'do not render language-code input');
 assert(source.includes('const saved=manual'),'editing an existing uncommon language must retain its selection');
 assert(source.includes('source_lang:label'),'standard manual language selection remains supported');
});

// D1-backed collector queue: dedupe, retry scheduling, preview-only gating, and URL safety.
test('collector queue persists candidates, rejects invalid URLs and honors retry windows',async()=>{
 const {collect,DB}=await collectFixture();
 const site='ask39',source_id='99663344',url='https://ask.39.net/question/99663344.html';
 const get=()=>collect('/api/collect/queue',undefined,{method:'GET',search:'?site='+site});
 const put=()=>collect('/api/collect/queue',{site,action:'enqueue',items:[{source_id,url}]});
 assert.equal((await put()).status,200);
 assert.equal((await put()).status,200);
 assert.equal(DB.db.prepare('SELECT count(*) AS n FROM collector_candidates WHERE site=? AND source_id=?').get(site,source_id).n,1);
 assert.deepEqual((await get()).data.items.map(x=>x.source_id),[source_id]);
 const invalid=await collect('/api/collect/queue',{site,action:'enqueue',items:[{source_id:'22',url:'https://www.120ask.com/question/22.htm'}]});
 assert.equal(invalid.status,400);
 const mismatch=await collect('/api/collect/queue',{site,action:'enqueue',items:[{source_id:'22',url:'https://ask.39.net/question/33.html'}]});
 assert.equal(mismatch.status,400);
 const mark=(status,reason='testing')=>collect('/api/collect/queue',{site,action:'mark',items:[{source_id,status,reason}]});
 assert.equal((await mark('completed')).status,200);
 assert.deepEqual((await get()).data.items.map(x=>x.source_id),[source_id],'unverified complete must not hide candidate');
 assert.equal((await mark('retry','timeout')).status,200);
 assert.deepEqual((await get()).data.items,[]);
 assert.equal((await put()).status,200);
 assert.deepEqual((await get()).data.items,[],'duplicate enqueue must preserve retry deadline');
 DB.db.prepare('UPDATE collector_candidates SET retry_at=? WHERE site=? AND source_id=?').run(now()-1,site,source_id);
 assert.deepEqual((await get()).data.items.map(x=>x.source_id),[source_id]);
 assert.equal((await mark('rejected','patient_narrative_too_short')).status,200);
 assert.deepEqual((await get()).data.items,[]);
 DB.db.prepare('UPDATE collector_candidates SET retry_at=? WHERE site=? AND source_id=?').run(now()-1,site,source_id);
 assert.deepEqual((await get()).data.items,[],'permanently rejected candidates must never retry automatically');
 const prod={DB:{prepare(){throw Error('production DB touched');}},APP_ENV:'production',IMPORT_ENABLED:'true',COLLECT_ENABLED:'true'};
 assert.equal((await collect('/api/collect/queue',undefined,{method:'GET',search:'?site='+site,env:prod})).status,403);
});


test('preview collector queue accepts modern Patient.info links with matching stable IDs only',async()=>{
 const {collect,DB}=await collectFixture();
 const site='patientinfo',source_id='621432';
 const valid='https://community.patient.info/t/lumbar-spine-fusion/621432';
 const post=(id,url)=>collect('/api/collect/queue',{site,action:'enqueue',items:[{source_id:id,url}]});
 const ok=await post(source_id,valid);
 assert.equal(ok.status,200,JSON.stringify(ok.data));
 assert.equal(DB.db.prepare("SELECT url FROM collector_candidates WHERE site=? AND source_id=?").get(site,source_id).url,valid);
 assert.equal((await post('621433',valid)).status,400);
 assert.equal((await post('621433','https://community.patient.info/t/lumbar-spine-fusion/621433?source=tracker')).status,400);
 assert.equal((await post('621433','https://example.org/t/lumbar-spine-fusion/621433')).status,400);
});


test('Mayo long threads resume from private D1 staging and publish 60 replies atomically',async()=>{
 const {collect,claim,DB}=await collectFixture();
 const source='long-lumbar-recovery';
 const token1=(await claim('mayoclinic',[source])).data.results[0].lease_token;
 const long=(action,token,extra={})=>collect('/api/collect/long/'+action,{
   site:'mayoclinic',source_id:source,lease_token:token,...extra
 });
 const meta={expected_pages:6,title:'Lumbar fusion recovery diary',
             body:'I had lumbar fusion surgery and recorded my progress over time.',
             source_lang:'en'};
 assert.equal((await long('start',token1,meta)).status,200);
 assert.equal((await long('start',token1,meta)).data.already_started,true);
 assert.equal((await long('start',token1,{...meta,expected_pages:401})).status,400);
 const chineseReply='这次我的腰椎疼痛已经缓解，之前久坐会疼，现在慢慢能走路，恢复过程还有一些问题。';
 const items=p=>Array.from({length:10},(_,i)=>{
   const number=(p-1)*10+i+1;
   return {source_comment_id:String(number),parent_source_comment_id:number===1?null:'1',
     body:number===2?chineseReply:'Detailed lumbar recovery reply '+number,source_lang:'en'};
 });
 assert.equal((await long('page',token1,{page_number:1,comments:items(1)})).status,200);
 assert.equal((await long('page',token1,{page_number:1,comments:items(1)})).data.already_saved,true);
 assert.equal((await long('page',token1,{page_number:1,comments:[items(1)[0]]})).status,409);
 assert.equal((await long('finish',token1)).status,409,'never publish incomplete pages');
 assert.equal(DB.db.prepare('SELECT COUNT(*) c FROM topics WHERE title=?').get(meta.title).c,0);
 assert.equal((await long('status',token1)).data.saved_replies,10);
 assert.equal((await collect('/api/collect/release',{site:'mayoclinic',source_id:source,lease_token:token1})).status,200);
 const token2=(await claim('mayoclinic',[source],'resume-worker')).data.results[0].lease_token;
 assert.equal((await long('status',token1)).status,409,'old lease must never read staging');
 assert.equal((await long('start',token2,meta)).data.already_started,true);
 assert.deepEqual((await long('status',token2)).data.pages.map(x=>x.page_number),[1]);
 for(let p=2;p<=6;p++)assert.equal((await long('page',token2,{page_number:p,comments:items(p)})).status,200);
 assert.equal(DB.db.prepare('SELECT COUNT(*) c FROM topics WHERE title=?').get(meta.title).c,0,'staging cannot leak to forum');
 const finished=await long('finish',token2);
 assert.equal(finished.status,200,JSON.stringify(finished.data));
 assert.equal(finished.data.imported.topics,1);
 assert.equal(finished.data.imported.comments,60);
 assert.equal(finished.data.persisted_comments,60);
 const topicId=finished.data.topic_id;
 assert.equal(DB.db.prepare('SELECT COUNT(*) c FROM comments WHERE topic_id=?').get(topicId).c,60);
 assert.equal(DB.db.prepare('SELECT reply_count c FROM topics WHERE id=?').get(topicId).c,60);
 const chinese=DB.db.prepare('SELECT id,source_lang,source_lang_mode FROM comments WHERE topic_id=? AND body=?').get(topicId,chineseReply);
 assert.equal(chinese.source_lang,'zh-CN','Mayo replies are not all automatically English');
 assert.equal(chinese.source_lang_mode,'auto');
 assert.equal(DB.db.prepare("SELECT method FROM content_language_verifications WHERE content_type='comment' AND content_id=?").get(chinese.id).method,'tinyld-heavy');
 const a=DB.db.prepare('SELECT id FROM comments WHERE topic_id=? AND body=?').get(topicId,'Detailed lumbar recovery reply 1');
 const b=DB.db.prepare('SELECT parent_comment_id p FROM comments WHERE topic_id=? AND body=?').get(topicId,'Detailed lumbar recovery reply 60');
 assert.equal(b.p,a.id);
 assert.equal(DB.db.prepare('PRAGMA foreign_key_check').all().length,0);
 assert.equal(DB.db.prepare('SELECT COUNT(*) c FROM collector_mayo_stage WHERE source_id=?').get(source).c,0);
 assert.equal(DB.db.prepare('SELECT state FROM collect_sources WHERE site=? AND source_id=?').get('mayoclinic',source).state,'completed');
 assert.equal((await collect('/api/topics/'+topicId,undefined,{method:'GET'})).status,200);
 const replay=await long('finish',token2);
 assert.equal(replay.status,200);
 assert.equal(replay.data.persisted_comments,60);
 assert.equal(DB.db.prepare('SELECT COUNT(*) c FROM comments WHERE topic_id=?').get(topicId).c,60,'no duplicate rows on replay');
 const denied={DB:{prepare(){throw Error('production DB used');}},APP_ENV:'production',IMPORT_ENABLED:'true',COLLECT_ENABLED:'true'};
 assert.equal((await collect('/api/collect/long/status',{site:'mayoclinic',source_id:source,lease_token:token2},{env:denied})).status,403);
});

test('Mayo long staging refuses incomplete parent trees without publishing partial data',async()=>{
 const {collect,claim,DB}=await collectFixture();
 const source='lumbar-parent-missing';
 const token=(await claim('mayoclinic',[source])).data.results[0].lease_token;
 const run=(action,data={})=>collect('/api/collect/long/'+action,{site:'mayoclinic',source_id:source,lease_token:token,...data});
 assert.equal((await run('start',{expected_pages:2,title:'Spinal recovery after surgery',
    body:'My lumbar surgery recovery experience',source_lang:'en'})).status,200);
 assert.equal((await run('page',{page_number:1,comments:[{source_comment_id:'10',parent_source_comment_id:null,
    body:'First reply',source_lang:'en'}]})).status,200);
 assert.equal((await run('page',{page_number:2,comments:[{source_comment_id:'20',parent_source_comment_id:'99',
    body:'References missing comment',source_lang:'en'}]})).status,200);
 assert.equal((await run('finish')).status,409);
 assert.equal(DB.db.prepare('SELECT COUNT(*) c FROM topics WHERE title=?').get('Spinal recovery after surgery').c,0);
 assert.equal(DB.db.prepare('SELECT COUNT(*) c FROM collector_mayo_pages WHERE source_id=?').get(source).c,2);
 // Explicitly reset a permanently-invalid stage; ordinary transient errors
 // retain the page checkpoint. Reset requires the active claim.
 assert.equal((await run('reset')).status,200);
 assert.equal(DB.db.prepare('SELECT COUNT(*) c FROM collector_mayo_stage WHERE source_id=?').get(source).c,0);
 assert.equal(DB.db.prepare('SELECT COUNT(*) c FROM collector_mayo_comments WHERE source_id=?').get(source).c,0);
 assert.equal((await run('status')).status,409);
});


test('Mayo only: reopen one legacy size rejection for a new long-thread parser',async()=>{
 const {collect,DB}=await collectFixture();
 const source_id='old-very-long-surgery';
 const url='https://connect.mayoclinic.org/discussion/'+source_id+'/';
 const enqueue=()=>collect('/api/collect/queue',{site:'mayoclinic',action:'enqueue',items:[{source_id,url}]});
 const get=()=>collect('/api/collect/queue',undefined,{method:'GET',search:'?site=mayoclinic'});
 assert.equal((await enqueue()).status,200);
 DB.db.prepare('UPDATE collector_candidates SET status=?,reason=?,attempts=1 WHERE site=? AND source_id=?')
  .run('rejected','mayoclinic_multipage_replies','mayoclinic',source_id);
 assert.equal((await get()).data.items.length,0);
 const retry=()=>collect('/api/collect/queue',{site:'mayoclinic',action:'reconsider',items:[{source_id}]});
 assert.equal((await retry()).status,200);
 assert.deepEqual((await get()).data.items.map(x=>x.source_id),[source_id]);
 DB.db.prepare('UPDATE collector_candidates SET status=?,reason=?,attempts=2 WHERE site=? AND source_id=?')
  .run('rejected','mayoclinic_multipage_replies','mayoclinic',source_id);
 assert.equal((await retry()).status,200);
 assert.deepEqual((await get()).data.items,[],'do not reopen repeated failures');
 const other=await collect('/api/collect/queue',{site:'ask39',action:'reconsider',items:[{source_id:'123'}]});
 assert.equal(other.status,400);
});

const {buildProjection,drainProjection}=await import('../.test-build/public-projection.js');

function projectionBucket(pageLimit=100) {
 const files=new Map();
 let seq=0;
 const bucket={
  files,listCalls:[],failPut:false,failList:false,onPut:null,
  async head(key){return files.get(key)||null;},
  async put(key,value,options){
   if(bucket.failPut)throw Error('R2 down');
   if(bucket.onPut)await bucket.onPut(key);
   const old=files.get(key);
   if(options.onlyIf?.etagMatches&&options.onlyIf.etagMatches!==old?.etag)return null;
   if(options.onlyIf?.etagDoesNotMatch==='*'&&old)return null;
   const object={key,etag:String(++seq),customMetadata:options.customMetadata,
    json:async()=>JSON.parse(value),value};
   files.set(key,object);
   return object;
  },
  async get(key){return bucket.head(key);},
  async list(options){
   bucket.listCalls.push(options);
   if(bucket.failList)throw Error('R2 list down');
   const matches=[...files.values()].filter(o=>o.key.startsWith(options.prefix)).sort((a,b)=>a.key<b.key?-1:1);
   const start=Number(options.cursor||0),end=start+Math.min(pageLimit,options.limit);
   const truncated=end<matches.length;
   return {objects:matches.slice(start,end),truncated,...(truncated?{cursor:String(end)}:{})};
  }
 };
 return bucket;
}
function enableProjection(env,bucket,environment='preview') {
 Object.assign(env,{APP_ENV:environment,PUBLIC_CONTENT_R2:bucket,
  PUBLIC_CONTENT_BASE_URL:environment==='preview'?'https://spine-data-dev.nbn369.com':'https://spine-data.nbn369.com',
  PUBLIC_CONTENT_ENABLED:'true',PUBLIC_CONTENT_READS:'true',CDN_ZONE_ID:'a'.repeat(32),CDN_PURGE_API_TOKEN:'test-only'});
}
const projectionRoot='/api/admin/public-projection';
const topicProjectionKey=id=>'topics/'+id+'/detail.json';
const projectionTask=(DB,scope,target)=>DB.db.prepare('SELECT * FROM public_projection WHERE scope=? AND target=?').get(scope,target);

test('projection outbox is atomic with direct D1 SQL, import and collection; repeats coalesce',async()=>{
 const f=await importFixture(),{DB,imp}=f;
 const {buildInserts,fingerprint}=await import('../scripts/sync-preview-to-production.mjs');
 const src={id:'isolated-sync',title:'Fixture topic',body:'Fictional original',source_lang:'en',created_at:123,symptom_duration_days:null};
 const comments=[{id:'test-parent',kind:'regular',body:'Parent',source_lang:'en',status:'published',created_at:124,parent_comment_id:null},
  {id:'test-child',kind:'regular',body:'Child',source_lang:'en',status:'published',created_at:125,parent_comment_id:'test-parent'}];
 const inserts=buildInserts(src,comments,[],fingerprint(src.title,src.body));
 DB.db.exec('BEGIN; '+inserts+' ROLLBACK;');
 assert.equal(projectionTask(DB,'topic',src.id),undefined);
 DB.db.exec('BEGIN; '+inserts+' COMMIT;');
 const task=projectionTask(DB,'topic',src.id);
 DB.db.exec('BEGIN; '+inserts+' COMMIT;');
 assert.equal(projectionTask(DB,'topic',src.id).version,task.version);
 const projected=await buildProjection(DB,'topic',src.id,1);
 assert.deepEqual(projected.data.comments.map(x=>[x.id,x.parent_comment_id]),[['test-parent',null],['test-child','test-parent']]);
 const imported=await imp('/api/import/batch',{topics:[{title:'Made-up test thread',body:'Test body'}]});
 assert.equal(imported.status,201,JSON.stringify(imported));
 assert.equal(DB.db.prepare("SELECT count(*) AS n FROM public_projection WHERE scope='topic'").get().n,2);
 f.env.COLLECT_ENABLED='true';
 const site='120ask',source_id='99990001';
 const claim=await imp('/api/collect/claim',{site,collector_id:'test-projection',source_ids:[source_id]});
 assert.equal(claim.status,200,JSON.stringify(claim));
 const lease_token=claim.data.results[0].lease_token;
 const collected=await imp('/api/collect/complete',{site,source_id,lease_token,topic:{title:'Fictional collector projection',body:'Synthetic test body',source_lang:'en'}});
 assert.equal(collected.status,201,JSON.stringify(collected));
 assert.equal(projectionTask(DB,'topic',collected.data.topic_id).state,'pending');
});

test('projection retries R2 and Purge independently, publishes public fields only and withdraws deleted content',async()=>{
 const {DB,env,call,topic}=await fixture(),bucket=projectionBucket();
 enableProjection(env,bucket);
 const key=topicProjectionKey(await topic('Public title','Public original'));
 const topicId=key.split('/')[1];
 await call('/api/me','PATCH',{nickname:'Public display',preferred_locale:'en',public_region:'Public region'},'alice');
 const parent=await call('/api/topics/'+topicId+'/comments','POST',{body:'Synthetic parent'},'bob');
 const child=await call('/api/topics/'+topicId+'/comments','POST',{body:'Synthetic child',parent_comment_id:parent.data.id},'carol');
 await call('/api/topics/'+topicId+'/comments','POST',{body:'promo code Private pending body'},'alice');
 const purge=[],original=globalThis.fetch;
 let rejectPurge=true;
 globalThis.fetch=async(url,options)=>{
  assert.match(url,/^https:\/\/api\.cloudflare\.com\/client\/v4\/zones\//);
  assert.equal(options.redirect,'manual');
  purge.push(JSON.parse(options.body).files);
  return Response.json({success:!rejectPurge});
 };
 const due=()=>DB.db.exec("UPDATE public_projection SET due_at=0 WHERE state='pending'");
 try{
  bucket.failPut=true;
  assert.equal((await drainProjection(env,2)).failed,2);
  assert.equal(purge.length,0);
  assert.match(projectionTask(DB,'topic',topicId).last_error,/r2_publish/);
  bucket.failPut=false;due();
  assert.equal((await drainProjection(env,2)).failed,2);
  const first=await bucket.head(key);
  assert.equal(projectionTask(DB,'topic',topicId).last_error,'purge_rejected');
  assert.equal(projectionTask(DB,'topic',topicId).published_version,0);
  rejectPurge=false;due();
  assert.equal((await drainProjection(env,4)).processed,2);
  assert.equal((await bucket.head(key)).etag,first.etag);
  const published=await first.json();
  assert.deepEqual(published.data.comments.map(c=>c.id),[parent.data.id,child.data.id]);
  assert.equal(published.data.topic.nickname,'Public display');
  assert.equal(published.data.topic.public_region,'Public region');
  assert(!/author_id|content_hash|Private pending body|token_hash|liked|bookmarked|followed/.test(first.value));
  assert.deepEqual(purge.at(-1),['https://spine-data-dev.nbn369.com/'+key,
    {url:'https://spine-data-dev.nbn369.com/'+key,headers:{Origin:IMPORT_ORIGIN}}]);
  await call('/api/comments/'+parent.data.id,'DELETE',undefined,'bob');
  await call('/api/topics/'+topicId,'DELETE',undefined,'alice');
  assert.equal(projectionTask(DB,'topic',topicId).priority,2);
  await drainProjection(env,4);
  const deleted=await (await bucket.get(key)).json();
  assert.equal(deleted.data.topic.body,null);
  assert.equal(deleted.data.topic.public_region,null);
  assert.equal(deleted.data.comments[0].body,null);
  assert.equal(deleted.data.comments[1].parent_comment_id,parent.data.id);
  assert(!JSON.stringify(deleted).includes('Public original'));
 }finally{globalThis.fetch=original;}
});

test('late R2 writers cannot overwrite a newer version and the newest reply page is eventually published',async()=>{
 const {DB,env,topic,call}=await fixture(),bucket=projectionBucket();
 enableProjection(env,bucket);
 const topicId=await topic('Concurrent test','Original before concurrent writes');
 const detail=topicProjectionKey(topicId);
 const original=globalThis.fetch;
 globalThis.fetch=async()=>Response.json({success:true});
 try{
  await drainProjection(env,4);
  await call('/api/topics/'+topicId,'PATCH',{title:'Version B',body:'Intermediate'},'alice');
  let unblock,arrived;
  const wait=new Promise(resolve=>{unblock=resolve;});
  const entered=new Promise(resolve=>{arrived=resolve;});
  bucket.onPut=async key=>{if(key!==detail)return;bucket.onPut=null;arrived();await wait;};
  const stale=drainProjection(env,2);
  await entered;
  await call('/api/topics/'+topicId,'PATCH',{title:'Version C',body:'Newest'},'alice');
  DB.db.prepare("UPDATE public_projection SET lease_until=0 WHERE scope='topic' AND target=?").run(topicId);
  await drainProjection(env,4);
  unblock();
  await stale;
  assert.equal((await (await bucket.get(detail)).json()).data.topic.body,'Newest');
  assert.equal(projectionTask(DB,'topic',topicId).state,'done');
  const insert=DB.db.prepare("INSERT INTO comments(id,topic_id,author_id,body,status) VALUES(?,?,'bob',?,'published')");
  DB.db.exec('BEGIN');
  for(let i=0;i<51;i++)insert.run('page-reply-'+i,topicId,'Fictional reply '+i);
  DB.db.exec('COMMIT');
  await drainProjection(env,8);
  const p1=await (await bucket.get(detail)).json();
  const p2key='topics/'+topicId+'/comments/page-2.json';
  const p2=await (await bucket.get(p2key)).json();
  assert.equal(p1.data.comments.length,50);
  assert.equal(p2.data.comments.length,1);
  assert.equal(p1.contentVersion,p2.contentVersion);
  await call('/api/admin/content','POST',{type:'topic',id:topicId,action:'hide',reason:'fixture'},'admin');
  await drainProjection(env,8);
  assert.equal((await (await bucket.get(detail)).json()).data,null);
  assert.equal((await (await bucket.get(p2key)).json()).data,null);
 }finally{globalThis.fetch=original;}
});

test('Preview exposes config readiness without credentials and scheduled handler does not scan R2',async()=>{
 const {env,call}=await fixture(),bucket=projectionBucket();
 enableProjection(env,bucket);
 delete env.CDN_ZONE_ID;
 const health=(await call('/api/health')).data;
 assert.deepEqual(health.publicContent,{baseUrl:null,onDemand:false,fallback:false,ready:true,enabled:true,purgeConfigured:false,zoneConfigured:false,tokenConfigured:true});
 assert(!JSON.stringify(health).includes('test-only'));
 assert.equal((await drainProjection(env)).configured,false);
 let jobs=[];
 const ctx={waitUntil(p){jobs.push(p);}};
 await worker.scheduled({},env,ctx);
 assert.equal(jobs.length,0);
 enableProjection(env,bucket,'production');
 const original=globalThis.fetch;
 globalThis.fetch=async()=>Response.json({success:true});
 try{
  await worker.scheduled({},env,ctx);
  await Promise.all(jobs);
  assert.equal(bucket.listCalls.length,0);
  assert.equal((await call(projectionRoot+'/drain','POST',{},'admin')).status,403);
 }finally{globalThis.fetch=original;}
});

test('owner scan resumes with short R2 pages, classifies discrepancies, and requires confirmation to repair',async()=>{
 const {DB,env,call,topic}=await fixture(),bucket=projectionBucket(1);
 enableProjection(env,bucket);
 const a=await topic('Scan A','Body A'),b=await topic('Scan B','Body B','bob'),c=await topic('Scan C','Body C','carol');
 const original=globalThis.fetch;
 globalThis.fetch=async()=>Response.json({success:true});
 try{
  await drainProjection(env,8);
  bucket.files.delete(topicProjectionKey(a));
  bucket.files.get(topicProjectionKey(b)).customMetadata.projectionVersion='0';
  bucket.files.get(topicProjectionKey(c)).customMetadata.payloadHash='incorrect';
  const orphan=topicProjectionKey('orphan');
  await bucket.put(orphan,'{"data":"fixture"}',{customMetadata:{projectionVersion:'3',payloadHash:'old'}});
  assert.equal((await call(projectionRoot,'GET',undefined,null)).status,401);
  assert.equal((await call(projectionRoot+'/start','POST',{},'mod')).status,403);
  const start=await call(projectionRoot+'/start','POST',{include_orphans:true},'admin');
  assert.equal(start.status,201,JSON.stringify(start));
  const scan=start.data.scan.id;
  assert.equal((await call(projectionRoot+'/start','POST',{},'admin')).status,409);
  const action=(op,input={})=>call(projectionRoot+'/'+op,'POST',{scan,...input},'admin');
  await action('step');
  bucket.failList=true;
  const failed=await action('step');
  assert.equal(failed.data.scan.error,'batch_failed_retry');
  assert.equal(failed.data.scan.listed_count,1);
  bucket.failList=false;
  assert.equal((await action('pause')).data.scan.paused,true);
  assert.equal((await action('step')).status,409);
  await action('resume');
  let report;
  for(let i=0;i<12;i++){
   report=(await action('step')).data.scan;
   if(report.phase==='complete')break;
  }
  assert.equal(report.phase,'complete');
  assert.equal(report.checked_count,4);
  assert.deepEqual(report.counts,{mismatch:1,missing:1,ok:1,orphan:1,outdated:1});
  assert(bucket.listCalls.some(req=>req.prefix==='topics/'&&req.cursor==='1'));
  assert.equal((await action('repair',{keys:[orphan]})).status,400);
  assert.equal((await action('repair',{keys:[orphan,topicProjectionKey(a)],confirm:true})).status,200);
  const version=projectionTask(DB,'topic','orphan').version;
  assert.equal((await action('repair',{keys:[orphan],confirm:true})).status,200);
  assert.equal(projectionTask(DB,'topic','orphan').version,version);
  await drainProjection(env,10);
  assert.equal((await (await bucket.get(orphan)).json()).data,null);
  assert.equal((await (await bucket.get(topicProjectionKey(a))).json()).data.topic.id,a);
 }finally{globalThis.fetch=original;}
});

test('scan snapshots more than 1000 objects and identifies a write during check',async()=>{
 const {DB,env,call,topic}=await fixture(),bucket=projectionBucket(64);
 enableProjection(env,bucket);
 const target=await topic('Snapshot fixture','This is synthetic');
 // Reserve retired pages to exercise the fixed key inventory without copying real data.
 DB.db.prepare("UPDATE public_projection SET last_object=1001 WHERE target=?").run(target);
 for(let index=1;index<=1001;index++){
  const key=index===1?topicProjectionKey(target):'topics/'+target+'/comments/page-'+index+'.json';
  await bucket.put(key,'{}',{customMetadata:{projectionVersion:'1',payloadHash:'test'}});
 }
 const started=await call(projectionRoot+'/start','POST',{target,deep:true},'admin');
 assert.equal(started.data.scan.expected_count,1001);
 const scan=started.data.scan.id;
 const action=op=>call(projectionRoot+'/'+op,'POST',{scan},'admin');
 let current=started.data.scan;
 for(let i=0;current.phase==='listing'&&i<17;i++)current=(await action('step')).data.scan;
 assert.equal(current.phase,'comparing');
 assert.equal(current.listed_count,1001);
 assert.equal(bucket.listCalls.length,16);
 assert.equal(bucket.listCalls.at(-1).cursor,'960');
 await call('/api/topics/'+target+'/comments','POST',{body:'Write during the scan'},'bob');
 const compared=await action('step');
 assert.equal(compared.data.scan.counts.changed_during_scan,5);
 assert.equal((await action('cancel')).data.scan.phase,'partial');
});

test('anonymous standard routes fetch only their CDN host, pagination rejects stale versions, and private reads stay on Worker',async()=>{
 const {publicContentReader}=await import('../public/public-content.js');
 const requests=[];
 const api=async path=>{requests.push(path);return {worker:true};};
 let version=2,withdrawn=false;
 const fetcher=async(url,options)=>{
  requests.push(url);
  assert.equal(options.credentials,'omit');
  return Response.json({schemaVersion:1,contentVersion:version,topicId:'demo',data:withdrawn?null:
   {topics:[],topic:{id:'demo'},comments:[],progress:[]}});
 };
 const health={environment:'preview',publicContent:{baseUrl:'https://spine-data-dev.nbn369.com',fallback:true}};
 const reader=publicContentReader(health,null,api,fetcher);
 assert.equal((await reader.feed(new URLSearchParams('sort=latest'))).projectionVersion,2);
 assert.equal((await reader.topic('demo',new URLSearchParams())).projectionVersion,2);
 version=3;
 assert.equal((await reader.topic('demo',new URLSearchParams('before=10'),2,2)).worker,true);
 assert.equal((await reader.feed(new URLSearchParams('offset=20'),2)).worker,true);
 assert.equal((await reader.topic('demo',new URLSearchParams('focus=reply'))).worker,true);
 assert.equal((await reader.feed(new URLSearchParams('body_part=neck'))).worker,true);
 withdrawn=true;
 await assert.rejects(reader.topic('demo',new URLSearchParams()),error=>error.status===404);
 assert(requests.filter(url=>url.startsWith('https:')).every(url=>url.startsWith(health.publicContent.baseUrl)&&!url.includes('?')));
});

test('exhausted outbox keeps backoff across normal edits and is released by an owner retry',async()=>{
 const {DB,env,call,topic}=await fixture(),bucket=projectionBucket();
 enableProjection(env,bucket);
 const target=await topic('Outbox dead letter fixture','Synthetic fixture');
 const setDead=DB.db.prepare("UPDATE public_projection SET state='dead',attempts=8,priority=1,due_at=unixepoch()+600 WHERE target=?");
 setDead.run(target);
 const old=projectionTask(DB,'topic',target);
 await call('/api/topics/'+target+'/like','PUT',{},'bob');
 const task=projectionTask(DB,'topic',target);
 assert.equal(task.state,'dead');
 assert.equal(task.attempts,8);
 assert.equal(task.due_at,old.due_at);
 assert(task.version>old.version);
 assert.equal((await call(projectionRoot+'/retry','POST',{key:topicProjectionKey(target),confirm:true},'admin')).status,200);
 assert.equal(projectionTask(DB,'topic',target).state,'pending');
});

test('on-demand projection warms exact public pages and invalidates existing copies without eager publication',async()=>{
 const {DB,env,call,topic}=await fixture(),bucket=projectionBucket();
 const {drainPublicContent}=await import('../.test-build/projection-demand.js');
 enableProjection(env,bucket);
 Object.assign(env,{PUBLIC_CONTENT_ON_DEMAND:'true',PUBLIC_CONTENT_FALLBACK:'true'});
 const main=await topic('On-demand topic','Synthetic original body');
 const other=await topic('Cold topic','Synthetic cold body');
 const paths=['feeds/latest/page-1.json',topicProjectionKey(main),`topics/${main}/comments/page-2.json`];
 for(let i=0;i<51;i++)DB.db.prepare("INSERT INTO comments(id,topic_id,author_id,body,status) VALUES(?,?,? ,?,'published')")
   .run('on-demand-reply-'+i,main,'bob','Synthetic reply '+i);
 const cursor=DB.db.prepare("SELECT rowid FROM comments WHERE id='on-demand-reply-49'").get().rowid;
 const originFetch=globalThis.fetch;
 const purges=[];
 globalThis.fetch=async(url,options)=>{
  assert.match(url,/^https:\/\/api\.cloudflare\.com\//);
  purges.push(JSON.parse(options.body));
  return Response.json({success:true});
 };
 const background=[];
 const ctx={waitUntil:p=>background.push(p)};
 const flush=async()=>{await Promise.all(background.splice(0));};
 const fallback=(path,key,user=null)=>call(path,'GET',undefined,user,{'x-spine-projection-miss':key},ctx);
 try{
  assert.equal((await drainPublicContent(env,8)).processed,0);
  assert.equal(bucket.files.size,0);
  const health=await call('/api/health','GET',undefined,null);
  assert.equal(health.data.publicContent.onDemand,true);
  assert.equal((await fallback('/api/topics/'+other,paths[1])).status,200);
  assert.equal((await fallback('/api/topics/'+other,paths[1],'bob')).status,200);
  assert.equal((await fallback('/api/topics/missing',topicProjectionKey('missing'))).status,404);
  await flush();
  assert.equal(bucket.files.size,0);
  const feed=await fallback('/api/topics?sort=latest',paths[0]);
  assert.equal(feed.status,200);
  await flush();
  assert.deepEqual([...bucket.files.keys()],paths.slice(0,1));
  const detail=await fallback('/api/topics/'+main,paths[1],'bob');
  assert.equal(detail.data.topic.body,'Synthetic original body');
  await flush();
  assert.deepEqual([...bucket.files.keys()],paths.slice(0,2));
  await fallback('/api/topics/'+main+'?before=1',paths[2]);
  await flush();
  assert.equal(bucket.files.size,2);
  const reply=await fallback('/api/topics/'+main+'?before='+cursor,paths[2]);
  assert.equal(reply.data.comments[0].id,'on-demand-reply-50');
  await flush();
  assert.deepEqual([...bucket.files.keys()],paths);
  assert.equal((await bucket.get(paths[2]).then(r=>r.json())).data.comments[0].id,'on-demand-reply-50');
  const oldTag=(await bucket.head(paths[1])).etag;
  await fallback('/api/topics/'+main,paths[1]);
  await flush();
  assert.equal((await bucket.head(paths[1])).etag,oldTag);
  assert.equal(purges.length,3);

  await call('/api/topics/'+main,'PATCH',{title:'On-demand edited',body:'Synthetic changed body'},'alice',{},ctx);
  await flush();
  await drainPublicContent(env,6);
  for(const path of paths){
   const invalidated=await bucket.get(path);
   assert.equal(invalidated.customMetadata.visibility,'invalidated');
   assert.equal((await invalidated.json()).invalidated,true);
   assert(!invalidated.value.includes('Synthetic original body'));
  }
  await fallback('/api/topics/'+main,paths[1]);
  await flush();
  assert.equal((await bucket.get(paths[1]).then(r=>r.json())).data.topic.body,'Synthetic changed body');
  assert.equal((await bucket.get(paths[0]).then(r=>r.json())).invalidated,true);
  assert.equal((await bucket.get(paths[2]).then(r=>r.json())).invalidated,true);

  const hidden=await call('/api/admin/content','POST',{type:'topic',id:main,action:'hide',reason:'fixture'},'admin',{},ctx);
  assert.equal(hidden.status,200);
  await flush();
  await drainPublicContent(env,6);
  assert.equal((await bucket.get(paths[1]).then(r=>r.json())).data,null);
  assert.equal((await bucket.get(paths[2]).then(r=>r.json())).data,null);
  assert.equal((await fallback('/api/topics/'+main,paths[1])).status,404);
  await flush();
  assert.equal((await bucket.get(paths[1]).then(r=>r.json())).data,null);
  assert.equal(await bucket.get(topicProjectionKey(other)),null);
  assert(purges.some(purge=>purge.prefixes?.includes('spine-data-dev.nbn369.com/'+paths[1])));
 }finally{globalThis.fetch=originFetch;}
});

test('on-demand browser fallback distinguishes a missing or invalidated object from failure or withdrawal',async()=>{
 const {publicContentReader}=await import('../public/public-content.js');
 const calls=[];
 const health={environment:'preview',publicContent:{baseUrl:'https://spine-data-dev.nbn369.com',fallback:true,onDemand:true}};
 const api=async(path,options)=>{calls.push([path,options]);return {worker:true};};
 let result=new Response(null,{status:404});
 const reader=publicContentReader(health,null,api,async()=>result.clone());
 await reader.topic('old',new URLSearchParams());
 assert.deepEqual(calls.at(-1),['/api/topics/old?',{headers:{'x-spine-projection-miss':'topics/old/detail.json'}}]);
 await reader.feed(new URLSearchParams('offset=20'),1);
 assert.deepEqual(calls.at(-1),['/api/topics?',{headers:{'x-spine-projection-miss':'feeds/latest/page-2.json'}}]);
 result=Response.json({schemaVersion:1,contentVersion:2,topicId:'old',invalidated:true,data:{}});
 await reader.topic('old',new URLSearchParams());
 assert.equal(calls.at(-1)[1].headers['x-spine-projection-miss'],'topics/old/detail.json');
 result=new Response('broken',{status:503});
 await reader.topic('old',new URLSearchParams());
 assert.equal(calls.at(-1)[1],undefined);
 result=Response.json({schemaVersion:1,contentVersion:3,topicId:'old',data:null});
 const count=calls.length;
 await assert.rejects(reader.topic('old',new URLSearchParams()),error=>error.status===404);
 assert.equal(calls.length,count);
});

test('a late on-demand R2 write cannot restore a withdrawn page',async()=>{
 const {DB,env,call,topic}=await fixture(),bucket=projectionBucket();
 const {drainPublicContent}=await import('../.test-build/projection-demand.js');
 enableProjection(env,bucket);
 Object.assign(env,{PUBLIC_CONTENT_ON_DEMAND:'true',PUBLIC_CONTENT_FALLBACK:'true'});
 const target=await topic('Race fixture','Synthetic text to withdraw');
 const key=topicProjectionKey(target);
 const originalFetch=globalThis.fetch;
 globalThis.fetch=async()=>Response.json({success:true});
 const background=[];
 const ctx={waitUntil:p=>background.push(p)};
 let paused,continuePut;
 const atPut=new Promise(resolve=>{paused=resolve;});
 const resume=new Promise(resolve=>{continuePut=resolve;});
 bucket.onPut=async name=>{if(name===key){bucket.onPut=null;paused();await resume;}};
 try{
  const fallback=await call('/api/topics/'+target,'GET',undefined,null,{'x-spine-projection-miss':key},ctx);
  assert.equal(fallback.status,200);
  await atPut;
  await call('/api/admin/content','POST',{type:'topic',id:target,action:'hide',reason:'fixture'},'admin');
  DB.db.prepare("UPDATE public_projection SET lease_until=0 WHERE scope='topic' AND target=?").run(target);
  assert.equal((await drainPublicContent(env,2)).processed,2);
  assert.equal((await bucket.get(key).then(r=>r.json())).data,null);
  continuePut();
  await Promise.all(background);
  assert.equal((await bucket.get(key).then(r=>r.json())).data,null);
 }finally{continuePut();globalThis.fetch=originalFetch;}
});

function mockTranslator(env,DB,extra={}){
 Object.assign(env,{TRANSLATION_ENABLED:'true',TRANSLATOR_KEY:'test-only',
  TRANSLATOR_F0_VERIFIED_AT:new Date(Date.now()-60000).toISOString(),...extra});
 DB.db.exec("UPDATE settings SET value='true' WHERE key='translation_enabled'");
}
const translatedByMock=(url,options)=>{
 const to=new URL(url).searchParams.get('to'), input=JSON.parse(options.body);
 return Response.json(input.map(({Text})=>({translations:[{to,text:'mock '+Text}]})),{
  headers:{'x-metered-usage':String(input.reduce((n,{Text})=>n+Text.length,0))}
 });
};
const translationBatch=(call,items,{locale='en',generate=true,ctx}={})=>
 call('/api/translate','POST',{locale,items,generate},null,{},ctx);
const translationItem=(id,options={})=>({id,type:'topic',scope:'full',version:1,...options});

test('legacy English medical post is recognized and translated, without trusting its old language label blindly',async t=>{
 const {DB,env,call}=await fixture();
 mockTranslator(env,DB);
 const title='Is it possible to get pre authorization for injections in back for degenerative disc disease?';
 const body='Medicare denied the claim I had done last July.';
 const {detectSourceLanguage}=await import('../.test-build/source-language.js');
 assert.equal(detectSourceLanguage(title,body),'en','screenshot English should not be und');
 assert.equal(detectSourceLanguage('OK'),'und');
 assert.equal(detectSourceLanguage('I have persistent back pain after standing. Me duele mucho la espalda desde hace dos meses.'),'und');
 DB.db.prepare("INSERT INTO topics(id,author_id,title,body,source_lang,status) VALUES('english-legacy','bob',?,?,'en','published')").run(title,body);
 let calls=0,from;
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  calls++;
  from=new URL(url).searchParams.get('from');
  return translatedByMock(url,options);
 });
 const response=await translationBatch(call,[translationItem('english-legacy')],{locale:'zh-CN'});
 assert.equal(response.status,200,JSON.stringify(response.data));
 assert.equal(response.data.items[0].translated,true,JSON.stringify(response.data));
 assert.equal(from,'en');
 assert.equal(calls,1);
 const cached=DB.db.prepare("SELECT source_language FROM topic_translations WHERE topic_id='english-legacy' AND locale='zh-CN'").get();
 assert.equal(cached.source_language,'en');
});

test('import and collector keep unverified source hints separate from Heavy auto labels',async()=>{
 const {DB,imp,call}=await importFixture();
 const r=await imp('/api/import/topics',{
  title:'A long English back pain account',
  body:'I have had lower back pain for a long time and I am now seeing a physiotherapist after work.',
  source_lang:'fr'
 });
 assert.equal(r.status,201,JSON.stringify(r.data));
 const topicId=r.data.results[0].id;
 const saved=DB.db.prepare('SELECT source_lang,source_lang_mode FROM topics WHERE id=?').get(topicId);
 assert.equal(saved.source_lang,'en','independent detector overrides wrong imported hint');
 assert.equal(saved.source_lang_mode,'auto');
 const evidence=DB.db.prepare('SELECT method FROM content_language_verifications WHERE content_type=? AND content_id=?').get('topic',topicId);
 assert.equal(evidence.method,'tinyld-heavy');
 const short=await imp('/api/import/topics',{title:'OK',body:'OK',source_lang:'fr'});
 assert.equal(short.status,201,JSON.stringify(short.data));
 const shortId=short.data.results[0].id;
 const unverified=DB.db.prepare('SELECT source_lang,source_lang_mode FROM topics WHERE id=?').get(shortId);
 assert.equal(unverified.source_lang,'und','uncertain imported hints must not be treated as indexed originals');
 assert.equal(unverified.source_lang_mode,'legacy');
});

test('language verifications are versioned and deleted content removes old evidence',async()=>{
 const {DB,call,topic}=await fixture();
 const id=await topic('My lower back hurts after sitting at my desk for a long time',
  'I want to understand which exercises might help after the physiotherapist explained my recovery plan.', 'alice',{source_lang_mode:'auto'});
 assert.equal(DB.db.prepare('SELECT count(*) n FROM content_language_verifications WHERE content_id=?').get(id).n,1);
 await call('/api/topics/'+id,'PATCH',{title:'Updated history',body:'The recovery process is different now.',source_lang_mode:'manual',source_lang:'fr'});
 assert.equal(DB.db.prepare('SELECT count(*) n FROM content_language_verifications WHERE content_id=?').get(id).n,0);
 await call('/api/topics/'+id,'PATCH',{title:'Updated again',body:'The recovery process is different now.',source_lang_mode:'auto'});
 const before=DB.db.prepare('SELECT count(*) n FROM content_language_verifications WHERE content_id=?').get(id).n;
 assert(before>=0);
 await call('/api/topics/'+id,'DELETE',{});
 assert.equal(DB.db.prepare('SELECT count(*) n FROM content_language_verifications WHERE content_id=?').get(id).n,0);
});

test('Azure autodetect confirms unknown originals once and reuses D1 for later languages',async t=>{
 const {call,DB,env,topic}=await fixture();
 mockTranslator(env,DB);
 const id=await topic('OK','OK','alice',{source_lang_mode:'auto'});
 const original=(await call('/api/topics/'+id)).data.topic;
 assert.equal(original.source_lang,'und');
 let count=0,from;
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  count++;from=new URL(url).searchParams.get('from');
  const data=JSON.parse(options.body);
  return Response.json(data.map(({Text})=>({
   detectedLanguage:{language:'en',score:.98},
   translations:[{text:'translated '+Text,to:'zh-Hans'}]
  })));
 });
 const first=await translationBatch(call,[translationItem(id)],{locale:'zh-CN'});
 assert.equal(first.status,200,JSON.stringify(first.data));
 assert.equal(first.data.items[0].translated,true,JSON.stringify(first.data));
 assert.equal(from,null,'Azure receives no from= when source is not known');
 assert.equal(count,1);
 const verification=DB.db.prepare('SELECT language,method FROM content_language_verifications WHERE content_type=? AND content_id=?').get('topic',id);
 assert.equal(verification.language,'en');
 assert.equal(verification.method,'azure-auto');
 const cached=await translationBatch(call,[translationItem(id)],{locale:'zh-CN'});
 assert.equal(cached.data.items[0].translated,true);
 assert.equal(count,1,'cached translation must not contact Azure');
 const same=await translationBatch(call,[translationItem(id)],{locale:'en'});
 assert.equal(same.data.items[0].reason,'same_language');
 assert.equal(count,1,'verified language lets subsequent matching visitors skip translation');
 const {buildProjection}=await import('../.test-build/public-projection.js');
 const projected=await buildProjection(DB,'topic',id,1,false);
 assert.equal(projected.data.topic.source_lang,'en');
 assert.equal(projected.data.topic.source_lang_mode,'auto');
});

test('Azure unknown language that matches target is confirmed but not translated twice',async t=>{
 const {call,env,DB,topic}=await fixture();
 mockTranslator(env,DB);
 const id=await topic('OK','OK','alice',{source_lang_mode:'auto'});
 let count=0;
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  count++;assert.equal(new URL(url).searchParams.get('from'),null);
  return Response.json(JSON.parse(options.body).map(({Text})=>({
   detectedLanguage:{language:'en',score:.99},
   translations:[{text:Text,to:'en'}]
  })));
 });
 const first=await translationBatch(call,[translationItem(id)],{locale:'en'});
 assert.equal(first.data.items[0].reason,'same_language',JSON.stringify(first.data));
 assert.equal(DB.db.prepare('SELECT count(*) n FROM topic_translations WHERE topic_id=?').get(id).n,0);
 const again=await translationBatch(call,[translationItem(id)],{locale:'en'});
 assert.equal(again.data.items[0].reason,'same_language');
 assert.equal(count,1);
});

test('Azure generic Chinese source is stored without guessing simplified/traditional',async t=>{
 const {call,env,DB,topic}=await fixture();
 mockTranslator(env,DB);
 const tid=await topic('OK','OK','alice',{source_lang_mode:'auto'});
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  assert.equal(new URL(url).searchParams.get('from'),null);
  return Response.json(JSON.parse(options.body).map(({Text})=>({
    detectedLanguage:{language:'zh',score:.99},translations:[{text:'内容 '+Text,to:'zh-Hans'}]
  })));
 });
 const r=await translationBatch(call,[translationItem(tid)],{locale:'zh-CN'});
 assert.equal(r.data.items[0].translated,true,JSON.stringify(r.data));
 const saved=DB.db.prepare('SELECT language FROM content_language_verifications WHERE content_type=? AND content_id=?').get('topic',tid);
 assert.equal(saved.language,'zh');
 const {buildProjection}=await import('../.test-build/public-projection.js');
 assert.equal((await buildProjection(DB,'topic',tid,1,false)).data.topic.source_lang,'zh');
});

test('Azure autodetect refuses low-confidence and mixed-language results',async t=>{
 const {call,env,DB,topic}=await fixture();
 mockTranslator(env,DB);
 const id=await topic('OK','OK','alice',{source_lang_mode:'auto'});
 let mode='low';
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  const values=JSON.parse(options.body);
  return Response.json(values.map(({Text},i)=>({
   detectedLanguage:{language:mode==='mixed'&&i===0?'es':'en',score:mode==='low'?0.2:0.99},
   translations:[{text:'translated '+Text,to:'fr'}]
  })));
 });
 const low=await translationBatch(call,[translationItem(id)],{locale:'fr'});
 assert.equal(low.data.items[0].reason,'source_language_uncertain');
 mode='mixed';
 const mixed=await translationBatch(call,[translationItem(id)],{locale:'fr'});
 assert.equal(mixed.data.items[0].reason,'source_language_uncertain');
 assert.equal(DB.db.prepare('SELECT count(*) n FROM content_language_verifications WHERE content_id=?').get(id).n,0);
 assert.equal(DB.db.prepare('SELECT count(*) n FROM topic_translations WHERE topic_id=?').get(id).n,0);
});

test('administrator language review client has no implicit public access or reload',async()=>{
 const view=readFileSync('public/language-admin.js','utf8');
 const app=readFileSync('public/app.js','utf8');
 assert.match(app,/languageReview/);
 assert.match(app,/state.user.role==='admin'/);
 assert.match(app,/renderLanguageReview/);
 assert.match(app,/language-review-form/);
 assert.match(view,/\/api\/admin\/language-review/);
 assert.match(view,/source_lang/);
 const {renderLanguageReview}=await import('../public/language-admin.js');
 const target={innerHTML:''};
 await renderLanguageReview(target,async()=>({items:[{id:'demo',type:'topic',title:'Sample',
  preview:'English sentence',source_lang:'und',source_lang_mode:'auto'}]}),x=>String(x),'zh-CN');
 assert.match(target.innerHTML,/语言/);
 assert.match(target.innerHTML,/language-review-form/);
});

test('owner language review is protected and invalidates cached translations on correction',async()=>{
 const {call,env,DB,topic}=await fixture();
 const id=await topic('OK','OK','alice',{source_lang_mode:'auto'});
 const all=await call('/api/admin/language-review','GET',undefined,'admin');
 assert.equal(all.status,200,JSON.stringify(all));
 assert(all.data.items.some(x=>x.id===id));
 assert.equal((await call('/api/admin/language-review','GET',undefined,'bob')).status,403);
 assert.equal((await call('/api/admin/language-review','GET',undefined,'mod')).status,403);
 assert.equal((await call('/api/admin/language-review','POST',{type:'topic',id,source_lang:'es',reason:'verified'},'mod')).status,403);
 assert.equal((await call('/api/admin/language-review','POST',{type:'topic',id,source_lang:'bad!',reason:'verified'},'admin')).status,400);
 DB.db.prepare("INSERT INTO topic_translations(topic_id,locale,source_version,title_text,body_text,provider) VALUES(?,'zh-CN',1,'cached','cached','test')").run(id);
 const saved=await call('/api/admin/language-review','POST',{type:'topic',id,source_lang:'es',reason:'original is Spanish'},'admin');
 assert.equal(saved.status,200,JSON.stringify(saved));
 assert.equal(saved.data.version,2);
 const topicAfter=(await call('/api/topics/'+id)).data.topic;
 assert.equal(topicAfter.source_lang,'es');
 assert.equal(topicAfter.source_lang_mode,'manual');
 const evidence=DB.db.prepare('SELECT language,method FROM content_language_verifications WHERE content_type=? AND content_id=? AND content_version=?').get('topic',id,2);
 assert.equal(evidence.language,'es');
 assert.equal(evidence.method,'admin-manual');
 const {buildProjection}=await import('../.test-build/public-projection.js');
 const projection=(await buildProjection(DB,'topic',id,1,false)).data.topic;
 assert.equal(projection.source_lang,'es');
 assert.equal(projection.source_lang_mode,'manual');
 assert.equal(DB.db.prepare('SELECT count(*) n FROM topic_translations WHERE topic_id=?').get(id).n,0);
 assert.equal(DB.db.prepare("SELECT count(*) n FROM moderation_actions WHERE target_id=? AND target_type='topic' AND action='correct_language'").get(id).n,1);
 assert(!(await call('/api/admin/language-review','GET',undefined,'admin')).data.items.some(x=>x.id===id));
});

test('automatic source detection overrides the suggested locale, and authors can correct it',async t=>{
 const {call,DB,env}=await fixture();
 mockTranslator(env,DB);
 const {detectSourceLanguage}=await import('../.test-build/source-language.js');
 assert.equal(detectSourceLanguage('My back hurts when I sit for a long time'),'en');
 assert.equal(detectSourceLanguage('我最近腰椎间盘突出，坐久以后右腿会麻，正在做康复训练。'),'zh-CN');
 assert.equal(detectSourceLanguage('這幾天頸椎很不舒服，復健之後症狀有緩解。'),'zh-TW');
 assert.equal(detectSourceLanguage('最近は長く座ると腰が痛くて、リハビリを続けています。'),'ja');
 assert.equal(detectSourceLanguage('I have persistent back pain after standing. Me duele mucho la espalda desde hace dos meses.'),'und');
 assert.equal(detectSourceLanguage('OK'),'und');
 const title='Douleur au bas du dos',body='J’ai très mal au bas du dos depuis plusieurs mois. La kinésithérapie m’aide à bouger.';
 const created=await call('/api/topics','POST',{title,body,source_lang_mode:'auto',source_lang:'en'});
 assert.equal(created.status,201);
 const id=created.data.id;
 assert.equal((await call('/api/topics/'+id)).data.topic.source_lang,'fr');
 const reply=await call('/api/topics/'+id+'/comments','POST',{body:'OK',source_lang_mode:'auto',source_lang:'ja'},'bob');
 assert.equal(reply.data.comment.source_lang,'und');
 assert.equal(reply.data.comment.source_lang_mode,'auto');
 let external=0;
 t.mock.method(globalThis,'fetch',async(url,opts)=>{external++;return translatedByMock(url,opts);});
 const same=await translationBatch(call,[translationItem(id)],{locale:'fr'});
 assert.equal(same.data.items[0].reason,'same_language');
 const uncertain=await translationBatch(call,[translationItem(reply.data.id,{type:'comment'})]);
 assert.equal(uncertain.data.items[0].reason,'source_language_uncertain');
 // Unknown short text now attempts one budgeted Azure auto-detection; a
 // response lacking detectedLanguage must not be cached as trustworthy.
 assert.equal(external,1);
 const edit=await call('/api/topics/'+id,'PATCH',{title,body,source_lang_mode:'manual',source_lang:'es'});
 assert.equal(edit.status,200);
 const updated=(await call('/api/topics/'+id)).data.topic;
 assert.equal(updated.source_lang,'es');
 assert.equal(updated.source_lang_mode,'manual');
 assert.equal(updated.content_version,2);
 assert.equal((await translationBatch(call,[translationItem(id,{version:2})],{locale:'es'})).data.items[0].reason,'same_language');
});

test('cache-only reads, summary and detail share the title, and each cache row records actual provenance',async t=>{
 const {call,DB,env,topic}=await fixture();
 mockTranslator(env,DB);
 const title='A practice log',body='I have been practicing the exercises from physical therapy. '.repeat(7);
 const id=await topic(title,body);
 const summary=translationItem(id,{scope:'summary'}),full=translationItem(id);
 const requests=[];
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  const parsed=new URL(url);
  assert.equal(parsed.origin,'https://api.cognitive.microsofttranslator.com');
  assert.equal(parsed.searchParams.get('category'),'general');
  assert.equal(parsed.searchParams.get('to'),'zh-Hans');
  assert.equal(parsed.searchParams.get('from'),'en');
  assert.equal(options.redirect,'manual');
  requests.push(JSON.parse(options.body).map(entry=>entry.Text));
  return translatedByMock(url,options);
 });
 const hit=async(entry,generate=true)=>(await translationBatch(call,[entry],{locale:'zh-CN',generate})).data.items[0];
 assert.equal((await hit(summary,false)).reason,'translation_cache_miss');
 assert.equal(requests.length,0);
 assert.equal((await hit(summary)).body,'mock '+body.slice(0,260));
 assert.equal((await hit(full)).body,'mock '+body.trim());
 assert.deepEqual(requests,[[title,body.slice(0,260)],[body.trim()]]);
 delete env.TRANSLATOR_KEY;
 assert.equal((await hit(full,false)).title,'mock '+title);
 assert.equal((await call('/api/health')).data.translationConfigured,false);
 assert.equal((await call('/api/health')).data.translationCacheAvailable,true);
 const rows=DB.db.prepare('SELECT * FROM topic_translations ORDER BY scope').all();
 assert.equal(rows.length,2);
 for(const row of rows)assert.deepEqual(
  [row.topic_id,row.source_version,row.source_language,row.locale,row.provider,row.product_id,row.engine_type,row.model_id,row.model_version],
  [id,1,'en','zh-CN','azure','azure_ai_translator_text','nmt',null,null]);
 assert(rows.every(row=>row.created_at>0));
 const ledger=DB.db.prepare('SELECT * FROM translation_usage_daily').get();
 assert.equal(ledger.requests,2);
 assert.equal(ledger.characters,title.length+260+body.trim().length);
 assert.equal(ledger.metered_characters,ledger.characters);
});

test('concurrent readers dedupe across isolates and reserve the global budget atomically',async t=>{
 const {call,env,DB,topic}=await fixture();
 mockTranslator(env,DB,{TRANSLATION_DAILY_LIMIT:'62',TRANSLATION_MONTHLY_LIMIT:'62'});
 const one=await topic('First test','One complete English source text for the test.');
 const other=await topic('Other test','A different source text for the second request.');
 let enter,release,requests=0;
 const entered=new Promise(resolve=>{enter=resolve;}),gate=new Promise(resolve=>{release=resolve;});
 t.mock.method(globalThis,'fetch',async(url,options)=>{requests++;enter();await gate;return translatedByMock(url,options);});
 const run=id=>translationBatch(call,[translationItem(id)],{locale:'fr'});
 const first=run(one);
 try{
  await entered;
  assert.equal((await run(one)).data.items[0].reason,'translation_in_progress');
  assert.equal((await run(other)).data.items[0].reason,'translation_quota_reached');
 }finally{release();}
 assert.equal((await first).data.items[0].translated,true);
 assert.equal((await run(one)).data.items[0].translated,true);
 assert.equal(requests,1);
});

test('free-only attestation, rolling budget and provider failures fail closed with usable cached translations',async t=>{
 const {call,env,DB,topic}=await fixture();
 mockTranslator(env,DB);
 const ids=await Promise.all([topic('First','The first fictional source.'),topic('Second','The second fictional source.'),topic('Third','The third fictional source.')]);
 let requests=0,code=200;
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  requests++;
  if(code!==200)return Response.json({error:{code:code===403?403001:503000}},{status:code});
  return translatedByMock(url,options);
 });
 const run=async id=>(await translationBatch(call,[translationItem(id)],{locale:'fr'})).data.items[0];
 env.TRANSLATOR_ENDPOINT='https://example.invalid/translate';
 assert.equal((await run(ids[0])).reason,'translation_not_configured');
 delete env.TRANSLATOR_ENDPOINT;
 env.TRANSLATOR_F0_VERIFIED_AT=new Date(Date.now()-32*86400000).toISOString();
 assert.equal((await run(ids[0])).reason,'translation_not_configured');
 assert.equal(requests,0);
 mockTranslator(env,DB,{TRANSLATION_MONTHLY_LIMIT:'200000'});
 DB.db.exec("INSERT INTO translation_usage_daily(provider,day_utc,characters,requests) VALUES('azure',date('now','-31 day'),199999,1)");
 assert.equal((await run(ids[0])).reason,'translation_quota_reached');
 DB.db.exec("UPDATE translation_usage_daily SET day_utc=date('now','-32 day')");
 assert.equal((await run(ids[0])).translated,true);
 code=503;
 assert.equal((await run(ids[1])).reason,'translation_unavailable');
 assert.equal((await run(ids[2])).reason,'translation_quota_reached');
 DB.db.exec('UPDATE translation_budget SET cooldown_until=0');
 code=403;
 assert.equal((await run(ids[2])).reason,'translation_provider_paused');
 assert.equal((await run(ids[0])).translated,true);
 assert.equal((await run(ids[2])).reason,'translation_quota_reached');
 assert.equal(requests,3);
});

test('only public text can reach Azure, and progress teasers translate their displayed excerpt',async t=>{
 const {call,env,DB,topic}=await fixture();
 mockTranslator(env,DB);
 const id=await topic('Fictional public post','A public English text for testing.');
 const privatePost=await topic('Private','A message with a promo code needing moderation.');
 const contactPost=await topic('Contact test','Please contact me at fake@example.invalid about my session.');
 const progress='My back felt a little better after the home exercises this week. '.repeat(7).trim();
 const comment=await call('/api/topics/'+id+'/comments','POST',{kind:'progress',body:progress,source_lang:'en'});
 const nested=await call('/api/topics/'+id+'/comments','POST',{body:'This fictional follow-up is visible.',source_lang:'en',parent_comment_id:comment.data.id},'bob');
 const requests=[];
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  requests.push(JSON.parse(options.body));
  assert.equal(Object.keys(options.headers).some(key=>/cookie|authorization/i.test(key)),false);
  return translatedByMock(url,options);
 });
 const progressId=translationItem(comment.data.id,{type:'comment',scope:'preview'});
 const nestedId=translationItem(nested.data.id,{type:'comment'});
 const run=async (...items)=>(await translationBatch(call,items,{locale:'fr'})).data.items;
 const gated=await run(translationItem(privatePost),translationItem(contactPost),{...nestedId,scope:'preview'});
 assert.deepEqual(gated.map(x=>x.reason),['not_found','source_contains_contact_details','not_found']);
 assert.equal(requests.length,0);
 assert.equal((await run(progressId))[0].translated,true);
 assert.equal(requests[0][0].Text,progress.slice(0,180));
 assert.equal((await run(nestedId))[0].translated,true);
 assert.equal((await run({...progressId,scope:'full'}))[0].translated,true);
 assert.equal(requests[2][0].Text,progress);
 await call('/api/admin/content','POST',{type:'topic',id,action:'hide',reason:'Mock privacy test'},'admin');
 assert.deepEqual((await run(progressId,nestedId)).map(x=>x.reason),['not_found','not_found']);
 assert.equal(DB.db.prepare('SELECT count(*) n FROM comment_translations').get().n,0);
 assert.equal(requests.length,3);
});

test('a translated public page is enriched through R2 demand; stale ciphertext stays locked after edit or hide even if purge fails',async t=>{
 const {call,env,DB,topic}=await fixture(),bucket=projectionBucket();
 mockTranslator(env,DB);
 enableProjection(env,bucket);
 Object.assign(env,{PUBLIC_CONTENT_ON_DEMAND:'true',PUBLIC_CONTENT_FALLBACK:'true'});
 const id=await topic('Fictional topic title','The original text is only for testing.');
 const page=topicProjectionKey(id),jobs=[];
 const ctx={waitUntil:promise=>jobs.push(promise)};
 let failPurge=false,azureCalls=0;
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  if(new URL(url).hostname==='api.cloudflare.com')return Response.json({success:!failPurge});
  azureCalls++;return translatedByMock(url,options);
 });
 const drain=async()=>{while(jobs.length)await Promise.all(jobs.splice(0));};
 await call('/api/topics/'+id,'GET',undefined,null,{'x-spine-projection-miss':page},ctx);
 await drain();
 const unfilled=await (await bucket.get(page)).json();
 assert.equal(unfilled.data.topic.translations,undefined);
 const item=translationItem(id,{page});
 const read=async(entry,generate=true)=>(await translationBatch(call,[entry],{locale:'fr',generate,ctx})).data.items[0];
 assert.equal((await read(item)).translated,true);
 await drain();
 const projected=await (await bucket.get(page)).json();
 assert.equal(projected.contentVersion,unfilled.contentVersion);
 const stale=projected.data.topic.translations.fr;
 assert(stale.ciphertext);
 assert.equal(JSON.stringify(projected).includes('mock The original'),false);
 const {unpackTranslation}=await import('../public/translation-ui.js');
 const wire=await read({...item,token:stale.token},false);
 assert.equal(wire.body,undefined);
 assert.equal((await unpackTranslation(wire,stale)).body,'mock The original text is only for testing.');
 assert.equal(azureCalls,1);
 failPurge=true;
 await call('/api/topics/'+id,'PATCH',{title:'Updated fiction',body:'Latest original after editing.'},'alice',{},ctx);
 await drain();
 const rejected=await read({...item,token:stale.token},false);
 assert.equal(rejected.reason,'content_changed');
 assert.equal(rejected.key,undefined);
 assert.equal((await call('/api/topics/'+id)).data.topic.body,'Latest original after editing.');
 await call('/api/admin/content','POST',{type:'topic',id,action:'hide',reason:'Mock privacy test'},'admin',{},ctx);
 await drain();
 assert.equal((await read({...item,token:stale.token},false)).reason,'not_found');
 assert.equal(azureCalls,1);
});

test('the browser controller keeps original text during a cache miss, queues only visible items and ignores old views',async t=>{
 const {translationView}=await import('../public/translation-ui.js');
 const previous={IntersectionObserver:globalThis.IntersectionObserver,innerHeight:globalThis.innerHeight,innerWidth:globalThis.innerWidth};
 let observer;
 globalThis.innerHeight=800;globalThis.innerWidth=1200;
 globalThis.IntersectionObserver=class {
  constructor(callback){this.callback=callback;observer=this;}
  observe(){}
  disconnect(){}
 };
 t.after(()=>Object.assign(globalThis,previous));
 const requests=[],rendered=[];
 let sent,release;
 const inFlight=new Promise(resolve=>{sent=resolve;});
 const delayed=new Promise(resolve=>{release=resolve;});
 const data={translated:true,title:'Titre',body:'Texte',provider:'azure'};
 const view=translationView('fr',{
  configured:true,hasCache:true,
  request:async payload=>{
   requests.push(payload);
   if(payload.generate){sent();await delayed;return {items:[data]};}
   return {items:payload.items.map(item=>item.id==='warm'?data:{translated:false,reason:'translation_cache_miss'})};
  },
  render:(node,state)=>rendered.push([node.dataset.translation,state.original?null:state.result.body])
 });
 const row=id=>({id,body:'Original',source_lang:'en',source_lang_mode:'manual',content_version:1,status:'published'});
 const warm=row('warm'),cold=row('cold'),offscreen=row('offscreen');
 await view.prime([['topic',warm],['topic',cold]]);
 assert.equal(requests[0].generate,false);
 assert.equal(view.item('topic',warm).result.body,'Texte');
 assert.equal(view.item('topic',cold).result,null);
 const node=(source,top)=>({isConnected:true,dataset:{translation:view.item('topic',source).key},parentElement:{
  getBoundingClientRect:()=>({top,bottom:top+100,left:0,right:100})
 }});
 const warmNode=node(warm,20),coldNode=node(cold,140),offscreenNode=node(offscreen,1200);
 view.observe([warmNode,coldNode,offscreenNode]);
 assert.deepEqual(rendered,[[warmNode.dataset.translation,'Texte']]);
 view.toggle(warmNode);
 assert.deepEqual(rendered.at(-1),[warmNode.dataset.translation,null]);
 view.toggle(warmNode);
 assert.deepEqual(rendered.at(-1),[warmNode.dataset.translation,'Texte']);
 observer.callback([
  {target:coldNode.parentElement,isIntersecting:true},
  {target:offscreenNode.parentElement,isIntersecting:false}
 ]);
 await inFlight;
 assert.deepEqual(requests[1].items.map(item=>item.id),['cold']);
 view.close();
 release();
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(view.item('topic',cold).result,null);
});

test('mobile primary navigation shows all four actions across eight languages without sideways scrolling',async()=>{
 const app=readFileSync('public/app.js','utf8');
 const style=readFileSync('public/styles.css','utf8');
 const {languages,dictionaries}=await import('../public/i18n.js');
 assert(app.includes('<nav class="primary-nav">'));
 for(const language of languages){
  for(const action of ['home','search','mySpace','newPost']){
   assert(dictionaries[language]?.[action]?.trim(),`${language}: missing ${action} label`);
  }
 }
 assert.match(style,/\.sidebar \.primary-nav\s*\{[^}]*grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
 assert.match(style,/\.sidebar \.primary-nav \.nav-link\s*\{[^}]*white-space:normal/);
 assert.match(style,/\.sidebar \.primary-nav \.nav-link\s*\{[^}]*overflow-wrap:anywhere/);
 assert.match(style,/\.sidebar \.primary-nav \.nav-compose\s*\{[^}]*width:100%/);
});

test('post dialog keeps the close action visible when the long form scrolls',()=>{
 const html=readFileSync('public/index.html','utf8');
 const style=readFileSync('public/styles.css','utf8');
 const app=readFileSync('public/app.js','utf8');
 assert.match(html,/<dialog id="modal"><div class="dialog-header"><button type="button" class="dialog-close"/);
 assert.match(html,/<\/div><div id="modal-content"><\/div><\/dialog>/);
 assert.match(style,/dialog\[open\]\s*\{\s*display:flex;\s*flex-direction:column/);
 assert.match(style,/dialog \.dialog-close\s*\{[^}]*position:static/);
 assert.match(style,/dialog #modal-content\s*\{[^}]*overflow-y:auto/);
 assert.match(style,/max-height:calc\(100dvh/);
 assert(app.includes("content.scrollTop=0"));
});

test('signed-in public CDN reads attach interaction state without sending credentials to CDN',async()=>{
 const {publicContentReader}=await import('../public/public-content.js');
 const {DB,call,topic}=await fixture();
 const id=await topic('Public member feed','Fictional CDN content');
 const reply=await call('/api/topics/'+id+'/comments','POST',{body:'A public test reply.',source_lang:'en'},'bob');
 const replyId=reply.data.id;
 await call('/api/topics/'+id+'/like','PUT',{},'bob');
 await call('/api/topics/'+id+'/bookmark','PUT',{},'bob');
 await call('/api/topics/'+id+'/follow','PUT',{},'bob');
 await call('/api/comments/'+replyId+'/like','PUT',{},'bob');
 const health={environment:'preview',publicContent:{signedIn:true,baseUrl:'https://spine-data-dev.nbn369.com',fallback:true,onDemand:true}};
 const feed=await buildProjection(DB,'feed','latest',1),detail=await buildProjection(DB,'topic',id,1);
 const requests=[];
 const fetcher=async(url,options)=>{
  requests.push(url);
  assert.equal(options.credentials,'omit');
  assert(!options.headers);
  const payload=url.includes('/feeds/')?feed:detail;
  return Response.json({schemaVersion:1,contentVersion:payload.version,topicId:id,data:payload.data});
 };
 const reader=user=>publicContentReader(health,{id:user},async(path,options)=>{
  requests.push(path);
  const result=await call(path,options?.method||'GET',options?.body?JSON.parse(options.body):undefined,user,options?.headers);
  assert.equal(result.status,200);
  if(options?.method==='POST'){
   assert.equal(result.headers.get('cache-control'),'no-store');
   assert(!JSON.stringify(result.data).includes('Fictional CDN content'));
  }
  return result.data;
 },fetcher);
 const bob=reader('bob');
 const home=await bob.feed(new URLSearchParams('sort=latest'));
 assert.equal(home.projectionKey,'feeds/latest/page-1.json');
 assert.equal(home.topics[0].liked,true);
 assert.equal(home.topics[0].bookmarked,true);
 assert.equal(home.topics[0].followed,true);
 assert.equal(home.topics[0].author_id,undefined);
 const post=await bob.topic(id,new URLSearchParams());
 assert.equal(post.projectionKey,'topics/'+id+'/detail.json');
 assert.equal(post.topic.body,'Fictional CDN content');
 assert.equal(post.comments[0].author_id,'bob');
 assert.equal(post.comments[0].liked,true);
 const alice=await reader('alice').topic(id,new URLSearchParams());
 assert.equal(alice.topic.author_id,'alice');
 assert.equal(alice.topic.bookmarked,false);
 assert.equal(alice.comments[0].liked,false);
 assert.equal(alice.comments[0].author_id,undefined);
 assert(requests.every(url=>url.startsWith(health.publicContent.baseUrl)||url==='/api/public-content/viewer'));
 assert.equal((await call('/api/public-content/viewer','POST',{},null)).status,401);
});

test('signed-in CDN overlay falls back for private replies, stale versions and withdrawn pages',async()=>{
 const {publicContentReader}=await import('../public/public-content.js');
 const {DB,call,topic}=await fixture();
 const id=await topic('Projection private-reply fixture','Current public original.');
 const privateReply=await call('/api/topics/'+id+'/comments','POST',{body:'A promo code awaits review.',source_lang:'en'},'bob');
 assert.equal(privateReply.data.status,'pending_review');
 let snapshot=await buildProjection(DB,'topic',id,1),withdrawn=false;
 const health={environment:'preview',publicContent:{signedIn:true,baseUrl:'https://spine-data-dev.nbn369.com',fallback:true}};
 const reader=user=>publicContentReader(health,{id:user},async(path,opts)=>{
  const response=await call(path,opts?.method||'GET',opts?.body?JSON.parse(opts.body):undefined,user);
  if(response.status!==200)throw Object.assign(Error(response.data.error),{status:response.status});
  return response.data;
 },async()=>Response.json({schemaVersion:1,contentVersion:snapshot.version,topicId:id,data:withdrawn?null:snapshot.data}));
 const params=new URLSearchParams();
 assert.equal((await reader('alice').topic(id,params)).projectionVersion,snapshot.version);
 for(const viewer of ['bob','mod']){
  const data=await reader(viewer).topic(id,params);
  assert.equal(data.projectionVersion,undefined);
  assert.equal(data.comments[0].id,privateReply.data.id);
 }
 DB.db.prepare('UPDATE topics SET body=?,content_version=content_version+1 WHERE id=?').run('Edited public original.',id);
 assert.equal((await reader('alice').topic(id,params)).topic.body,'Edited public original.');
 DB.db.prepare("UPDATE topics SET status='hidden' WHERE id=?").run(id);
 await assert.rejects(reader('bob').topic(id,params),error=>error.status===404);
 withdrawn=true;
 const own=await reader('alice').topic(id,params);
 assert.equal(own.topic.status,'hidden');
 assert.equal(own.projectionVersion,undefined);
});

test('a missing CDN locale cache reuses a valid D1 translation without generating again',async()=>{
 const {translationView}=await import('../public/translation-ui.js');
 const row={id:'older',status:'published',source_lang:'en',source_lang_mode:'manual',
   content_version:1,summary:'English original summary'};
 const requests=[];
 const view=translationView('zh-CN',{direct:true,configured:true,hasCache:true,
  request:async payload=>{
   requests.push(payload);
   return {items:[{translated:true,title:'中文标题',body:'已缓存的中文摘要',provider:'azure'}]};
  },render:()=>{}});
 view.markPage({projectionKey:'feeds/latest/page-1.json',topics:[row]});
 await view.prime([['topic',row,'summary']]);
 await new Promise(resolve=>setImmediate(resolve));
 const state=view.item('topic',row,'summary');
 assert.equal(state.result?.body,'已缓存的中文摘要');
 assert.deepEqual(requests.map(item=>item.generate),[false]);
 view.close();
});

test('a matching direct CDN translation needs no Worker request and can toggle back to original',async()=>{
 const {translationView}=await import('../public/translation-ui.js');
 const row={id:'cached',status:'published',source_lang:'en',source_lang_mode:'manual',content_version:2,
  body:'Original',translations:{fr:{title:'Titre',body:'Texte',sourceVersion:2,provider:'azure'}}};
 let requests=0;
 const view=translationView('fr',{direct:true,configured:true,hasCache:true,request:async()=>{requests++;throw Error('unexpected');}});
 view.markPage({projectionKey:'topics/cached/detail.json',topic:row});
 await view.prime([['topic',row]]);
 assert.equal(view.item('topic',row).result.body,'Texte');
 assert.equal(view.item('topic',row).finished,true);
 assert.equal(requests,0);
 const stale={...row,id:'stale',content_version:3};
 view.markPage({projectionKey:'topics/stale/detail.json',topic:stale});
 assert.equal(view.item('topic',stale).result,null);
 view.close();
});

test('a CDN miss on a D1 cache hit backfills direct text without calling Azure again',async t=>{
 const {call,env,topic}=await fixture(),bucket=projectionBucket();
 const {DB}=env;
 mockTranslator(env,DB);
 enableProjection(env,bucket);
 Object.assign(env,{PUBLIC_CONTENT_ON_DEMAND:'true',PUBLIC_CONTENT_FALLBACK:'true',PUBLIC_TRANSLATION_DIRECT:'true'});
 const id=await topic('CDN fixture','Fictional source for direct translation.');
 const page=topicProjectionKey(id),jobs=[];
 const ctx={waitUntil:promise=>jobs.push(promise)};
 const flush=async()=>{while(jobs.length)await Promise.all(jobs.splice(0));};
 let azureCalls=0;
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  if(new URL(url).hostname==='api.cloudflare.com')return Response.json({success:true});
  azureCalls++;return translatedByMock(url,options);
 });
 await call('/api/topics/'+id,'GET',undefined,null,{'x-spine-projection-miss':page},ctx);
 await flush();
 assert.equal((await (await bucket.get(page)).json()).data.topic.translations,undefined);
 DB.db.prepare("DELETE FROM public_projection_demand WHERE scope='topic' AND target=?").run(id);
 const initial=await translationBatch(call,[translationItem(id)],{locale:'fr'});
 assert.equal(initial.data.items[0].translated,true);
 DB.db.prepare('UPDATE topic_translations SET projection_token=NULL,projection_key=NULL WHERE topic_id=?').run(id);
 const cached=await translationBatch(call,[translationItem(id,{page})],{locale:'fr',generate:false,ctx});
 assert.equal(cached.data.items[0].translated,true);
 await flush();
 const projected=(await (await bucket.get(page)).json()).data.topic.translations.fr;
 assert.deepEqual(projected,{title:cached.data.items[0].title,body:cached.data.items[0].body,provider:'azure',sourceVersion:1});
 assert.equal(azureCalls,1);
 await call('/api/admin/content','POST',{type:'topic',id,action:'hide',reason:'Mock withdrawal'},'admin',{},ctx);
 await flush();
 assert.equal((await (await bucket.get(page)).json()).data,null);
});


test('production and preview both use separate CDN translations with isolated R2 buckets',()=>{
 const config=JSON.parse(readFileSync('wrangler.jsonc','utf8'));
 for(const vars of [config.vars,config.previews.vars]){
  assert.equal(vars.PUBLIC_TRANSLATION_SEPARATE,'true');
  assert.equal(vars.PUBLIC_TRANSLATION_DIRECT,'false');
  assert.equal(vars.PUBLIC_CONTENT_ENABLED,'true');
  assert.equal(vars.PUBLIC_CONTENT_READS,'true');
  assert.equal(vars.PUBLIC_CONTENT_FALLBACK,'true');
  assert.equal(vars.PUBLIC_CONTENT_PAGE_SIZE,'50');
 }
 assert.equal(config.vars.CDN_ZONE_ID,config.previews.vars.CDN_ZONE_ID);
 assert.equal(config.r2_buckets[0].bucket_name,'spine-community-public-prod');
 assert.equal(config.previews.r2_buckets[0].bucket_name,'spine-community-public-dev');
});

test('previously D1-cached English topic becomes a separate Chinese CDN JSON, then revisits never request translate',async t=>{
 const {call,env,DB,topic}=await fixture(),bucket=projectionBucket();
 enableProjection(env,bucket);
 Object.assign(env,{PUBLIC_CONTENT_ON_DEMAND:'true',PUBLIC_CONTENT_FALLBACK:'true',
  PUBLIC_TRANSLATION_SEPARATE:'false',PUBLIC_TRANSLATION_DIRECT:'false'});
 const id=await topic('An earlier English surgery story',
  'I had surgery on my back and described my recovery after several weeks.');
 const page=topicProjectionKey(id),localeKey='i18n/zh-CN/'+page;
 DB.db.prepare("INSERT INTO topic_translations(topic_id,locale,scope,source_version,title_text,body_text,provider) VALUES(?,'zh-CN','full',1,'中文标题','已翻译并缓存的中文正文','azure')").run(id);
 const {projectionConfig,writeProjection,buildProjection}=await import('../.test-build/public-projection.js');
 const old=await buildProjection(DB,'topic',id,1,false);
 await writeProjection(projectionConfig(env),page,'topic',id,old.version,old.data);
 assert.equal((await bucket.head(page)).customMetadata.translationFormat,'encrypted');
 // First visit after a configuration change: an incompatible old CDN format
 // uses a normal D1 fallback and queues one *on-demand* projection rebuild.
 env.PUBLIC_TRANSLATION_SEPARATE='true';
 const {publicContentReader}=await import('../public/public-content.js');
 const tasks=[]; const ctx={waitUntil(promise){tasks.push(promise)}};
 let d1Fallbacks=0,azureCalls=0;
 t.mock.method(globalThis,'fetch',async url=>{
   if(new URL(url).hostname==='api.cloudflare.com')return Response.json({success:true});
   azureCalls++;throw Error('Unexpected Azure translation call');
 });
 const cdnFetch=async url=>{
   const key=new URL(url).pathname.slice(1),obj=await bucket.get(key);
   return obj?Response.json(await obj.json()):new Response('',{status:404});
 };
 const publicConfig={environment:'preview',publicContent:{baseUrl:projectionConfig(env).base,
   onDemand:true,fallback:true,separateTranslations:true,directTranslations:true,pageSize:50}};
 const first=publicContentReader(publicConfig,null,async(path,options)=>{
   d1Fallbacks++;
   return (await call(path,'GET',undefined,null,options?.headers||{},ctx)).data;
 },cdnFetch,'zh-CN');
 await first.topic(id,new URLSearchParams());
 while(tasks.length)await Promise.all(tasks.splice(0));
 assert.equal(d1Fallbacks,1);
 assert.equal(azureCalls,0);
 const original=(await (await bucket.get(page)).json()).data;
 assert.equal(original.translationLayout,'separate-v1');
 assert.deepEqual(original.translationLocales,['zh-CN']);
 assert.equal(original.topic.translations,undefined,'source JSON contains no embedded translation');
 const locale=(await (await bucket.get(localeKey)).json());
 assert.equal(locale.items.length,1);
 assert.equal(locale.items[0].body,'已翻译并缓存的中文正文');
 // Subsequent visits are CDN-only (anonymous): no D1 fallback and no
 // /api/translate because sourceVersion and locale JSON match.
 for(let visit=0;visit<2;visit++){
  const reader=publicContentReader(publicConfig,null,async()=>{
   throw Error('Unnecessary Worker fallback');
  },cdnFetch,'zh-CN');
  const loaded=await reader.topic(id,new URLSearchParams());
  assert.equal(loaded.topic.translations['zh-CN'].body,'已翻译并缓存的中文正文');
  const {translationView}=await import('../public/translation-ui.js');
  let translateCalls=0;
  const view=translationView('zh-CN',{direct:true,configured:true,hasCache:true,
    request:async()=>{translateCalls++;throw Error('Unnecessary /api/translate');},render:()=>{}});
  view.markPage(loaded);
  await view.prime([['topic',loaded.topic]]);
  assert.equal(view.item('topic',loaded.topic).result.body,'已翻译并缓存的中文正文');
  assert.equal(translateCalls,0);
  view.close();
 }
 assert.equal(azureCalls,0);
});

test('preview rollback rejects split-format CDN originals and uses the live Worker fallback',async()=>{
 const {publicContentReader}=await import('../public/public-content.js');
 const original={topic:{id:'demo',status:'published',body:'English body',content_version:1},
   comments:[],progress:[],translationLayout:'separate-v1',translationLocales:['zh-CN']};
 const requests=[];
 const reader=publicContentReader({environment:'preview',publicContent:{
   baseUrl:'https://spine-data-dev.nbn369.com',fallback:true,onDemand:true,
   separateTranslations:false,pageSize:50}},null,
   async (path,options)=>{
     requests.push({path,options});
     return {topic:{id:'demo',status:'published',body:'English body',content_version:1},
       comments:[],progress:[]};
   },
   async()=>Response.json({schemaVersion:1,contentVersion:1,topicId:'demo',data:original}),
   'zh-CN');
 const data=await reader.topic('demo',new URLSearchParams());
 assert.equal(data.topic.body,'English body');
 assert.equal(requests.length,1);
 assert.equal(requests[0].options.headers['x-spine-projection-miss'],'topics/demo/detail.json');
});

test('rolling back split CDN format tombstones previously published locale files',async()=>{
 const {env}=await fixture(),bucket=projectionBucket();
 enableProjection(env,bucket);
 const {projectionConfig,writeProjection,localeObjectKey}=await import('../.test-build/public-projection.js');
 const key='topics/fictional/detail.json',localeKey=localeObjectKey(key,'zh-CN');
 env.PUBLIC_TRANSLATION_SEPARATE='true';
 const original={topic:{id:'fictional',status:'published',body:'English original',
   content_version:1,translations:{'zh-CN':{title:'中文标题',body:'中文译文',
   sourceVersion:1,provider:'azure'}}},comments:[],progress:[]};
 await writeProjection(projectionConfig(env),key,'topic','fictional',1,original);
 assert.equal((await (await bucket.get(localeKey)).json()).items.length,1);
 env.PUBLIC_TRANSLATION_SEPARATE='false';
 const current={topic:{id:'fictional',status:'published',body:'English original',
   content_version:1},comments:[],progress:[]};
 const purgeKeys=await writeProjection(projectionConfig(env),key,'topic','fictional',1,current);
 assert.deepEqual(purgeKeys,[localeKey]);
 const retired=await (await bucket.get(localeKey)).json();
 assert.equal(retired.invalidated,true);
 assert.deepEqual(retired.items,[]);
 assert.equal((await bucket.head(key)).customMetadata.translationFormat,'encrypted');
});

test('20-reply CDN paths use size-20 while legacy 50-reply paths remain parseable',async()=>{
 const {objectKey,parseObjectKey,localeObjectKey}=await import('../.test-build/public-projection.js');
 const key='topics/example/comments/size-20/page-2.json';
 assert.equal(objectKey('topic','example',2,20),key);
 assert.deepEqual(parseObjectKey(key),{scope:'topic',target:'example',index:2,pageSize:20});
 assert.equal(localeObjectKey(key,'zh-CN'),'i18n/zh-CN/'+key);
 const old='topics/example/comments/page-2.json';
 assert.equal(objectKey('topic','example',2,50),old);
 assert.deepEqual(parseObjectKey(old),{scope:'topic',target:'example',index:2,pageSize:50});
 assert.equal(parseObjectKey('topics/example/comments/v2/page-2.json'),null);
 assert.equal(parseObjectKey('topics/example/comments/size-30/page-2.json'),null);
 assert.equal(objectKey('topic','example',1,20),'topics/example/detail.json');
});

test('separate locale CDN pages keep 19 cached translations when replies grow 19 -> 21 and one comment is edited',async()=>{
 const {DB,env,call,topic}=await fixture(),bucket=projectionBucket();
 enableProjection(env,bucket);
 Object.assign(env,{PUBLIC_TRANSLATION_SEPARATE:'true',PUBLIC_CONTENT_PAGE_SIZE:'20'});
 const {buildProjection,projectionConfig,writeProjection,localeObjectKey}=await import('../.test-build/public-projection.js');
 const id=await topic('Original English topic','Long English original for the split CDN test.');
 const insert=DB.db.prepare("INSERT INTO comments(id,topic_id,author_id,body,status,source_lang) VALUES(?,?,'bob',?,'published','en')");
 const translated=DB.db.prepare("INSERT INTO comment_translations(comment_id,locale,source_version,body_text,provider) VALUES(?,'zh-CN',? ,?,'azure')");
 for(let i=1;i<=19;i++){insert.run('split-reply-'+i,id,'Fictional original '+i);translated.run('split-reply-'+i,1,'已有中文译文 '+i);}
 const config=projectionConfig(env),originalKey=topicProjectionKey(id),localeKey=localeObjectKey(originalKey,'zh-CN');
 async function publish(index=1){
  const projected=await buildProjection(DB,'topic',id,index,true,20);
  const key=index===1?originalKey:`topics/${id}/comments/size-20/page-${index}.json`;
  const paths=await writeProjection(config,key,'topic',id,projected.version,projected.data);
  return {projected,paths,key};
 }
 const first=await publish();
 assert.deepEqual(first.paths,[localeKey]);
 // A retry following a failed CDN purge must still include unchanged locale keys.
 assert.deepEqual((await publish()).paths,[localeKey]);
 const original=(await (await bucket.get(originalKey)).json()).data;
 assert.equal(original.topic.body,'Long English original for the split CDN test.');
 assert.equal(original.comments.length,19);
 assert(!JSON.stringify(original).includes('已有中文译文'));
 assert.deepEqual(original.translationLocales,['zh-CN']);
 let localized=await (await bucket.get(localeKey)).json();
 assert.equal(localized.items.length,19);
 const {publicContentReader}=await import('../public/public-content.js');
 const fetcher=async url=>{
  const key=new URL(url).pathname.slice(1),entry=await bucket.get(key);
  return entry?Response.json(await entry.json()):new Response('',{status:404});
 };
 const reader=publicContentReader({environment:'preview',publicContent:{baseUrl:config.base,
  separateTranslations:true,pageSize:20}},null,async()=>{throw Error('unnecessary_worker_request')},fetcher,'zh-CN');
 const read=await reader.topic(id,new URLSearchParams());
 assert.equal(read.comments[0].translations['zh-CN'].body,'已有中文译文 1');
 const {translationView}=await import('../public/translation-ui.js');
 let translateRequests=0;
 const view=translationView('zh-CN',{direct:true,configured:true,hasCache:true,
  request:async()=>{translateRequests++;throw Error('unnecessary_worker_translate')},
  render:()=>{}});
 view.markPage(read);
 await view.prime([['comment',read.comments[0]]]);
 assert.equal(view.item('comment',read.comments[0]).result.body,'已有中文译文 1');
 assert.equal(translateRequests,0);
 view.close();
 insert.run('split-reply-20',id,'Fictional original 20');
 insert.run('split-reply-21',id,'Fictional original 21');
 const full=await publish();
 assert.equal(full.projected.data.comments.length,20);
 assert.equal(full.projected.data.more,undefined);
 localized=await (await bucket.get(localeKey)).json();
 assert.equal(localized.items.length,19);
 assert.equal(localized.items.find(x=>x.id==='split-reply-20'),undefined);
 const second=await publish(2);
 assert.equal(second.projected.data.comments.length,1);
 assert.equal(second.projected.data.comments[0].id,'split-reply-21');
 const result=await call('/api/comments/split-reply-8','PATCH',{body:'Edited original eight',source_lang:'en'},'bob');
 assert.equal(result.status,200);
 await publish();
 localized=await (await bucket.get(localeKey)).json();
 assert.equal(localized.items.length,18);
 assert(!localized.items.some(x=>x.id==='split-reply-8'));
 assert(localized.items.some(x=>x.id==='split-reply-19'));
 translated.run('split-reply-8',2,'已修改的中文译文 8');
 await publish();
 localized=await (await bucket.get(localeKey)).json();
 assert.equal(localized.items.find(x=>x.id==='split-reply-8').body,'已修改的中文译文 8');
 assert.equal(localized.items.length,19);
});

test('topic and feed reply controls check login before opening a composer',()=>{
 const app=readFileSync('public/app.js','utf8');
 assert(app.includes("function actions(c,type='topic'){"));
 assert(app.includes("${type==='topic'?(c.status==='published'?\`<button"));
 assert(app.includes('data-action="reply" ${attrs}'));
 assert(app.includes("${translationShell('topic',c)}${actions(c)}"));
 assert(app.includes("${translationShell('topic',c,'summary')}"));
 assert(app.includes('if(action===\'reply\')return type===\'topic\'?replyModal(null,\'regular\',false,id):replyModal(findContent(\'comment\',id));'));
 assert(app.includes('function replyModal(c=null,kind=\'regular\',editing=false,topicId=null){if(!needUser())return;'));
 assert(app.includes('function needUser(){if(state.user)return true;showLogin();return false;}'));
 assert(app.includes('data-topic-id="${esc(topicId||c?.topic_id||\'\')}"'));
 assert(app.includes('const topicId=form.dataset.topicId||state.topic?.id||'));
 assert(app.includes("for(const card of document.querySelectorAll('[data-topic]'))"));
 assert(app.includes("for(const count of card.querySelectorAll('[data-reply-count]'))"));
});

test('closing a login dialog does not show a focus ring around the entire feed',()=>{
 const html=readFileSync('public/index.html','utf8');
 const css=readFileSync('public/styles.css','utf8');
 assert.match(html,/<main id="main" tabindex="-1">/);
 assert.match(css,/#main:focus\{outline:none\}/);
 assert.match(css,/button:focus-visible,a:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible\{outline:3px/);
});


test('SEO: published topic has crawler-readable HTML without requiring JavaScript',async()=>{
 const {env,topic}=await fixture();env.APP_ENV='production';
 env.ASSETS={fetch:async()=>new Response(readFileSync('public/index.html','utf8'))};
 const id=await topic('A real <test> experience','Lower-back pain when sitting.\n\nText <script>alert(1)</script> & more.');
 const url='https://spine.nbn369.com/topic/'+id;
 const response=await worker.fetch(new Request(url),env);
 assert.equal(response.status,200);
 assert.equal(response.headers.get('x-robots-tag'),null);
 const html=await response.text();
 assert.match(html,/<link rel="canonical" href="https:\/\/spine\.nbn369\.com\/topic\//);
 assert.match(html,/<title>A real &lt;test&gt; experience \| Spine Community<\/title>/);
 assert.match(html,/<h1>A real &lt;test&gt; experience<\/h1>/);
 assert.match(html,/Lower-back pain when sitting/);
 assert.match(html,/&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; more/);
 assert.doesNotMatch(html,/<script>alert\(1\)<\/script>/);
 assert.match(html,/<meta property="og:url" content="https:\/\/spine\.nbn369\.com\/topic\//);
 const head=await worker.fetch(new Request(url,{method:'HEAD'}),env);
 assert.equal(head.status,200);
 assert.equal(await head.text(),'');
 const home=await worker.fetch(new Request('https://spine.nbn369.com/'),env);
 assert.equal(home.status,200);
 assert.match(await home.text(),/<link rel="canonical" href="https:\/\/spine\.nbn369\.com\/">/);
 assert.match((await worker.fetch(new Request('https://spine.nbn369.com/search'),env)).headers.get('x-robots-tag'),/noindex/);
});

test('SEO: sitemap lists only published topics; hidden and unknown topics return 404',async()=>{
 const {env,DB,topic}=await fixture();env.APP_ENV='production';
 env.ASSETS={fetch:async()=>new Response(readFileSync('public/index.html','utf8'))};
 const id=await topic('Lumbar recovery personal story','Experience shared to test indexing');
 const hidden=await topic('buy now guaranteed cure https://a.test','This is moderated content');
 const sitemap=await (await worker.fetch(new Request('https://spine.nbn369.com/sitemap.xml'),env)).text();
 assert.match(sitemap,/<urlset /);
 assert(sitemap.includes('https://spine.nbn369.com/topic/'+id));
 assert(!sitemap.includes(hidden));
 const robots=await (await worker.fetch(new Request('https://spine.nbn369.com/robots.txt'),env)).text();
 assert.match(robots,/Sitemap: https:\/\/spine\.nbn369\.com\/sitemap.xml/);
 assert.doesNotMatch(robots,/Disallow: \/api\//);
 const blocked=await worker.fetch(new Request('https://spine.nbn369.com/topic/'+hidden),env);
 assert.equal(blocked.status,404);
 assert.match(blocked.headers.get('x-robots-tag'),/noindex/);
 assert.doesNotMatch(await blocked.text(),/guaranteed cure/);
 DB.db.prepare("UPDATE topics SET status='hidden' WHERE id=?").run(id);
 assert.equal((await worker.fetch(new Request('https://spine.nbn369.com/topic/'+id),env)).status,404);
 assert(!(await (await worker.fetch(new Request('https://spine.nbn369.com/sitemap.xml'),env)).text()).includes(id));
 assert.equal((await worker.fetch(new Request('https://spine.nbn369.com/topic/'+crypto.randomUUID()),env)).status,404);
});

test('SEO: preview pages are noindex and sitemap is unavailable',async()=>{
 const {env,topic}=await fixture();env.APP_ENV='preview';
 env.ASSETS={fetch:async()=>new Response(readFileSync('public/index.html','utf8'))};
 const id=await topic('Preview content','Draft test data for preview');
 const origin='https://feature-v1-community-build-20261106-spine-community.119shenhao.workers.dev';
 const post=await worker.fetch(new Request(origin+'/topic/'+id),env);
 assert.equal(post.status,200);
 assert.match(post.headers.get('x-robots-tag'),/noindex/);
 assert.match(await (await worker.fetch(new Request(origin+'/robots.txt'),env)).text(),/Disallow: \//);
 const sitemap=await worker.fetch(new Request(origin+'/sitemap.xml'),env);
 assert.equal(sitemap.status,404);
 assert.match(sitemap.headers.get('x-robots-tag'),/noindex/);
});

test('SEO: all 505 public posts appear in bounded 500-url sitemap pages',async()=>{
 const {env,DB}=await fixture();env.APP_ENV='production';
 const insert=DB.db.prepare("INSERT INTO topics(id,author_id,title,body,status) VALUES(?,'alice',?,'Patient experience','published')");
 for(let i=0;i<505;i++)insert.run('seo-topic-'+i,'Patient topic '+i);
 const base='https://spine.nbn369.com';
 const idx=await (await worker.fetch(new Request(base+'/sitemap.xml'),env)).text();
 assert.match(idx,/<sitemapindex /);
 assert.match(idx,/\/sitemaps\/topics-1.xml/);
 assert.match(idx,/\/sitemaps\/topics-2.xml/);
 const one=await (await worker.fetch(new Request(base+'/sitemaps/topics-1.xml'),env)).text();
 const two=await (await worker.fetch(new Request(base+'/sitemaps/topics-2.xml'),env)).text();
 assert.equal((one.match(/<url>/g)||[]).length,501); // 500 topics + canonical home
 assert.equal((two.match(/<url>/g)||[]).length,5);
 assert.match(one,/<loc>https:\/\/spine\.nbn369\.com\/<\/loc>/);
 const allUrls=one+'\n'+two;
 for(let i=0;i<505;i++)assert(allUrls.includes(base+'/topic/seo-topic-'+i),'Missing public post '+i);
 assert.equal((await worker.fetch(new Request(base+'/sitemaps/topics-3.xml'),env)).status,404);
});

test('SEO: History API, canonical links and redirects replace hash-only navigation',()=>{
 const app=readFileSync('public/app.js','utf8'),html=readFileSync('public/index.html','utf8');
 const cfg=JSON.parse(readFileSync('wrangler.jsonc','utf8'));
 assert.match(app,/history\.pushState/);
 assert.doesNotMatch(app,/restoreLegacyRoute/);
 assert.doesNotMatch(app,/location\.hash\.startsWith\('#\/'\)/);
 // SPA navigation must never hijack the full-page Google OAuth redirect.
 assert.match(app,/!anchor\.getAttribute\('href'\)\.startsWith\('\/api\/'\)/);
 assert.match(app,/href="\/api\/auth\/google"/);
 assert.match(app,/addEventListener\('popstate'/);
 assert.match(app,/href="\/topic\//);
 assert.doesNotMatch(app,/href="#\/topic\//);
 assert.doesNotMatch(app,/addEventListener\('hashchange'/);
 assert.match(html,/class="brand" href="\//);
 assert(cfg.assets.run_worker_first.includes('/topic/*'));
});


test('SEO: deleted post retains reply placeholder but is noindexed; drafts never leak text',async()=>{
 const {env,DB,topic,call}=await fixture();env.APP_ENV='production';
 env.ASSETS={fetch:async()=>new Response(readFileSync('public/index.html','utf8'))};
 const id=await topic('A post that will be deleted','Sensitive fictional material that must vanish after deletion');
 assert.equal((await call('/api/topics/'+id,'DELETE',{},'alice')).status,200);
 const removed=await worker.fetch(new Request('https://spine.nbn369.com/topic/'+id),env);
 assert.equal(removed.status,200);
 assert.match(removed.headers.get('x-robots-tag'),/noindex/);
 const html=await removed.text();
 assert.match(html,/Post removed/);
 assert.match(html,/type="module"/);
 assert.doesNotMatch(html,/Sensitive fictional material/);
 assert.doesNotMatch(html,/rel="canonical"/);
 assert(!(await (await worker.fetch(new Request('https://spine.nbn369.com/sitemap.xml'),env)).text()).includes(id));
 const draft=await topic('A private review example','SECRET PATIENT DETAIL');
 DB.db.prepare("UPDATE topics SET status='pending_review' WHERE id=?").run(draft);
 const response=await worker.fetch(new Request('https://spine.nbn369.com/topic/'+draft),env);
 assert.equal(response.status,404);
 assert.match(response.headers.get('x-robots-tag'),/noindex/);
 const shell=await response.text();
 assert.match(shell,/type="module"/);
 assert.doesNotMatch(shell,/SECRET PATIENT DETAIL/);
});

test('SEO: forum structured data is limited to actual users, not imported system posts',async()=>{
 const {env,DB,topic}=await fixture();env.APP_ENV='production';
 env.ASSETS={fetch:async()=>new Response(readFileSync('public/index.html','utf8'))};
 const id=await topic('An original experience','Detailed original text from a forum member');
 const page=await (await worker.fetch(new Request('https://spine.nbn369.com/topic/'+id),env)).text();
 const match=page.match(/<script type="application\/ld\+json">([^<]+)<\/script>/);
 assert(match);
 const data=JSON.parse(match[1]);
 assert.equal(data['@type'],'DiscussionForumPosting');
 assert.equal(data.author.name,'alice');
 assert.equal(data.headline,'An original experience');
 assert.equal(data.text,'Detailed original text from a forum member');
 assert.match(data.datePublished,/^\d{4}-\d{2}-\d{2}T/);
 DB.db.prepare("INSERT INTO users(id,nickname,is_system) VALUES('seo-system','Anonymous',1)").run();
 DB.db.prepare("INSERT INTO topics(id,author_id,title,body,status) VALUES('seo-import','seo-system','Imported question','Transcribed external content','published')").run();
 const imported=await (await worker.fetch(new Request('https://spine.nbn369.com/topic/seo-import'),env)).text();
 assert.match(imported,/<h1>Imported question<\/h1>/);
 assert.doesNotMatch(imported,/DiscussionForumPosting/);
});

test('SEO: generated HTML retains security headers and home causes no D1 work',async()=>{
 const env={APP_ENV:'production',DB:{prepare(){throw Error('home must not query D1');}},
  ASSETS:{fetch:async()=>new Response(readFileSync('public/index.html','utf8'))}};
 const page=await worker.fetch(new Request('https://spine.nbn369.com/'),env);
 assert.equal(page.status,200);
 assert.match(page.headers.get('content-security-policy'),/script-src 'self'/);
 assert.equal(page.headers.get('x-frame-options'),'DENY');
 assert.match(page.headers.get('cache-control'),/no-store/);
});


test('SEO: Chinese English and Japanese originals stay authoritative in preview SSR even when reader language differs',async()=>{
 const {env,DB,topic}=await fixture();
 env.APP_ENV='preview';
 env.ASSETS={fetch:async()=>new Response(readFileSync('public/index.html','utf8'))};
 const cases=[
  ['zh-CN','我的腰椎康复记录','久坐后腰部酸痛，经过锻炼后逐渐好转。'],
  ['en','My lower back recovery journal','Sitting for a long time made my lower back hurt. Walking helped me recover.'],
  ['ja','腰痛からの回復体験','長時間座った後に腰が痛くなりました。運動で少しずつ回復しました。']
 ];
 const origin='https://feature-v1-community-build-20261106-spine-community.119shenhao.workers.dev';
 for(const [lang,title,body] of cases){
  const id=await topic(title,body,'alice',{source_lang:lang});
  const canonical='https://spine.nbn369.com/topic/'+id;
  const response=await worker.fetch(new Request(origin+'/topic/'+id+'?lang=fr'),env);
  assert.equal(response.status,200);
  assert.match(response.headers.get('x-robots-tag'),/noindex/);
  const html=await response.text();
  assert(html.includes('<html lang="'+lang+'">'));
  assert(html.includes('<title>'+title+' | Spine Community</title>'));
  assert(html.includes('<meta name="description" content="'+body+'">'));
  assert(html.includes('<meta property="og:title" content="'+title+' | Spine Community">'));
  assert(html.includes('<meta property="og:description" content="'+body+'">'));
  assert(html.includes('<h1>'+title+'</h1>'));
  assert(html.includes('<p>'+body+'</p>'));
  assert.equal(html.split('<link rel="canonical"').length-1,1);
  assert(html.includes('<link rel="canonical" href="'+canonical+'">'));
  assert(!html.includes('hreflang='));
  assert(!html.includes(canonical+'?lang='));
  const match=html.match(/<script type="application\/ld\+json">([^<]+)<\/script>/);
  assert(match,'DiscussionForumPosting present for a first-party user');
  const structured=JSON.parse(match[1]);
  assert.equal(structured.headline,title);
  assert.equal(structured.text,body);
  assert.equal(structured.url,canonical);
  const plain=await (await worker.fetch(new Request(origin+'/topic/'+id),env)).text();
  assert.equal(plain,html,'reader language query cannot change initial SEO');
 }
 const uncertain=await topic('Language label pending review','Text must not be identified as English without evidence');
 DB.db.prepare('UPDATE topics SET source_lang=? WHERE id=?').run('invalid-language-tag',uncertain);
 const uncertainHtml=await (await worker.fetch(new Request(origin+'/topic/'+uncertain),env)).text();
 assert(uncertainHtml.includes('<html lang="und">'),'invalid historical language should not be falsely marked English');
 assert.equal(DB.db.prepare('SELECT source_lang FROM topics WHERE id=?').get(uncertain).source_lang,'invalid-language-tag',
  'SEO must not silently change historical content language data');
});

test('SEO: on-demand production sitemap is canonical and reflects published, synced and hidden rows in isolated fixture',async()=>{
 const {env,DB,topic}=await fixture();
 env.APP_ENV='production'; // Only a local in-memory test database, never production D1.
 const url='https://spine.nbn369.com/sitemap.xml';
 const read=async()=>await (await worker.fetch(new Request(url),env)).text();
 const before=await read();
 assert.match(before,/<loc>https:\/\/spine\.nbn369\.com\/<\/loc>/);
 const newlyPublished=await topic('New public member experience','Recovery notes from a newly published member');
 const synced='seo-synced-original';
 DB.db.prepare("INSERT INTO topics(id,author_id,title,body,source_lang,status) VALUES(?,'alice',?,?,?,'published')")
  .run(synced,'A synced original Spanish story','Mi recuperación después del dolor lumbar.','es');
 const fresh=await read();
 for(const id of [newlyPublished,synced]){
  const loc='<loc>https://spine.nbn369.com/topic/'+id+'</loc>';
  assert.equal(fresh.split(loc).length-1,1,'one canonical link for '+id);
 }
 assert(!fresh.includes('?lang='));
 assert(!fresh.includes('<xhtml:link'));
 DB.db.prepare("UPDATE topics SET status='hidden' WHERE id=?").run(newlyPublished);
 const after=await read();
 assert(!after.includes('/topic/'+newlyPublished));
 assert.equal(after.split('<loc>https://spine.nbn369.com/topic/'+synced+'</loc>').length-1,1);
 DB.db.prepare("UPDATE topics SET status='pending_review' WHERE id=?").run(synced);
 assert(!(await read()).includes('/topic/'+synced));
});


test('preview historical backfill assigns verified languages or provisional default, never overwrites manual',async()=>{
 const {DB,env,call}=await fixture();
 env.APP_ENV='preview';
 const words='I have had lower back pain for a long time and I am now seeing a physiotherapist after work.';
 const chinese='我最近一直腰痛，每天久坐会觉得更加难受，后来开始慢慢调整姿势，也尝试康复训练。';
 for(const [id,title,body,lang,mode] of [
  ['history-en','A long English back pain account',words,'fr','legacy'],
  ['history-short','OK','OK','und','legacy'],
  ['history-preserved','OK','OK','es','legacy'],
  ['history-manual','Manual','Manual','zh-CN','manual']
 ]){
  DB.db.prepare('INSERT INTO topics(id,author_id,title,body,status,source_lang,source_lang_mode) VALUES(?,?,?,?,\'published\',?,?)')
   .run(id,'bob',title,body,lang,mode);
 }
 DB.db.prepare('INSERT INTO comments(id,topic_id,author_id,body,status,source_lang,source_lang_mode) VALUES(?,?,?,?,\'published\',?,?)')
  .run('history-comment','history-en','bob',chinese,'en','legacy');
 DB.db.prepare("INSERT INTO topic_translations(topic_id,locale,source_version,title_text,body_text,provider) VALUES('history-en','zh-CN',1,'旧标题','旧翻译','test')").run();
 const check=await call('/api/admin/historical-language-backfill?type=topic','GET',undefined,'admin');
 assert.equal(check.status,200,JSON.stringify(check.data));
 const lookup=Object.fromEntries(check.data.items.map(x=>[x.id,x]));
 assert.equal(lookup['history-en'].language,'en');
 assert.equal(lookup['history-en'].verified,true);
 assert.equal(lookup['history-short'].language,'en');
 assert.equal(lookup['history-short'].verified,false);
 assert.equal(lookup['history-short'].mode,'legacy');
 assert.equal(lookup['history-preserved'].language,'es');
 assert.equal(lookup['history-preserved'].needsReview,true);
 assert.equal(lookup['history-manual'],undefined);
 assert.equal((await call('/api/admin/historical-language-backfill?type=topic','GET',undefined,'mod')).status,403);
 assert.equal((await call('/api/admin/historical-language-backfill','POST',{type:'topic',preview_confirm:'wrong'},'admin')).status,400);
 const applied=await call('/api/admin/historical-language-backfill','POST',{type:'topic',preview_confirm:'spine-community-db-preview'},'admin');
 assert.equal(applied.status,200,JSON.stringify(applied.data));
 assert.equal(applied.data.detected,1);
 assert.equal(applied.data.defaulted,1);
 assert.equal(applied.data.alreadyProvisional,1);
 const verified=DB.db.prepare("SELECT source_lang,source_lang_mode,content_version FROM topics WHERE id='history-en'").get();
 assert.equal(verified.source_lang,'en');
 assert.equal(verified.source_lang_mode,'auto');
 assert.equal(verified.content_version,2);
 assert.equal(DB.db.prepare("SELECT language,method,content_version FROM content_language_verifications WHERE content_type='topic' AND content_id='history-en'").get().method,'tinyld-heavy');
 assert.equal(DB.db.prepare("SELECT count(*) n FROM topic_translations WHERE topic_id='history-en'").get().n,0);
 const fallback=DB.db.prepare("SELECT source_lang,source_lang_mode,content_version FROM topics WHERE id='history-short'").get();
 assert.deepEqual(fallback,{source_lang:'en',source_lang_mode:'legacy',content_version:2});
 assert.equal(DB.db.prepare("SELECT count(*) n FROM content_language_verifications WHERE content_type='topic' AND content_id='history-short'").get().n,0);
 assert.equal(DB.db.prepare("SELECT source_lang FROM topics WHERE id='history-manual'").get().source_lang,'zh-CN');
 assert.equal(DB.db.prepare("SELECT content_version FROM topics WHERE id='history-preserved'").get().content_version,1);
 const again=await call('/api/admin/historical-language-backfill','POST',{type:'topic',preview_confirm:'spine-community-db-preview'},'admin');
 assert.equal(again.status,200);
 assert.equal(again.data.updated,0,'repeated backfill is idempotent');
 const comment=await call('/api/admin/historical-language-backfill','POST',{type:'comment',preview_confirm:'spine-community-db-preview'},'admin');
 assert.equal(comment.status,200,JSON.stringify(comment.data));
 assert.equal(DB.db.prepare("SELECT source_lang,source_lang_mode,content_version FROM comments WHERE id='history-comment'").get().source_lang,'zh-CN');
 assert.equal(DB.db.prepare("SELECT method FROM content_language_verifications WHERE content_type='comment' AND content_id='history-comment'").get().method,'tinyld-heavy');
 env.APP_ENV='production';
 assert.equal((await call('/api/admin/historical-language-backfill?type=topic','GET',undefined,'admin')).status,403);
 assert.equal((await call('/api/admin/historical-language-backfill','POST',{type:'topic',preview_confirm:'spine-community-db-preview'},'admin')).status,403);
});
