import {detectAll} from 'tinyld/heavy';
import {Row,fail,lang} from './core';

export const LANGUAGE_DETECTOR='tinyld-heavy';
const traditional=/[這個與體經驗醫療復頸壓覺後時會裡還過說為讓樣關頭緩謝測試]/u;
const simplified=/[这个与体经验医疗复颈压觉后时会里还过说为让样关头缓谢测试]/u;

const englishWords=new Set([
 'the','and','for','with','that','this','these','those','have','has','had',
 'would','could','should','will','your','you','they','their','there',
 'were','was','are','but','not','can','from','after','before','when',
 'because','been','about','which','what','where','how','does','did',
 'than','then','into','through','while','during','without','since','my','we','our'
]);

type Evidence={language:string;score:number|null;method:'tinyld-heavy'};
const unknown=():Evidence=>({language:'und',score:null,method:LANGUAGE_DETECTOR});
const clean=(text:string)=>text.replace(/https?:\/\/\S+|\b\S+@\S+\b/gi,' ').trim();

function clearlyEnglish(sample:string) {
 const letters=(sample.match(/\p{L}/gu)||[]).length;
 const latin=(sample.match(/\p{Script=Latin}/gu)||[]).length;
 const words=sample.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g)||[];
 if(letters<45||latin<letters*.98||words.length<9)return false;
 const strong=words.filter(word=>englishWords.has(word));
 return strong.length>=4&&new Set(strong).size>=3&&strong.length/words.length>=.14;
}

function classify(sample:string,compareSection=false):Evidence {
 const han=(sample.match(/\p{Script=Han}/gu)||[]).length;
 const latin=(sample.match(/\p{Script=Latin}/gu)||[]).length;
 const kana=(sample.match(/[\p{Script=Hiragana}\p{Script=Katakana}]/gu)||[]).length;
 const letters=(sample.match(/\p{L}/gu)||[]).length;
 if(han+kana>=7&&han+kana>=letters*.85){
  if(kana>=3)return {language:'ja',score:null,method:LANGUAGE_DETECTOR};
  const trad=traditional.test(sample),simp=simplified.test(sample);
  return trad===simp?unknown():{language:trad?'zh-TW':'zh-CN',score:null,method:LANGUAGE_DETECTOR};
 }
 if(letters<16||han+kana>=5&&latin>=10)return unknown();
 // Force independent English sections to be recognized even when a mixed
 // Spanish/English whole-post vote is biased towards Spanish.
 if(compareSection&&letters>=25&&latin>=letters*.98){
  const words=sample.toLowerCase().match(/[a-z]+/g)||[];
  const strong=words.filter(w=>englishWords.has(w));
  if(words.length>=6&&strong.length>=2&&new Set(strong).size>=2&&
    /\b(?:i|my|we|the)\b/i.test(sample))
   return {language:'en',score:null,method:LANGUAGE_DETECTOR};
 }

 const [first,second]=detectAll(sample);
 if(!first||first.lang==='zh')return unknown();
 const confident=first.accuracy>=.42&&(!second||first.accuracy-second.accuracy>=.2);
 const distinct=compareSection&&letters>=26&&first.accuracy>=.02&&second&&first.accuracy>=8*second.accuracy;
 if(confident||distinct)return {language:first.lang,score:Math.max(0,Math.min(first.accuracy,1)),method:LANGUAGE_DETECTOR};
 return clearlyEnglish(sample)?{language:'en',score:null,method:LANGUAGE_DETECTOR}:unknown();
}

export function detectSourceLanguageEvidence(...parts:string[]):Evidence {
 const cleanParts=parts.map(clean);
 const sample=cleanParts.map(part=>part.slice(0,1600)).join(' ');
 const candidate=classify(sample);
 if(candidate.language==='und')return candidate;
 // Do not falsely mark mixed-language content as a single language.
 const sections=cleanParts.flatMap(part=>part.split(/[\n.!?。！？]+/u)).slice(0,10);
 const conflict=sections.some(part=>{
  if(part.length<25)return false;
  const other=classify(part.trim().slice(0,400),true);
  return other.language!=='und'&&other.language!==candidate.language;
 });
 return conflict?unknown():candidate;
}

export const detectSourceLanguage=(...parts:string[])=>detectSourceLanguageEvidence(...parts).language;

export function sourceLanguage(input:Row,parts:string[],previous?:Row) {
 const explicit=input.source_lang_mode==='manual'||(input.source_lang_mode===undefined&&input.source_lang!==undefined);
 if(explicit){
  const label=lang(input.source_lang);
  if(label==='und'&&input.source_lang!=='und')fail(400,'invalid_source_language');
  return {label,mode:'manual',method:'author-manual',score:null};
 }
 if(input.source_lang_mode!==undefined&&input.source_lang_mode!=='auto')fail(400,'invalid_source_language');
 if(input.source_lang_mode===undefined&&previous?.source_lang_mode==='manual')
  return {label:previous.source_lang,mode:'manual',method:'author-manual',score:null};
 const evidence=detectSourceLanguageEvidence(...parts);
 return {label:evidence.language,mode:'auto',method:LANGUAGE_DETECTOR,score:evidence.score};
}

// Imported third-party source labels are weak hints, never a manual author claim.
// If independent detection is uncertain, do not publish the unverified hint
// as the original-language label used by SEO and readers.
export function importedSourceLanguage(hint:unknown,...parts:string[]){
 const evidence=detectSourceLanguageEvidence(...parts);
 if(evidence.language!=='und')
  return {label:evidence.language,mode:'auto',method:LANGUAGE_DETECTOR,score:evidence.score};
 return {label:'und',mode:'legacy',method:'legacy-hint',score:null};
}

export function sameLanguage(source:string,target:string) {
 const normalize=(v:string)=>{
  const tag=v.toLowerCase();
  if(/^zh-(tw|hk|mo|hant)(-|$)/.test(tag))return 'zh-hant';
  if(/^zh-(cn|sg|hans)(-|$)/.test(tag))return 'zh-hans';
  return tag.split('-')[0];
 };
 return normalize(source)===normalize(target);
}
