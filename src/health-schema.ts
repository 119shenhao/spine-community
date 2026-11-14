import {one} from './core';

// Migrations do not change schema within a running Worker version in normal operation.
// Cache only successful, immutable schema capabilities for five minutes.
// Runtime toggles, metrics and translation cache availability are NEVER cached.
type Schema={ready:boolean;projection:boolean;demand:boolean;languageSchema:boolean;translation:boolean};
const snapshots=new WeakMap<D1Database,{expires:number;value:Schema}>();

export async function healthSchema(db:D1Database):Promise<Schema>{
 const cached=snapshots.get(db);
 if(cached&&cached.expires>Date.now())return cached.value;
 const row=await one(db,`SELECT EXISTS(SELECT 1 FROM settings WHERE key='schema_version' AND value='1') schemaOk,
   EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='public_projection_scan_count') projection,
   EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='public_projection_demand') demand,
   EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='content_language_verifications') languageSchema,
   EXISTS(SELECT 1 FROM pragma_table_info('topic_translations') WHERE name='projection_key') translation`);
 const schema={ready:Boolean(row?.schemaOk&&row?.languageSchema),
   projection:Boolean(row?.projection),demand:Boolean(row?.demand),
   languageSchema:Boolean(row?.languageSchema),translation:Boolean(row?.translation)};
 if(schema.ready)snapshots.set(db,{expires:Date.now()+300_000,value:schema});
 return schema;
}
