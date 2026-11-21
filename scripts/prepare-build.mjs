import {readFileSync,readdirSync,mkdirSync,rmSync,copyFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
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
 const productionBucket=main.r2_buckets?.find(b=>b.binding==='PUBLIC_CONTENT_R2');
 const previewBucket=main.previews.r2_buckets?.find(b=>b.binding==='PUBLIC_CONTENT_R2');
 if(previewBucket?.bucket_name!=='spine-community-public-dev'||productionBucket?.bucket_name!=='spine-community-public-prod'||
  main.previews.vars?.PUBLIC_CONTENT_BASE_URL!=='https://spine-data-dev.nbn369.com'||
  main.vars?.PUBLIC_CONTENT_BASE_URL!=='https://spine-data.nbn369.com')throw Error('Public projection binding isolation check failed');
 const cli=['node_modules/wrangler/bin/wrangler.js','d1'];
 const common=['PREVIEW_DB','--remote','--config','wrangler.preview-migrations.jsonc'];
 const raw=run([...cli,'execute',...common,'--command',"SELECT name FROM sqlite_master WHERE type='table' AND name IN ('users','topics','settings')",'--json'],true);
 const result=JSON.parse(raw),names=result.flatMap(x=>x.results||[]).map(x=>x.name);
 if(names.length&&!names.includes('settings'))throw Error('An older or unknown preview schema exists. Review it before any migration; no data was overwritten.');
 run([...cli,'migrations','apply',...common]);
 run([...cli,'execute',...common,'--command',"SELECT value FROM settings WHERE key='schema_version'; SELECT id,nickname,is_system FROM users WHERE id='system-unknown-import'; PRAGMA foreign_key_check;",'--json']);
 console.log('Preview-only migration verified for '+PREVIEW);
}else console.log('Remote migration skipped outside the named Cloudflare preview build.');

function createVersionedFrontend() {
 // Static JS and CSS are served directly from Cloudflare Assets/CDN (no extra
 // Worker invocations). A unique directory for every content revision avoids
 // browsers mixing an old entry module with newly deployed dependencies.
 const root='public';
 const names=readdirSync(root,{withFileTypes:true})
  .filter(item=>item.isFile()&&/\.(js|css)$/.test(item.name))
  .map(item=>item.name).sort();
 if(!names.includes('app.js')||!names.includes('styles.css'))throw Error('Frontend entry assets missing');
 const h=createHash('sha256');
 for(const name of names){h.update(name);h.update('\0');h.update(readFileSync(join(root,name)));}
 const revision=h.digest('hex').slice(0,16);
 const folder=join(root,'_app');
 rmSync(folder,{recursive:true,force:true});
 mkdirSync(join(folder,revision),{recursive:true});
 for(const name of names)copyFileSync(join(root,name),join(folder,revision,name));
 const htmlFile=join(root,'index.html');
 const html=readFileSync(htmlFile,'utf8');
 const entry=/<link rel="stylesheet" href="\/(?:_app\/[a-f0-9]{16}\/)?styles\.css"><script type="module" src="\/(?:_app\/[a-f0-9]{16}\/)?app\.js"><\/script>/;
 if(!entry.test(html))throw Error('Frontend HTML entry markup changed; refusing a stale deployment');
 const replacement='<link rel="stylesheet" href="/_app/'+revision+'/styles.css">'+
  '<script type="module" src="/_app/'+revision+'/app.js"></script>';
 writeFileSync(htmlFile,html.replace(entry,replacement),'utf8');
 console.log('Frontend asset revision '+revision+' ('+names.length+' versioned CSS/JS files)');
}
createVersionedFrontend();

// The one-time production OAuth client Secret was provisioned and the verifier
// registered on the production Identity Center. Future builds must not generate,
// upload, or rotate credentials. Keep Cloudflare's existing Secrets intact.
