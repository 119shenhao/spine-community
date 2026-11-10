// Read-only production D1 cross-check; execution is confined to GitHub Actions.
// The original patient text is only held in runner memory, passed via stdin to
// a local fastText model, and never written to disk, logs or outside services.
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import ts from 'typescript';

const ACCOUNT='289976272520a38732bef34108585e11';
const DB_ID='5919ff78-b8fc-46ab-85f0-01fe5e6a41b0';
const DB_NAME='spine-community-db';
const API='https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT+'/d1/database/'+DB_ID;
const token=process.env.CLOUDFLARE_PROD_D1_API_TOKEN;
if(!token)throw Error('Missing production D1 audit credential');
const model=process.env.FASTTEXT_LID_MODEL;
if(!model)throw Error('Missing pinned local fastText model');
if(process.env.GITHUB_ACTIONS!=='true')throw Error('Only runs inside the bounded GitHub Actions audit workflow');

async function remote(path,method,sql){
  if(sql!==undefined&&!/^SELECT\b/i.test(sql))throw Error('Only SELECT statements are allowed');
  const res=await fetch(API+path,{
    method,
    headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    body:sql===undefined?undefined:JSON.stringify({sql}),
    redirect:'error',
    signal:AbortSignal.timeout(30000)
  });
  if(!res.ok)throw Error('D1 read request failed with HTTP '+res.status);
  const payload=await res.json();
  if(payload.success!==true)throw Error('D1 reported unsuccessful read');
  return payload.result;
}
async function select(statement){
  const result=await remote('/query','POST',statement);
  if(!Array.isArray(result)||result.length!==1||result[0].success!==true||!Array.isArray(result[0].results))
    throw Error('Unexpected D1 response structure');
  return result[0].results;
}
const info=await remote('','GET');
assert.equal(info.uuid,DB_ID,'Refusing wrong production D1 database ID');
assert.equal(info.name,DB_NAME,'Refusing wrong production D1 database name');

// The production original-language detector is kept byte-for-byte identical
// to the app version checked out in this exact workflow run.
mkdirSync('.audit-build',{recursive:true});
for(const file of ['core','source-language']){
  const source=readFileSync('src/'+file+'.ts','utf8');
  const js=ts.transpileModule(source,{compilerOptions:{
    target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext
  }}).outputText.replace(/from '(\.\/[^']+)'/g,"from '$1.js'");
  writeFileSync('.audit-build/'+file+'.js',js);
}
const {detectSourceLanguageEvidence}=await import('../.audit-build/source-language.js');
const baseLang=value=>{
  const v=String(value||'und').toLowerCase();
  return /^zh(?:-|$)/.test(v)?'zh':v.split('-')[0];
};
const agrees=(a,b)=>a!=='und'&&b!=='und'&&baseLang(a)===baseLang(b);
const eligible=[],allLegacyModes={};
let publishedLegacy=0,currentProof=0,provisionalKnown=0,provisionalUnknown=0;
for(let offset=0;offset<10000;offset+=20){
  const sql="SELECT t.id,t.title,t.body,t.source_lang,t.source_lang_mode,t.content_version,"+
    "v.language proof_language,v.method proof_method FROM topics t "+
    "LEFT JOIN content_language_verifications v ON v.content_type='topic' "+
    "AND v.content_id=t.id AND v.content_version=t.content_version "+
    "WHERE t.status='published' AND t.source_lang_mode='legacy' "+
    "ORDER BY t.id LIMIT 20 OFFSET "+offset;
  const rows=await select(sql);
  assert(rows.length<=20);
  for(const row of rows){
    publishedLegacy++;
    if(row.proof_language!==null&&row.proof_language!==undefined)currentProof++;
    const stored=row.source_lang||'und';
    if(stored==='und')provisionalUnknown++;else provisionalKnown++;
    const heavy=detectSourceLanguageEvidence(String(row.title||''),String(row.body||'')).language;
    if(stored==='und'||heavy==='und'||!agrees(stored,heavy)){
      eligible.push({id:row.id,original:String(row.title||'')+'\n'+String(row.body||''),
        stored,heavy,proof:row.proof_language});
    }
  }
  if(rows.length<20)break;
}
assert(publishedLegacy<10000,'Exceeded bounded audit window');

