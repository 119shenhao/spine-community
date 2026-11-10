// Read-only, public-GET-only production audit. No D1 credentials are used.
// Medical text is held only in Actions runner memory for local model inference.
// The bounded summary screening is NOT a full D1 proof/version audit.
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import ts from 'typescript';

if(process.env.GITHUB_ACTIONS!=='true')throw Error('Run only in GitHub Actions');
const model=process.env.FASTTEXT_LID_MODEL;
if(!model)throw Error('Missing verified fastText model');
mkdirSync('.audit-build',{recursive:true});
for(const file of ['core','source-language']){
  const js=ts.transpileModule(readFileSync('src/'+file+'.ts','utf8'),{
    compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}
  }).outputText.replace(/from '(\.\/[^']+)'/g,"from '$1.js'");
  writeFileSync('.audit-build/'+file+'.js',js);
}
const {detectSourceLanguageEvidence}=await import('../.audit-build/source-language.js');
const BASE='https://spine.nbn369.com';
async function publicGet(path){
  const resp=await fetch(BASE+path,{method:'GET',redirect:'error',
    signal:AbortSignal.timeout(20000),
    headers:{'cache-control':'no-cache','user-agent':'Spine-Source-Language-ReadOnly-Audit/1.0'}});
  if(resp.status!==200)throw Error('Public read stopped at HTTP '+resp.status+' (no automatic retry)');
  return resp.json();
}
const stem=value=>{
  const str=String(value||'und').toLowerCase();
  return /^zh(?:-|$)/.test(str)?'zh':str.split('-')[0];
};
const match=(a,b)=>a!=='und'&&b!=='und'&&stem(a)===stem(b);
const pass=result=>result.letters>=40&&result.score>=0.85&&
  result.margin>=0.25&&result.language!=='und';
function localFastText(texts){
  const child=spawnSync('python',['scripts/fasttext-language-audit.py','--model',model],{
    input:JSON.stringify(texts),encoding:'utf8',maxBuffer:4*1024*1024,timeout:120000});
  if(child.status!==0)throw Error('Offline fastText stopped without results');
  let result;
  try{result=JSON.parse(child.stdout);}catch{throw Error('Invalid fastText output');}
  assert(Array.isArray(result)&&result.length===texts.length);
  return result;
}
// Stage 1: only public list pages. They contain the 260-char source excerpt.
const list=[];
let offset=0,pages=0;
for(let i=0;i<500;i++){
  const batch=await publicGet('/api/topics?sort=latest&offset='+offset);
  if(!Array.isArray(batch.topics))throw Error('Unexpected published listing');
  pages++;
  for(const row of batch.topics){
    if(row.status!=='published')throw Error('Unexpected non-public content');
    if(row.source_lang_mode==='legacy')list.push({
      id:row.id,title:String(row.title||''),
      excerpt:String(row.summary||''),stored:String(row.source_lang||'und')
    });
  }
  if(batch.next==null)break;
  if(!Number.isInteger(batch.next)||batch.next<=offset||batch.next>10000)
    throw Error('Invalid public list pagination');
  offset=batch.next;
}
if(list.length<1||list.length>1000)throw Error('Unexpected public list size');
const preliminary=localFastText(list.map(row=>row.title+'\n'+row.excerpt));
const candidate=[];
const preliminaryCounts={und:0,heavy_uncertain:0,model_disagreement:0};
for(let i=0;i<list.length;i++){
  const row=list[i],fast=preliminary[i];
  const heavy=detectSourceLanguageEvidence(row.title,row.excerpt).language;
  if(row.stored==='und')preliminaryCounts.und++;
  if(heavy==='und')preliminaryCounts.heavy_uncertain++;
  if(pass(fast)&&!match(row.stored,fast.language))
    preliminaryCounts.model_disagreement++;
  if(row.stored==='und'||heavy==='und'||pass(fast)&&!match(row.stored,fast.language))
    candidate.push(row);
}
const fullScan=process.env.FASTTEXT_FULL_PUBLIC_SCAN==='true';
const selected=fullScan?list:candidate;
if(selected.length>600)throw Error('Too many detailed GETs; use a protected D1 read-only audit');
console.log('PUBLIC_SUMMARY_SCREENING '+JSON.stringify({
  published_legacy:list.length,public_pages:pages,shortlisted: candidate.length,full_scan:fullScan,selected_for_full: selected.length,
  preliminaryCounts,note:'Excerpts only. This is not a complete-text D1 audit; no patient text or IDs logged.'
}));
// Stage 2: at most 250 full, published details. Respect the public site's
// request budget by using serial GETs with a delay and by stopping on 429.
const full=[];
for(const row of selected){
  await new Promise(resolve=>setTimeout(resolve,1500));
  const detail=await publicGet('/api/topics/'+encodeURIComponent(row.id));
  if(!detail.topic||detail.topic.id!==row.id||detail.topic.status!=='published')
    throw Error('Public source changed during audit');
  full.push({
    stored:row.stored,title:String(detail.topic.title||''),
    body:String(detail.topic.body||'')
  });
  if(fullScan&&full.length%100===0)console.log('PUBLIC_FULL_TEXT_GET_PROGRESS '+full.length);
}
const verifiedFast=localFastText(full.map(row=>row.title+'\n'+row.body));
const results={
  full_examined:full.length,already_agreed:0,still_und:0,
  known_fast_supports_existing:0,known_fast_disagrees:0,known_fast_uncertain:0,
  und_consensus_candidate:0,und_fast_only_candidate:0,und_conflict:0,und_unresolved:0,
  language_groups:{stored:{},fasttext:{},heavy:{}}
};
const add=(obj,key)=>obj[key]=(obj[key]||0)+1;
for(let i=0;i<full.length;i++){
  const row=full[i],ft=verifiedFast[i],strong=pass(ft),det=detectSourceLanguageEvidence(row.title,row.body).language;
  add(results.language_groups.stored,row.stored);
  add(results.language_groups.fasttext,strong?ft.language:'uncertain');
  add(results.language_groups.heavy,det);
  if(row.stored==='und'){
    results.still_und++;
    if(strong&&match(ft.language,det))results.und_consensus_candidate++;
    else if(strong&&det==='und')results.und_fast_only_candidate++;
    else if(strong)results.und_conflict++;
    else results.und_unresolved++;
  }else{
    if(det!=='und'&&match(det,row.stored))results.already_agreed++;
    if(strong&&match(ft.language,row.stored))results.known_fast_supports_existing++;
    else if(strong)results.known_fast_disagrees++;
    else results.known_fast_uncertain++;
  }
}
assert.equal(results.still_und,results.und_consensus_candidate+results.und_fast_only_candidate+results.und_conflict+results.und_unresolved);
console.log('PRODUCTION_PUBLIC_FASTTEXT_CROSSCHECK '+JSON.stringify({
  mode:'published_GET_only',model:'pinned_fastText_lid.176.ftz',tinyld:'tinyld-heavy',
  summary_screened:list.length,full_scan:fullScan,full_text_crosschecked:results.full_examined,
  not_full_text_checked:list.length-results.full_examined,results,
  safeguards:'No D1 or preview database access; no mutations; no patient text or post IDs logged; estimates are not approved corrections; Chinese script subtype must be checked separately.'
}));
