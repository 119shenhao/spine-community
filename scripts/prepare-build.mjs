import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const PREVIEW='4362537a-5748-4a05-b0c4-219c3db36996';
const expectedBranch='feature/v1-community-build-20261106';
function run(args,capture=false){const r=spawnSync(process.execPath,args,{encoding:'utf8',stdio:capture?'pipe':'inherit',env:process.env});if(r.status!==0)throw new Error('Preview preparation failed. Inspect Cloudflare build logs; no production migration was attempted.');return r.stdout;}
// Unit/integration checks are local, with fictional in-memory data only.
run(['node_modules/typescript/bin/tsc','--noEmit']);
run(['--test','tests/community.test.mjs']);
if(process.env.WORKERS_CI==='1'&&process.env.WORKERS_CI_BRANCH===expectedBranch){
 const cfg=JSON.parse(readFileSync('wrangler.preview-migrations.jsonc','utf8'));
 const main=JSON.parse(readFileSync('wrangler.jsonc','utf8'));
 if(cfg.d1_databases.length!==1||cfg.d1_databases[0].database_id!==PREVIEW||cfg.d1_databases[0].binding!=='PREVIEW_DB'||cfg.d1_databases[0].migrations_dir!=='migrations/v1'||main.previews.d1_databases[0].database_id!==PREVIEW)throw Error('Preview database isolation check failed');
 const imports=main.previews.d1_databases.filter(b=>b.binding==='IMPORT_DB');
 if(imports.length!==1||imports[0].database_id!==PREVIEW||main.d1_databases.some(b=>b.binding==='IMPORT_DB')||main.vars?.IMPORT_ENABLED==='true')throw Error('Import binding must exist only in the isolated preview environment');
 const cli=['node_modules/wrangler/bin/wrangler.js','d1'];
 const common=['PREVIEW_DB','--remote','--config','wrangler.preview-migrations.jsonc'];
 const raw=run([...cli,'execute',...common,'--command',"SELECT name FROM sqlite_master WHERE type='table' AND name IN ('users','topics','settings')",'--json'],true);
 const result=JSON.parse(raw),names=result.flatMap(x=>x.results||[]).map(x=>x.name);
 if(names.length&&!names.includes('settings'))throw Error('An older or unknown preview schema exists. Review it before any migration; no data was overwritten.');
 run([...cli,'migrations','apply',...common]);
 run([...cli,'execute',...common,'--command',"SELECT value FROM settings WHERE key='schema_version'; SELECT id,nickname,is_system FROM users WHERE id='system-unknown-import'; PRAGMA foreign_key_check;",'--json']);
 // One-time scoped cleanup of the synthetic E2E record from run 42331899579.
 // This branch/build is bound to PREVIEW_ID above, never production.
 run([...cli,'execute',...common,'--file','scripts/collector-e2e-cleanup-once.sql']);
 const uuid='99e0bb7d-8936-44d6-8d92-e5b5ce59dbd2';
 const verifySql="SELECT (SELECT count(*) FROM topics WHERE id='"+uuid+"') AS topics, (SELECT count(*) FROM comments WHERE topic_id='"+uuid+"') AS comments, (SELECT count(*) FROM topics_search WHERE topic_id='"+uuid+"') AS search_rows, (SELECT count(*) FROM collect_sources WHERE topic_id='"+uuid+"' OR (site='reddit' AND source_id='1vfpqgs') OR (site='e2e' AND source_id='ci-42331899579-1')) AS sources";
 const verify=JSON.parse(run([...cli,'execute',...common,'--command',verifySql,'--json'],true)).flatMap(x=>x.results||[]);
 if(verify.length!==1||Object.values(verify[0]).some(v=>Number(v)!==0))throw Error('E2E preview cleanup incomplete: '+JSON.stringify(verify));
 console.log('E2E_PREVIEW_CLEANUP_SUCCESS '+JSON.stringify(verify[0]));
 console.log('Preview-only migration verified for '+PREVIEW);
}else console.log('Remote migration skipped outside the named Cloudflare preview build.');