const child=spawnSync('python', ['scripts/fasttext-language-audit.py','--model',model],{
  input:JSON.stringify(eligible.map(x=>x.original)),
  encoding:'utf8',maxBuffer:4*1024*1024,timeout:120000
});
if(child.status!==0)throw Error('Local fastText process failed; no D1 modifications');
let fast;
try{fast=JSON.parse(child.stdout);}catch{throw Error('Malformed local fastText response')}
assert(Array.isArray(fast)&&fast.length===eligible.length);
const counts={
  legacy_known_need_check:0,legacy_known_fast_supports_existing:0,
  legacy_known_fast_disagrees:0,legacy_known_fast_uncertain:0,
  und_need_check:0,und_tiny_fast_consensus:0,
  und_fast_only_candidate:0,und_tiny_fast_conflict:0,und_still_uncertain:0,
  former_tiny_disagreement:0,proof_present_in_review:0
};
const perLang={stored:{},fasttext:{},tinyld:{}};
const inc=(obj,k)=>{obj[k]=(obj[k]||0)+1};
for(let i=0;i<eligible.length;i++){
  const x=eligible[i],y=fast[i],ft=y.language;
  const reliable=typeof y.letters==='number'&&y.letters>=40&&
    typeof y.score==='number'&&y.score>=0.85&&
    typeof y.margin==='number'&&y.margin>=0.25&&ft!=='und';
  inc(perLang.stored,x.stored);
  inc(perLang.fasttext,reliable?ft:'uncertain');
  inc(perLang.tinyld,x.heavy);
  if(x.proof!==null&&x.proof!==undefined)counts.proof_present_in_review++;
  if(x.stored==='und'){
    counts.und_need_check++;
    if(reliable&&agrees(ft,x.heavy))counts.und_tiny_fast_consensus++;
    else if(reliable&&x.heavy==='und')counts.und_fast_only_candidate++;
    else if(reliable&&x.heavy!=='und')counts.und_tiny_fast_conflict++;
    else counts.und_still_uncertain++;
  }else{
    counts.legacy_known_need_check++;
    if(x.heavy!=='und'&&!agrees(x.stored,x.heavy))counts.former_tiny_disagreement++;
    if(reliable&&agrees(ft,x.stored))counts.legacy_known_fast_supports_existing++;
    else if(reliable)counts.legacy_known_fast_disagrees++;
    else counts.legacy_known_fast_uncertain++;
  }
}
assert.equal(counts.und_need_check,counts.und_tiny_fast_consensus+counts.und_fast_only_candidate+counts.und_tiny_fast_conflict+counts.und_still_uncertain);
assert.equal(counts.legacy_known_need_check,counts.legacy_known_fast_supports_existing+counts.legacy_known_fast_disagrees+counts.legacy_known_fast_uncertain);
console.log('PRODUCTION_FASTTEXT_CROSSCHECK_READ_ONLY '+JSON.stringify({
  version:1,database:DB_NAME,mode:'SELECT_only',model:'fastText-lid.176.ftz',
  tinyld:'tinyld-heavy',minimum_fasttext_letters:40,minimum_score:0.85,minimum_margin:0.25,
  published_legacy:publishedLegacy,legacy_with_current_proof:currentProof,
  provisional_known:provisionalKnown,provisional_unknown:provisionalUnknown,
  selected_for_crosscheck:eligible.length,counts,language_groups:perLang,
  warning:'These are candidates, not automatic corrections. zh script subtype requires manual review. No original text, IDs, or private data output; no DB writes.'
}));
