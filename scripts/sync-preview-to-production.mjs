// Manual one-way publication of imported posts. No public production write API.
// DRY RUN by default. Never run --apply without explicit production approval and a backup.
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const PREVIEW_ID='4362537a-5748-4a05-b0c4-219c3db36996';
const PRODUCTION_ID='5919ff78-b8fc-46ab-85f0-01fe5e6a41b0';
const PREVIEW={config:'wrangler.preview-migrations.jsonc',binding:'PREVIEW_DB',id:PREVIEW_ID};
const PRODUCTION={config:'wrangler.production-sync.jsonc',binding:'PRODUCTION_DB',id:PRODUCTION_ID};
const argv=process.argv.slice(2),apply=argv.includes('--apply');
const limitArg=argv.find(v=>v.startsWith('--limit='));
const limit=limitArg?Number(limitArg.slice(8)):20;
if(argv.some(a=>a!=='--apply'&&!a.startsWith('--limit='))||!Number.isInteger(limit)||limit<1||limit>100)throw Error('Usage: npm run sync:production -- [--limit=20] [--apply]');
if(apply&&process.env.SPINE_SYNC_PRODUCTION_CONFIRM!==PRODUCTION_ID)throw Error('Production writes require SPINE_SYNC_PRODUCTION_CONFIRM='+PRODUCTION_ID+' AND --apply, after separate approval and backup.');
for(const dest of [PREVIEW,PRODUCTION]){
 const cfg=JSON.parse(readFileSync(dest.config,'utf8'));
 if(cfg.d1_databases?.length!==1||cfg.d1_databases[0].binding!==dest.binding||cfg.d1_databases[0].database_id!==dest.id)throw Error('Unsafe D1 binding: '+dest.config);
}
const sqlValue=v=>v===null||v===undefined?'NULL':typeof v==='number'&&Number.isFinite(v)?String(v):"'"+String(v).replaceAll("'","''")+"'";
const normalize=v=>v.normalize('NFKC').replace(/\s+/gu,' ').trim().toLowerCase();
const validLanguage=v=>typeof v==='string'&&v!=='und'&&/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/.test(v);
const verifiedMethods=new Set(['tinyld-heavy','azure-auto','admin-manual']);
// This is a publication decision, not a best-effort translation guess.
// Only explicit current choices or a verification for the exact current content
// version can become an indexed source-language label.
export function resolveSyncLanguage(row){
 if(row.status==='deleted')return {label:'und',mode:'legacy',method:null,score:null};
 const version=Number(row.content_version);
 const current=Number.isInteger(version)&&version>=1&&
  Number(row.verified_version)===version&&
  verifiedMethods.has(row.verified_method)&&validLanguage(row.verified_language);
 if(current&&row.verified_method==='admin-manual')
  return {label:row.verified_language,mode:'manual',method:'admin-manual',score:row.verified_score};
 if(row.source_lang_mode==='manual'){
  return {label:validLanguage(row.source_lang)?row.source_lang:'und',mode:'manual',method:null,score:null};
 }
 if(current){
  return {label:row.verified_language,mode:'auto',method:row.verified_method,
   score:typeof row.verified_score==='number'&&row.verified_score>=0&&row.verified_score<=1?row.verified_score:null};
 }
 return {label:'und',mode:'legacy',method:null,score:null};
}
const currentLanguageProjection=(alias,type)=>
 "LEFT JOIN content_language_verifications v ON v.content_type='"+type+"'"+
 ' AND v.content_id='+alias+'.id AND v.content_version='+alias+'.content_version';
