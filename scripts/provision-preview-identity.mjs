import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';

// Remove the one-time verifier receipt after activation was confirmed.
const branch='feature/v1-community-build-20261106';
const target='spine-community';
const database='4362537a-5748-4a05-b0c4-219c3db36996';
const binding='IDENTITY_CLIENT_SECRET';
const receiptKey='identity_center_dev_client_secret_digest';
if(process.env.WORKERS_CI!=='1'||process.env.WORKERS_CI_BRANCH!==branch)throw Error('Identity bootstrap requires the named Cloudflare Preview build.');
const config=JSON.parse(readFileSync('wrangler.jsonc','utf8'));
const migration=JSON.parse(readFileSync('wrangler.preview-migrations.jsonc','utf8'));
if(config.name!==target||config.previews?.vars?.IDENTITY_CLIENT_ID!=='spine-community-dev'||config.previews?.vars?.APP_ENV!=='preview'||
   config.previews?.d1_databases?.find(item=>item.binding==='DB')?.database_id!==database||
   migration.d1_databases?.length!==1||migration.d1_databases[0].binding!=='PREVIEW_DB'||migration.d1_databases[0].database_id!==database){
 throw Error('Identity bootstrap refused a mismatched Worker or D1.');
}
function wrangler(args){
 const result=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js',...args],{
   encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:120000
 });
 if(result.status!==0)throw Error('Identity bootstrap Wrangler command failed: '+args.slice(0,3).join(' '));
 return result.stdout;
}
const targetArgs=['--worker-name',target,'--name',branch];
const hasBinding=()=>JSON.parse(wrangler(['preview','secret','list',...targetArgs,'--json'])).some(item=>item.name===binding&&item.type==='secret_text');
if(!hasBinding())throw Error('Expected the authentication secret on the named Preview before receipt cleanup.');
const args=['d1','execute','PREVIEW_DB','--remote','--config','wrangler.preview-migrations.jsonc','--json','--command'];
wrangler([...args,`DELETE FROM settings WHERE key='${receiptKey}'`]);
const verified=JSON.parse(wrangler([...args,`SELECT count(*) AS n FROM settings WHERE key='${receiptKey}'`]));
if(verified[0]?.results?.[0]?.n!==0)throw Error('Development credential receipt is still present.');
console.log('Temporary verifier receipt removed from the forum Preview D1.');
