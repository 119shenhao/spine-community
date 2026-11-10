// Read-only D1 audit. Aggregated language metadata only; never fetch patient text.
// This tool cannot alter a source-language label, verification, receipt or production row.
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';

const PREVIEW={config:'wrangler.preview-migrations.jsonc',binding:'PREVIEW_DB',id:'4362537a-5748-4a05-b0c4-219c3db36996'};
const PRODUCTION={config:'wrangler.production-sync.jsonc',binding:'PRODUCTION_DB',id:'5919ff78-b8fc-46ab-85f0-01fe5e6a41b0'};
const argv=process.argv.slice(2);
if(argv.includes('--help')){
 console.log('Usage: npm run audit:languages -- --target=preview|production (read-only, aggregated counts)');
 process.exit(0);
}
if(argv.length!==1||!['--target=preview','--target=production'].includes(argv[0]))
 throw Error('Select exactly one audit target: --target=preview or --target=production');
const target=argv[0].slice('--target='.length);
const db=target==='preview'?PREVIEW:PRODUCTION;
const config=JSON.parse(readFileSync(db.config,'utf8'));
if(config.d1_databases?.length!==1||config.d1_databases[0].binding!==db.binding||
   config.d1_databases[0].database_id!==db.id)
 throw Error('Database ID or binding differs from the approved audit target; no query issued');

function select(sql){
 if(!/^\s*(SELECT|PRAGMA)\b/i.test(sql))throw Error('Audit allows read-only SELECT/PRAGMA only');
 const args=['node_modules/wrangler/bin/wrangler.js','d1','execute',db.binding,
  '--remote','--config',db.config,'--command',sql,'--json','--yes'];
 const r=spawnSync(process.execPath,args,{encoding:'utf8',maxBuffer:12*1024*1024,env:process.env});
 if(r.status!==0)throw Error('Read-only D1 query failed: '+(r.stderr||r.stdout).slice(0,800));
 let payload;
 try{payload=JSON.parse(r.stdout);}catch{throw Error('Unexpected D1 response; refusing to infer data');}
 if(!Array.isArray(payload)||payload.some(p=>p.success===false))throw Error('D1 audit query failed');
 return payload.flatMap(p=>p.results||[]);
}
const tables=select("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('topics','comments','content_language_verifications')");
if(tables.length!==3)throw Error('Missing source language schema; refusing to guess counts');
for(const t of ['topics','comments']){
 const names=new Set(select('PRAGMA table_info('+t+')').map(v=>v.name));
 for(const col of ['id','status','source_lang','source_lang_mode','content_version'])
  if(!names.has(col))throw Error('Missing '+t+'.'+col+'; audit not compatible with this schema');
}
const measures={};
for(const [name,type] of [['topics','topic'],['comments','comment']]){
 // No title, body, author_id or content ID is retrieved from the database.
 const data=select(`SELECT COALESCE(t.source_lang,'(null)') source_lang,
   COALESCE(t.source_lang_mode,'(null)') source_lang_mode,
   COUNT(*) total,
   SUM(CASE WHEN t.source_lang IS NULL OR t.source_lang='' OR t.source_lang='und' THEN 1 ELSE 0 END) unknown,
   SUM(CASE WHEN v.content_id IS NOT NULL THEN 1 ELSE 0 END) verified_current,
   SUM(CASE WHEN v.content_id IS NOT NULL AND v.language<>t.source_lang THEN 1 ELSE 0 END) metadata_disagrees_with_proof,
   SUM(CASE WHEN t.source_lang_mode='auto' AND v.content_id IS NULL THEN 1 ELSE 0 END) auto_missing_current_proof,
   SUM(CASE WHEN t.source_lang_mode='legacy' THEN 1 ELSE 0 END) legacy_unconfirmed,
   SUM(CASE WHEN v.content_id IS NULL AND EXISTS (
     SELECT 1 FROM content_language_verifications old
     WHERE old.content_type='${type}' AND old.content_id=t.id AND old.content_version<>t.content_version
   ) THEN 1 ELSE 0 END) stale_only_proof
   FROM ${name} t LEFT JOIN content_language_verifications v
   ON v.content_type='${type}' AND v.content_id=t.id AND v.content_version=t.content_version
   WHERE t.status='published'
   GROUP BY t.source_lang,t.source_lang_mode
   ORDER BY total DESC,source_lang`);
 const totals={published:0,unknown:0,verified_current:0,metadata_disagrees_with_proof:0,
  auto_missing_current_proof:0,legacy_unconfirmed:0,stale_only_proof:0};
 for(const row of data)for(const key of Object.keys(totals))totals[key]+=Number(row[key]==null&&key==='published'?row.total:(key==='published'?row.total:row[key])||0);
 const groups=data.map(row=>({language:row.source_lang,mode:row.source_lang_mode,count:Number(row.total)}));
 measures[name]={totals,groups};
}
console.log(JSON.stringify({target,mode:'read_only',generated_at_utc:new Date().toISOString(),
 environment_database:db.binding,aggregates:measures,
 note:'Counts only; no patient text, authors, identifiers, database writes, or corrections.'},null,2));
