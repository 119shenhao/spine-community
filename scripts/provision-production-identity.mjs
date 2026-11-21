#!/usr/bin/env node
// One-time production build bootstrap: mirror the verified Preview secret flow.
// This code is intentionally limited to the named production Worker and D1.
// Never print, persist in GitHub, or export the plaintext client secret.
import {createHash,randomBytes} from "node:crypto";
import {spawnSync} from "node:child_process";
import {readFileSync} from "node:fs";

const WORKER="spine-community";
const DB_ID="5919ff78-b8fc-46ab-85f0-01fe5e6a41b0";
const DB_NAME="spine-community-db";
const SECRET_NAME="IDENTITY_CLIENT_SECRET";
const RECEIPT="identity_center_prod_client_secret_digest";
const VERIFIED="identity_center_prod_client_secret_verified";

if(process.env.WORKERS_CI!=="1"||process.env.WORKERS_CI_BRANCH!=="main"){
  throw new Error("Production credential setup requires the named Cloudflare main build.");
}
const cfg=JSON.parse(readFileSync("wrangler.jsonc","utf8"));
const dbCfg=JSON.parse(readFileSync("wrangler.production-sync.jsonc","utf8"));
if(cfg.name!==WORKER||cfg.keep_vars!==true||
   cfg.vars?.APP_ENV!=="production"||
   cfg.vars?.IDENTITY_LOGIN_ENABLED!=="false"||
   cfg.vars?.IDENTITY_ISSUER!=="https://idcenter.nbn369.com"||
   cfg.vars?.IDENTITY_CLIENT_ID!=="spine-community-prod"||
   cfg.vars?.IDENTITY_REDIRECT_URI!=="https://spine.nbn369.com/api/auth/identity/callback"||
   cfg.d1_databases?.length!==1||cfg.d1_databases[0].database_id!==DB_ID||
   cfg.d1_databases[0].database_name!==DB_NAME||
   dbCfg.d1_databases?.length!==1||
   dbCfg.d1_databases[0].binding!=="PRODUCTION_DB"||
   dbCfg.d1_databases[0].database_id!==DB_ID||
   dbCfg.d1_databases[0].database_name!==DB_NAME){
  throw new Error("Refusing credential operation: production Worker, client or D1 target mismatch.");
}
function wrangler(args,stdin){
  const result=spawnSync(process.execPath,["node_modules/wrangler/bin/wrangler.js",...args],{
    input:stdin,encoding:"utf8",stdio:["pipe","pipe","pipe"],timeout:120000,env:process.env
  });
  if(result.error||result.status!==0){
    // Never expose CLI output: it may contain secret-related details.
    const output=(result.stderr||"")+"\n"+(result.stdout||"");
    const reason=/\\b403\\b|permission|forbidden|unauthorized/i.test(output)?"permission_denied":
      /unknown argument|unknown option|unrecognized option|invalid option/i.test(output)?"unsupported_cli_option":"remote_operation_failed";
    const operation=args[0]==="secret"?"Worker Secret":args[0]==="d1"?"D1":"Cloudflare";
    throw new Error(operation+" bootstrap failed ("+reason+"). No secret values were logged.");
  }
  return result.stdout;
}
function query(sql){
  const raw=wrangler(["d1","execute","PRODUCTION_DB","--remote","--config",
    "wrangler.production-sync.jsonc","--json","--command",sql]);
  const result=JSON.parse(raw);
  if(!Array.isArray(result)||result.length!==1||result[0].success===false||
     !Array.isArray(result[0].results)){
    throw new Error("Production D1 SQL response is invalid.");
  }
  return result[0].results;
}
function hasSecret(){
  const response=JSON.parse(wrangler(["secret","list","--name",WORKER,"--config","wrangler.jsonc","--format","json"]));
  if(!Array.isArray(response))throw new Error("Cloudflare returned an invalid Worker secret metadata list.");
  return response.some(item=>item.name===SECRET_NAME&&item.type==="secret_text");
}
function receiptValue(key){
  const rows=query("SELECT value FROM settings WHERE key='"+key+"'");
  if(rows.length>1)throw new Error("Duplicate credential receipt.");
  return rows[0]?.value||"";
}
const tables=query("SELECT name FROM d1_migrations WHERE name='0100_identity_center.sql'");
if(tables.length!==1)throw new Error("Production identity migration missing.");
const existingDigest=receiptValue(RECEIPT);
const existingVerified=receiptValue(VERIFIED);
const existingSecret=hasSecret();
if(existingSecret){
  if(!/^[A-Za-z0-9_-]{43}$/.test(existingDigest)||existingVerified!==existingDigest){
    throw new Error("Existing production client Secret has no verified matching receipt; refuse rotation.");
  }
  console.log("Production forum client Secret already provisioned and verifier receipt present; no changes.");
}else{
  if(existingVerified)throw new Error("Verified production receipt exists without Worker Secret; refuse rotation.");
  const secret=randomBytes(48).toString("base64url");
  const digest=createHash("sha256").update(secret).digest("base64url");
  // Store only a SHA-256 verifier before uploading, for safe recovery across build retries.
  query("INSERT INTO settings(key,value) VALUES('"+RECEIPT+"','"+digest+"') "+
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value");
  wrangler(["secret","put",SECRET_NAME,"--name",WORKER,"--config","wrangler.jsonc"],secret+"\n");
  if(!hasSecret())throw new Error("Worker Secret was not present after provisioning.");
  query("INSERT INTO settings(key,value) VALUES('"+VERIFIED+"','"+digest+"') "+
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value");
  if(receiptValue(RECEIPT)!==digest||receiptValue(VERIFIED)!==digest)
    throw new Error("Production verifier receipt readback mismatch.");
  console.log("Production forum OAuth client Secret securely provisioned and verifier recorded; plaintext discarded.");
}
