// Explicit one-time historical topic fingerprint backfill, with collision review.
// By default read-only; no content is rewritten or deleted.
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fingerprint} from './sync-preview-to-production.mjs';
const argv=process.argv.slice(2);
const target=(argv.find(a=>a.startsWith('--target='))||'--target=preview').split('=')[1];
const apply=argv.includes('--apply');
if(!['preview','production'].includes(target)||argv.some(a=>a!=='--apply'&&!a.startsWith('--target=')))throw Error('Usage: node scripts/backfill-topic-fingerprints.mjs [--target=preview|production] [--apply]');
const destinations={
 preview:{config:'wrangler.preview-migrations.jsonc',binding:'PREVIEW_DB',id:'4362537a-5748-4a05-b0c4-219c3db36996'},
 production:{config:'wrangler.production-sync.jsonc',binding:'PRODUCTION_DB',id:'5919ff78-b8fc-46ab-85f0-01fe5e6a41b0'}
};
const dest=destinations[target],cfg=JSON.parse(readFileSync(dest.config,'utf8'));
if(cfg.d1_databases?.length!==1||cfg.d1_databases[0].binding!==dest.binding||cfg.d1_databases[0].database_id!==dest.id)throw Error('Unexpected D1 binding; aborting');
if(target==='production'&&apply&&process.env.SPINE_SYNC_PRODUCTION_CONFIRM!==dest.id)throw Error('Production fingerprint backfill requires separate approval, backup, and SPINE_SYNC_PRODUCTION_CONFIRM='+dest.id);
const lit=v=>"'"+String(v).replaceAll("'","''")+"'";
function query(sql){
 const r=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute',dest.binding,'--remote','--config',dest.config,'--command',sql,'--yes','--json'],{encoding:'utf8',maxBuffer:12*1024*1024,env:process.env});
 if(r.status!==0)throw Error('D1 operation failed: '+(r.stderr||r.stdout).slice(0,700));
 const v=JSON.parse(r.stdout);
 if(!Array.isArray(v)||v.some(x=>x.success===false))throw Error('D1 reported failure');
 return v.flatMap(x=>x.results||[]);
}
const cols=query('PRAGMA table_info(topics)');
if(!cols.some(c=>c.name==='content_hash'))throw Error('Migration 0004 is required before backfill');
let cursor='',examined=0,pending=[],duplicates=[],mismatched=[],seen=new Map();
while(true){
 const page=query('SELECT id,title,body,content_hash FROM topics WHERE id>'+lit(cursor)+' AND title IS NOT NULL AND body IS NOT NULL ORDER BY id LIMIT 100');
 if(!page.length)break;
 for(const row of page){
  examined++;
  const computed=fingerprint(row.title,row.body);
  if(row.content_hash&&row.content_hash!==computed)mismatched.push(row.id);
  const previous=seen.get(computed);
  if(previous)duplicates.push({first:previous,second:row.id});
  else seen.set(computed,row.id);
  if(!row.content_hash)pending.push({id:row.id,title:row.title,body:row.body,hash:computed});
 }
 cursor=page.at(-1).id;
}
console.log(JSON.stringify({target,mode:apply?'apply':'dry_run',examined,to_backfill:pending.length,duplicate_groups:duplicates.length,mismatched:mismatched.length,duplicate_examples:duplicates.slice(0,5),mismatch_examples:mismatched.slice(0,5)},null,2));
if(duplicates.length||mismatched.length)throw Error('Conflicting historical hashes require manual review. No rows were modified.');
if(apply){
 for(const t of pending){
  // Compare-and-set prevents marking a row edited since the preflight scan.
  query('UPDATE topics SET content_hash='+lit(t.hash)+' WHERE id='+lit(t.id)+' AND content_hash IS NULL AND title='+lit(t.title)+' AND body='+lit(t.body));
 }
 const left=query('SELECT count(*) n FROM topics WHERE title IS NOT NULL AND body IS NOT NULL AND content_hash IS NULL');
 if(Number(left[0]?.n)>0)throw Error('Some topics changed during backfill; re-run after review');
 console.log('Backfill verified: '+pending.length+' previously NULL fingerprints');
}else console.log('Read-only dry run: no updates performed.');
