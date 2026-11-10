import {one,stmt,Row} from './core';
import {detectSourceLanguageEvidence,LANGUAGE_DETECTOR} from './source-language';

export type ContentType='topic'|'comment';
export type LanguageEvidence={language:string;method:string;score:number|null;newlyConfirmed?:boolean};
const permitted=new Set(['tinyld-heavy','azure-auto','admin-manual']);

export function verificationWrite(db:D1Database,type:ContentType,contentId:string,version:number,
 language:string,method:string,score:number|null) {
 if(!permitted.has(method))throw Error('unrecognized_language_detector');
 const table=type==='topic'?'topics':'comments';
 // No evidence may be saved for content that was withdrawn or edited in parallel.
 return stmt(db,`INSERT OR IGNORE INTO content_language_verifications
   (content_type,content_id,content_version,language,method,score)
   SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM ${table}
      WHERE id=? AND content_version=? AND status='published')`,
  type,contentId,version,language,method,score,contentId,version);
}

export async function confirmedLanguage(db:D1Database,type:ContentType,row:Row,parts:string[]):Promise<LanguageEvidence> {
 // Manual author/admin choices are explicit; normal auto classifications are
 // stored on the original and never require another detector run.
 if(row.source_lang_mode==='manual'||(row.source_lang_mode==='auto'&&row.source_lang!=='und'))
  return {language:row.source_lang,method:row.source_lang_mode,score:null};
 const existing=await one(db,`SELECT language,method,score FROM content_language_verifications
  WHERE content_type=? AND content_id=? AND content_version=?`,type,row.id,row.content_version);
 if(existing)return {language:existing.language,method:existing.method,score:existing.score};
 const evidence=detectSourceLanguageEvidence(...parts);
 if(evidence.language==='und')return {language:'und',method:LANGUAGE_DETECTOR,score:null};
 const write=await verificationWrite(db,type,row.id,row.content_version,evidence.language,
  LANGUAGE_DETECTOR,evidence.score).run();
 // A conflicting parallel verification should remain authoritative.
 const confirmed=await one(db,`SELECT language,method,score FROM content_language_verifications
  WHERE content_type=? AND content_id=? AND content_version=?`,type,row.id,row.content_version);
 return confirmed?{language:confirmed.language,method:confirmed.method,score:confirmed.score,
  newlyConfirmed:Boolean(write.meta.changes)}
  :{language:'und',method:LANGUAGE_DETECTOR,score:null};
}

export async function confirmAzureLanguage(db:D1Database,type:ContentType,row:Row,
 language:string,score:number):Promise<boolean>{
 if(!Number.isFinite(score)||score<0||score>1||!language||language==='und')return false;
 await verificationWrite(db,type,row.id,row.content_version,language,'azure-auto',score).run();
 const saved=await one(db,`SELECT language FROM content_language_verifications
  WHERE content_type=? AND content_id=? AND content_version=?`,type,row.id,row.content_version);
 return saved?.language===language;
}