const currentLanguageSelect='v.content_version verified_version,v.language verified_language,v.method verified_method,v.score verified_score';
export function fingerprint(title,body){
 return createHash('sha256').update('spine-topic-v1\n'+normalize(title)+'\n'+normalize(body)).digest('hex');
}
export function sortComments(comments){
 const byId=new Map(comments.map(c=>[c.id,c])),ordered=[],visiting=new Set(),done=new Set();
 function visit(row){
  if(done.has(row.id))return true;
  if(visiting.has(row.id))throw Error('Cyclic comment tree: '+row.id);
  if(!['published','deleted'].includes(row.status))return false;
  visiting.add(row.id);
  if(row.parent_comment_id){
   const parent=byId.get(row.parent_comment_id);
   if(!parent||!visit(parent)){visiting.delete(row.id);return false;}
  }
  visiting.delete(row.id);done.add(row.id);ordered.push(row);return true;
 }
 for(const row of comments)visit(row);
 return ordered;
}
function query(dest,statement){
 const args=['node_modules/wrangler/bin/wrangler.js','d1','execute',dest.binding,'--remote','--config',dest.config,'--command',statement,'--json','--yes'];
 const r=spawnSync(process.execPath,args,{encoding:'utf8',maxBuffer:12*1024*1024,env:process.env});
 if(r.status!==0)throw Error('D1 query failed ('+dest.binding+'): '+(r.stderr||r.stdout).slice(0,900));
 let payload;
 try{payload=JSON.parse(r.stdout);}catch{throw Error('D1 did not return JSON for '+dest.binding+': '+r.stdout.slice(0,200));}
 if(!Array.isArray(payload)||payload.some(p=>p.success===false))throw Error('D1 query unsuccessful for '+dest.binding);
 return payload.flatMap(p=>p.results||[]);
}
function writeFile(dest,sql){
 if(!apply)throw Error('Refusing a dry-run write');
 const temp=mkdtempSync(join(tmpdir(),'spine-sync-'));
 try{
  const file=join(temp,'one-topic.sql');
  writeFileSync(file,sql,{mode:0o600});
  const args=['node_modules/wrangler/bin/wrangler.js','d1','execute',dest.binding,'--remote','--config',dest.config,'--file',file,'--json','--yes'];
  const r=spawnSync(process.execPath,args,{encoding:'utf8',maxBuffer:12*1024*1024,env:process.env});
  if(r.status!==0)throw Error('D1 file import failed ('+dest.binding+'): '+(r.stderr||r.stdout).slice(0,900));
  // Wrangler's --file mode can exit successfully while emitting progress text
  // rather than pure JSON, even when --json is passed. A zero exit status alone
  // is not enough to mark a thread synced: run() checks the persisted topic and
  // every expected reply in production before writing its preview receipt.
  let payload=null;
  try{payload=JSON.parse(r.stdout);}catch{}
  if(payload!==null&&(
    (Array.isArray(payload)&&payload.some(p=>p.success===false))||
    (!Array.isArray(payload)&&payload?.success===false)
  ))throw Error('D1 import reported a failed statement');
 }finally{rmSync(temp,{recursive:true,force:true});}
}
function assertReady(){
 for(const dest of [PREVIEW,PRODUCTION]){
  const tables=query(dest,"SELECT name FROM sqlite_master WHERE type='table' AND name IN ('topics','comments','users','topic_sync_receipts') ORDER BY name");
  if(tables.length!==4)throw Error(dest.binding+' has no v1+sync schema. Apply its approved migrations first; no data changed.');
  const cols=query(dest,'PRAGMA table_info(topics)');
  for(const field of ['content_hash','source_lang_mode','content_version'])
   if(!cols.some(c=>c.name===field))throw Error('Missing '+field+' on '+dest.binding);
  const replyCols=query(dest,'PRAGMA table_info(comments)');
  for(const field of ['source_lang_mode','content_version'])
   if(!replyCols.some(c=>c.name===field))throw Error('Missing comments.'+field+' on '+dest.binding);
  const languageTable=query(dest,"SELECT name FROM sqlite_master WHERE type='table' AND name='content_language_verifications'");
  if(languageTable.length!==1)throw Error('Missing language verifications on '+dest.binding+'. No writes attempted.');
 }
 const projection=query(PRODUCTION,`SELECT name FROM sqlite_master WHERE
  (type='table' AND name='public_projection') OR
  (type='trigger' AND name IN ('public_projection_topic_insert','public_projection_comment_insert','public_projection_invalidate_write'))`);
 if(projection.length!==4)throw Error('Production projection outbox is unavailable. Apply the approved projection migration before running this sync implementation.');
 const author=query(PRODUCTION,"SELECT id FROM users WHERE id='system-unknown-import' AND is_system=1 AND status='active'");
 if(author.length!==1)throw Error('Production Unknown User account not initialized; no writes attempted');
}
function verifyTopic(topic,hash){
 const prod=query(PRODUCTION,'SELECT id,author_id,title,body,content_hash,source_lang,source_lang_mode FROM topics WHERE content_hash='+sqlValue(hash)+' OR (title='+sqlValue(topic.title)+' AND body='+sqlValue(topic.body)+') OR id='+sqlValue(topic.id)+' LIMIT 3');
 if(prod.length>1)throw Error('Conflicting production matches for '+topic.id+'; manual review required');
 if(prod.length&&prod[0].id===topic.id){
  const chosen=resolveSyncLanguage(topic);
  if(prod[0].title!==topic.title||prod[0].body!==topic.body||
     prod[0].author_id!=='system-unknown-import'||
     prod[0].source_lang!==chosen.label||prod[0].source_lang_mode!==chosen.mode)
   throw Error('Production topic ID/content/language collision for '+topic.id+'; never overwrite existing data');
 }
 return prod[0]||null;
}
export function buildInserts(topic,comments,terms,hash){
 const original=resolveSyncLanguage(topic);
 const lines=[
  '-- Single source thread; stable IDs and OR IGNORE allow safe retry after failure.',
  'INSERT OR IGNORE INTO topics(id,author_id,title,body,source_lang,source_lang_mode,status,symptom_duration_days,content_hash,created_at) VALUES('+
   [topic.id,'system-unknown-import',topic.title,topic.body,original.label,original.mode,'published',topic.symptom_duration_days,hash,topic.created_at].map(sqlValue).join(',')+');'
 ];
 if(original.method)lines.push('INSERT OR IGNORE INTO content_language_verifications(content_type,content_id,content_version,language,method,score) VALUES('+
  ['topic',topic.id,1,original.label,original.method,original.score].map(sqlValue).join(',')+');');
 for(const term of terms)lines.push('INSERT OR IGNORE INTO topic_terms(topic_id,term_id) VALUES('+[topic.id,term.term_id].map(sqlValue).join(',')+');');
 for(const c of comments){
  // Preserve visible original text and parentage; never transfer a login identity.
  if(!['regular','progress'].includes(c.kind))throw Error('Unsupported source comment kind on '+topic.id+': '+c.id);
  if(c.kind==='progress'&&(!Number.isInteger(c.progress_seq)||c.progress_seq<1||c.parent_comment_id!==null))throw Error('Invalid source progress on '+topic.id+': '+c.id);
  if(c.kind==='regular'&&c.progress_seq!=null)throw Error('Invalid source regular comment on '+topic.id+': '+c.id);
  const choice=resolveSyncLanguage(c);
  lines.push('INSERT OR IGNORE INTO comments(id,topic_id,author_id,parent_comment_id,kind,progress_seq,body,source_lang,source_lang_mode,status,created_at) VALUES('+
   [c.id,topic.id,'system-unknown-import',c.parent_comment_id,c.kind,c.progress_seq??null,c.body,choice.label,choice.mode,c.status,c.created_at].map(sqlValue).join(',')+');');
  if(choice.method)lines.push('INSERT OR IGNORE INTO content_language_verifications(content_type,content_id,content_version,language,method,score) VALUES('+
   ['comment',c.id,1,choice.label,choice.method,choice.score].map(sqlValue).join(',')+');');
 }
 return lines.join('\n')+'\n';
}
function verifyComments(id,comments){
 const expected=new Set(comments.map(c=>c.id));
 const rows=query(PRODUCTION,'SELECT id,parent_comment_id,body,status,source_lang,source_lang_mode,author_id,kind,progress_seq FROM comments WHERE topic_id='+sqlValue(id));
 for(const row of rows){
  if(!expected.has(row.id))continue; // an unrelated production reply does not alter the source snapshot
  const src=comments.find(c=>c.id===row.id);
  if(row.parent_comment_id!==src.parent_comment_id||row.body!==src.body||row.status!==src.status||(row.source_lang!==resolveSyncLanguage(src).label||row.source_lang_mode!==resolveSyncLanguage(src).mode)||row.author_id!=='system-unknown-import'||row.kind!==src.kind||row.progress_seq!==(src.progress_seq??null))throw Error('Production comment mismatch: '+row.id);
  expected.delete(row.id);
 }
 if(expected.size)throw Error('Missing '+expected.size+' production replies for '+id+'; preview receipt NOT written');
}
function markPreview(topic,targetId,hash,commentCount){
 if(!apply)return;
 // The source title/body must still equal the snapshot; otherwise retry rather than marking stale content.
 const sql='INSERT INTO topic_sync_receipts(source_topic_id,production_topic_id,content_hash,transferred_comments) '+
 'SELECT id,'+sqlValue(targetId)+','+sqlValue(hash)+','+commentCount+' FROM topics WHERE id='+sqlValue(topic.id)+
 ' AND title='+sqlValue(topic.title)+' AND body='+sqlValue(topic.body)+
 ' AND content_version='+sqlValue(topic.content_version)+
 ' AND source_lang='+sqlValue(topic.source_lang)+
 ' AND source_lang_mode='+sqlValue(topic.source_lang_mode)+" AND status='published' "+
 'ON CONFLICT(source_topic_id) DO NOTHING;';
 query(PREVIEW,sql);
 const rows=query(PREVIEW,'SELECT production_topic_id,content_hash FROM topic_sync_receipts WHERE source_topic_id='+sqlValue(topic.id));
 if(rows.length!==1||rows[0].production_topic_id!==targetId||rows[0].content_hash!==hash)throw Error('Could not confirm preview receipt for '+topic.id);
}
function run(){
 console.log(apply?'APPLY MODE: explicitly enabled; verify production backup and prior approval.':'DRY RUN: no database writes will be issued.');
 assertReady();
 const topics=query(PREVIEW,"SELECT t.id,t.title,t.body,t.source_lang,t.source_lang_mode,t.content_version,t.status,t.symptom_duration_days,t.created_at,t.content_hash,"+currentLanguageSelect+" "+
 "FROM topics t "+currentLanguageProjection('t','topic')+" WHERE t.status='published' "+
 "AND NOT EXISTS (SELECT 1 FROM topic_sync_receipts r WHERE r.source_topic_id=t.id) ORDER BY t.created_at,t.id LIMIT "+limit);
 const counts={examined:0,new:0,existing:0,comments:0,marked:0};
 for(const topic of topics){
  counts.examined++;
  if(typeof topic.title!=='string'||typeof topic.body!=='string')throw Error('Unexpected missing source text');
  const hash=fingerprint(topic.title,topic.body);
  if(topic.content_hash&&topic.content_hash!==hash)throw Error('Source hash mismatch: '+topic.id);
  const existing=verifyTopic(topic,hash);
  if(existing&&existing.id!==topic.id){
   console.log('SKIP already exists: '+topic.id+' -> '+existing.id);
   counts.existing++;markPreview(topic,existing.id,hash,0);if(apply)counts.marked++;continue;
  }
  const raw=query(PREVIEW,'SELECT c.id,c.author_id,c.parent_comment_id,c.kind,c.progress_seq,c.body,c.source_lang,c.source_lang_mode,c.content_version,c.status,c.created_at,'+currentLanguageSelect+
 ' FROM comments c '+currentLanguageProjection('c','comment')+' WHERE c.topic_id='+sqlValue(topic.id)+' ORDER BY c.rowid');
  const comments=sortComments(raw),terms=query(PREVIEW,'SELECT term_id FROM topic_terms WHERE topic_id='+sqlValue(topic.id));
  if(terms.length){
   const allowed=query(PRODUCTION,'SELECT id FROM taxonomy_terms WHERE id IN ('+terms.map(t=>sqlValue(t.term_id)).join(',')+')');
   if(allowed.length!==terms.length)throw Error('Production taxonomy missing for '+topic.id);
  }
  console.log((existing?'RESUME':'NEW')+' '+topic.id+' '+JSON.stringify(topic.title)+' replies='+comments.length);
  // Validate *every* selected source reply in dry-run too, before a production write.
  const sql=buildInserts(topic,comments,terms,hash);
  counts.new++;counts.comments+=comments.length;
  if(!apply)continue;
  writeFile(PRODUCTION,sql);
  const inserted=verifyTopic(topic,hash);
  if(!inserted||inserted.id!==topic.id)throw Error('Production topic was not created: '+topic.id);
  verifyComments(topic.id,comments);
  markPreview(topic,topic.id,hash,comments.length);counts.marked++;
 }
 console.log(JSON.stringify({mode:apply?'apply':'dry_run',...counts},null,2));
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(new URL(import.meta.url).pathname))run();
