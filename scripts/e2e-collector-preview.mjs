// Real Cloudflare preview end-to-end test using a verified PUBLIC Reddit thread ID.
// Only original, clearly synthetic E2E text is stored; the third-party thread body
// and real comments are NOT reproduced. No production endpoints or DB credentials.
const BASE='https://feature-v1-community-build-20261106-spine-community.119shenhao.workers.dev';
const RUN=(process.env.GITHUB_RUN_ID||'manual')+'-'+(process.env.GITHUB_RUN_ATTEMPT||'1');
const SOURCES=[
 {id:'1vfpqgs',url:'https://www.reddit.com/r/backpain/comments/1vfpqgs/'},
 {id:'1uxewaa',url:'https://www.reddit.com/r/backpain/comments/1uxewaa/'},
 {id:'1t6re1p',url:'https://www.reddit.com/r/backpain/comments/1t6re1p/'},
 {id:'1q0kwem',url:'https://www.reddit.com/r/backpain/comments/1q0kwem/'}
];
function assert(x,message){if(!x)throw Error(message);}
async function api(path,method='GET',body){
 const r=await fetch(BASE+path,{method,headers:{...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});
 const text=await r.text();let data;try{data=JSON.parse(text);}catch{throw Error('Bad JSON '+path+' HTTP '+r.status+': '+text.slice(0,180));}
 return {http:r.status,data};
}
async function exclusions(site){
 const ids=[],entries=[];let cursor=null,pages=0;
 do{
  const path='/api/collect/exclusions?site='+encodeURIComponent(site)+'&limit=200'+(cursor?'&cursor='+encodeURIComponent(cursor):'');
  const r=await api(path);
  assert(r.http===200,'Exclusions request failed: '+JSON.stringify(r));
  assert(r.data.site===site&&Array.isArray(r.data.items),'Invalid exclusion page');
  entries.push(...r.data.items);ids.push(...r.data.items.map(x=>x.source_id));
  cursor=r.data.next_cursor;
  assert(++pages<100,'Exclusions pagination runaway');
 }while(cursor);
 return {ids:new Set(ids),entries,pages};
}
async function run(){
 const health=await api('/api/health');assert(health.http===200&&health.data.databaseReady&&health.data.importEnabled,'Unhealthy preview D1');
 console.log('Step 1: confirmed isolated preview health; no API key.');
 const before=await exclusions('reddit');
 const source=SOURCES.find(p=>!before.ids.has(p.id));
 assert(source,'All verified Reddit source IDs already excluded. No content was created.');
 console.log('Step 2: read '+before.pages+' Reddit exclusions page(s), excluding '+before.entries.length+' existing IDs.');
 console.log('Real externally verified public source URL: '+source.url);
 // Candidate lookup is metadata-only before claim, NOT wholesale copying of posts.
 try{
  const r=await fetch(source.url,{method:'HEAD',signal:AbortSignal.timeout(12000),headers:{'user-agent':'SpineCommunity-Testing/1.0'}});
  console.log('External source HEAD status: '+r.status+' (may be blocked for GitHub runners, source separately web-verified)');
 }catch(e){console.log('External source HEAD not reachable from GitHub runner: '+String(e).slice(0,150));}
 const claimRequest=collector_id=>api('/api/collect/claim','POST',{site:'reddit',collector_id,source_ids:[source.id]});
 const [a,b]=await Promise.all([claimRequest('deepseek_e2e'),claimRequest('claude_e2e')]);
 assert(a.http===200&&b.http===200,'Claim request failed: '+JSON.stringify([a,b]));
 const answers=[a.data.results[0],b.data.results[0]];
 assert(answers.filter(x=>x.result==='granted').length===1 && answers.filter(x=>x.result==='in_progress').length===1,'Two AIs were not correctly serialized: '+JSON.stringify(answers));
 const grant=answers.find(x=>x.result==='granted');
 assert(a.data.lease_seconds===21600&&b.data.lease_seconds===21600,'Claim lease must be 6 hours');
 assert(grant.lease_token.length>=32,'Missing lease token');
 console.log('Step 3: concurrent claim succeeded for exactly one AI; competing AI receives in_progress; lease 21600 seconds.');
 const during=await exclusions('reddit');
 assert(during.entries.some(x=>x.source_id===source.id&&x.status==='claimed'),'Claimed source absent from exclusions');
 console.log('Step 4: active claim immediately enters exclusion list.');
 const topic={
  title:'[E2E TEST '+RUN+'] Public back-pain thread collection pipeline',
  body:'Automated temporary integration test tied to a verified public Reddit thread ID. This is ORIGINAL SYNTHETIC TEST CONTENT, not a patient story, and no third-party post or comment was copied. Source ID: '+source.id+'.',
  source_lang:'en',
  comments:[
   {body:'[E2E TEST] English top-level synthetic reply.',source_lang:'en',replies:[
    {body:'【端到端测试】这是一条原创的中文楼中楼测试回复，并非患者原话。',source_lang:'zh-CN'}
   ]},
   {body:'[E2E TEST] Second English synthetic top-level reply.',source_lang:'en'}
  ]
 };
 const payload={site:'reddit',source_id:source.id,lease_token:grant.lease_token,topic};
 const completed=await api('/api/collect/complete','POST',payload);
 assert(completed.http===201 && completed.data.status==='completed' && completed.data.duplicate===false && completed.data.imported?.topics===1 && completed.data.imported?.comments===3,'Collection completion failed: '+JSON.stringify(completed));
 const topicId=completed.data.topic_id;
 console.log('Step 5: remotely inserted exactly 1 synthetic test topic + 3 nested replies; id='+topicId);
 const detail=await api('/api/topics/'+topicId);
 assert(detail.http===200 && detail.data.topic.id===topicId && detail.data.topic.source_lang==='en' && detail.data.topic.title===topic.title && detail.data.topic.body===topic.body,'Topic not queryable or source-language mismatch');
 assert(detail.data.comments.length===3,'Expected exactly 3 comments: '+detail.data.comments.length);
 const parent=detail.data.comments.find(c=>c.body===topic.comments[0].body);
 const child=detail.data.comments.find(c=>c.body===topic.comments[0].replies[0].body);
 assert(parent&&child && child.parent_comment_id===parent.id && child.source_lang==='zh-CN' && parent.source_lang==='en','Nested parent relation or languages corrupted');
 console.log('Step 6: website GET returns identical text, original languages and correct nested parent ID.');
 const after=await exclusions('reddit');
 assert(after.entries.some(x=>x.source_id===source.id&&x.status==='completed'),'Completed ID did not immediately appear in exclusions');
 const repeatedClaim=await claimRequest('third_ai');
 assert(repeatedClaim.http===200&&repeatedClaim.data.results[0].result==='completed','Second AI could claim completed source');
 console.log('Step 7: completed source enters exclusions immediately; second AI cannot recollect.');
 const replay=await api('/api/collect/complete','POST',payload);
 assert(replay.http===200 && replay.data.already_completed===true && replay.data.topic_id===topicId && replay.data.imported?.topics===0 && replay.data.imported?.comments===0,'Completion replay not idempotent');
 const altered=await api('/api/collect/complete','POST',{...payload,topic:{...topic,body:topic.body+' altered'}});
 assert(altered.http===409&&altered.data.error==='completion_payload_mismatch','Changed replay payload was not refused');
 console.log('Step 8: identical replay is idempotent; conflicting replay rejected.');
 const simulatedSource='ci-'+RUN;
 const extra=await api('/api/collect/claim','POST',{site:'e2e',source_ids:[simulatedSource],collector_id:'another_ai'});
 assert(extra.http===200 && extra.data.results[0].result==='granted','Cannot claim alternative synthetic source');
 const duplicate=await api('/api/collect/complete','POST',{site:'e2e',source_id:simulatedSource,lease_token:extra.data.results[0].lease_token,topic:{...topic,comments:[{body:'[E2E TEST] this extra reply must NOT be imported',source_lang:'en'}]}});
 assert(duplicate.http===200 && duplicate.data.duplicate===true && duplicate.data.topic_id===topicId && duplicate.data.imported?.comments===0,'Cross-source content fingerprint did not deduplicate');
 const afterDetail=await api('/api/topics/'+topicId);
 assert(afterDetail.data.comments.length===3,'Cross-source duplicate appended unwanted replies');
 const e2eList=await exclusions('e2e');
 assert(e2eList.entries.some(x=>x.source_id===simulatedSource&&x.status==='completed'),'Cross-source ID missing in its exclusions');
 console.log('Step 9: different source ID + same body is deduplicated without adding comments.');
 console.log('E2E_RESULT '+JSON.stringify({status:'PASS',real_source_url:source.url,real_source_id:source.id,topic_id:topicId,test_title:topic.title,alternate_source:simulatedSource,first_claim_lease_seconds:21600,comments_verified:3,duplicate_content_prevented:true,clean_up_required:true}));
}
run().catch(e=>{console.error('E2E_FAIL '+(e?.stack||e));process.exitCode=1;});
