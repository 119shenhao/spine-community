import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,writeFileSync,mkdirSync,readdirSync} from 'node:fs';
import ts from 'typescript';
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
 const env={DB,ASSETS:{fetch:async()=>new Response('static')},ANALYTICS_SALT:'test-only-salt'};
 const call=async(path,method='GET',data,user='alice',extra={})=>{const headers={origin:'https://preview.test','user-agent':'Test Browser',...extra};if(user)headers.cookie='sc_session='+user+'-token';if(data!==undefined)headers['content-type']='application/json';const req=new Request('https://preview.test'+path,{method,headers,body:data===undefined?undefined:JSON.stringify(data)});const r=await worker.fetch(req,env);return {status:r.status,data:await r.json(),headers:r.headers};};
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
test('translation reservation hard limit and race with deletion',async()=>{const {call,topic,env,DB}=await fixture();const id=await topic('A title','A longer body for translating');Object.assign(env,{TRANSLATION_ENABLED:'true',TRANSLATOR_KEY:'test',TRANSLATION_DAILY_LIMIT:'60',TRANSLATION_MONTHLY_LIMIT:'60'});DB.db.exec("UPDATE settings SET value='true' WHERE key='translation_enabled'");const original=globalThis.fetch;let requests=0;globalThis.fetch=async()=>{requests++;await call('/api/topics/'+id,'DELETE',{},'alice');return Response.json([{translations:[{text:'标题'}]},{translations:[{text:'正文'}]}]);};try{const r=await call('/api/translate','POST',{type:'topic',id,locale:'zh-CN'});assert.equal(r.data.translated,false);assert.equal(DB.db.prepare('SELECT count(*) n FROM topic_translations').get().n,0);const id2=await topic('Another title','Enough text to hit monthly limit');const result=await call('/api/translate','POST',{type:'topic',id:id2,locale:'zh-CN'});assert.equal(result.data.reason,'translation_quota_reached');assert.equal(requests,1);}finally{globalThis.fetch=original;}});
test('pageview metrics exclude ordinary API requests; privacy export and requests',async()=>{const {call,topic,DB}=await fixture();await topic();await call('/api/topics');assert.equal(DB.db.prepare('SELECT count(*) n FROM daily_traffic_metrics').get().n,0);await call('/api/pageview','POST',{path:'/'});assert.equal(DB.db.prepare('SELECT pv FROM daily_traffic_metrics').get().pv,1);assert.equal(DB.db.prepare('SELECT uv_estimate FROM daily_traffic_metrics').get().uv_estimate,1);assert.equal((await call('/api/me/export')).data.profile.id,'alice');assert.equal((await call('/api/privacy-requests','POST',{type:'account_delete'})).status,201);assert.equal((await call('/api/privacy-requests')).data.items.length,1);});
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
 for(let i=0;i<2;i++)assert.deepEqual((await imp('/api/import/account',undefined,{method:'GET'})).data.account,{id:'system-unknown-import',nickname:'未知用户',canLogin:false});
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
 assert.equal(detail.data.topic.nickname,'未知用户');assert.equal(detail.data.topic.reply_count,2);
 assert.equal(detail.data.comments[1].parent_comment_id,detail.data.comments[0].id);
 assert(detail.data.comments.every(c=>c.author_id==='system-unknown-import'&&c.nickname==='未知用户'&&c.kind==='regular'&&c.progress_seq===null));
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
 assert.deepEqual(cfg.assets.run_worker_first,['/api/*','/','/index.html']);
 assert.equal(cfg.vars.APP_ENV,'production');
 assert.equal(cfg.previews.vars.APP_ENV,'preview');
 assert(client.includes('badge.hidden=!isPreview()'));
 assert(client.includes("t(isPreview()?'privacyText':'privacyProduction')"));
 env.ASSETS={fetch:async()=>new Response('<html>example</html>',{headers:{'content-type':'text/html','X-Robots-Tag':'noindex, nofollow'}})};
 env.APP_ENV='production';
 assert.equal((await call('/api/health')).data.environment,'production');
 for(const p of ['/','/index.html']){
  const r=await worker.fetch(new Request('https://spine.nbn369.com'+p),env);
  assert.equal(r.headers.get('X-Robots-Tag'),null);
 }
 env.APP_ENV='preview';
 assert.equal((await call('/api/health')).data.environment,'preview');
 for(const p of ['/','/index.html']){
  const r=await worker.fetch(new Request('https://preview.test'+p),env);
  assert.equal(r.headers.get('X-Robots-Tag'),'noindex, nofollow');
 }
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
 const nav=app.match(/\$\('#sidebar'\)\.innerHTML=`<nav>(.*?)<\/nav>/)?.[1];
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
 assert.equal(translatorTargetLocale('zh-CN'),'zh-CN');
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
 assert(code.includes("languageOptions(c?.source_lang||postingLanguage(state.user,locale,languages))"));
 assert(code.includes("languageOptions(editing?c.source_lang:postingLanguage(state.user,locale,languages))"));
 assert(code.includes("v.source_lang||postingLanguage(state.user,locale,languages)"));
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
 assert(source.includes('languageOptions(c?.source_lang||postingLanguage(state.user,locale,languages))'));
 assert(source.includes('languageOptions(editing?c.source_lang:postingLanguage(state.user,locale,languages))'));
 assert(source.includes('profilePostingLanguageOptions(u,locale,languages,t,languageOptions)'));
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
