import {Row,lang} from './core';
import {detectSourceLanguageEvidence} from './source-language';

export type HistoricalLanguageProposal={
 language:string;mode:'legacy'|'auto';reason:'detected'|'existing_provisional'|'unresolved';
 verified:boolean;score:number|null;needsReview:boolean;
};

// A provisional label keeps the page usable without claiming that the label
// was independently verified. Do not use source_lang_mode='manual' for guesses.
export function proposeHistoricalLanguage(row:Row,parts:string[]):HistoricalLanguageProposal {
 const evidence=detectSourceLanguageEvidence(...parts);
 if(evidence.language!=='und'){
  return {language:evidence.language,mode:'auto',reason:'detected',
   verified:true,score:evidence.score,needsReview:false};
 }
 const prior=lang(row.source_lang);
 if(prior!=='und'){
  return {language:prior,mode:'legacy',reason:'existing_provisional',
   verified:false,score:null,needsReview:true};
 }
 return {language:'und',mode:'legacy',reason:'unresolved',
  verified:false,score:null,needsReview:true};
}
