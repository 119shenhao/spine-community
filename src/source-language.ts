import {detectAll} from 'tinyld/light';
import {Row,fail,lang} from './core';

const traditional=/[這個與體經驗醫療復頸壓覺後時會裡還過說為讓樣關頭緩謝測試]/u;
const simplified=/[这个与体经验医疗复颈压觉后时会里还过说为让样关头缓谢测试]/u;

// The compact detector can be inconclusive on short English medical writing.
// Use a conservative, language-specific fallback only when several distinct
// English function words support the text (not merely ASCII/Latin characters).
const englishWords=new Set([
  'the','and','for','with','that','this','these','those','have','has','had',
  'would','could','should','will','your','you','they','their','there',
  'were','was','are','but','not','can','from','after','before','when',
  'because','been','about','which','what','where','how','does','did',
  'than','then','into','through','while','during','without','since'
]);
function clearlyEnglish(sample:string) {
  const letters=(sample.match(/\p{L}/gu)||[]).length;
  const latin=(sample.match(/\p{Script=Latin}/gu)||[]).length;
  const words=sample.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g)||[];
  if(letters<45||latin<letters*.98||words.length<9)return false;
  const strong=words.filter(word=>englishWords.has(word));
  return strong.length>=4&&new Set(strong).size>=3&&strong.length/words.length>=.14;
}

function classify(sample:string,compareSection=false) {
  const han=(sample.match(/\p{Script=Han}/gu)||[]).length;
  const latin=(sample.match(/\p{Script=Latin}/gu)||[]).length;
  const kana=(sample.match(/[\p{Script=Hiragana}\p{Script=Katakana}]/gu)||[]).length;
  const letters=(sample.match(/\p{L}/gu)||[]).length;
  if(han+kana>=7&&han+kana>=letters*.85){
    if(kana>=3)return 'ja';
    const trad=traditional.test(sample),simp=simplified.test(sample);
    return trad===simp?'und':trad?'zh-TW':'zh-CN';
  }
  if(letters<16||((han+kana)>=5&&latin>=10))return 'und';
  const [first,second]=detectAll(sample);
  if(!first||first.lang==='zh')return 'und';
  const confident=first.accuracy>=.42&&(!second||first.accuracy-second.accuracy>=.2);
  const distinctSection=compareSection&&letters>=26&&first.accuracy>=.02&&second&&first.accuracy>=8*second.accuracy;
  if(confident||distinctSection)return first.lang;
  return clearlyEnglish(sample)?'en':'und';
}

export function detectSourceLanguage(...parts:string[]) {
  const clean=(text:string)=>text.replace(/https?:\/\/\S+|\b\S+@\S+\b/gi,' ').trim();
  const cleanParts=parts.map(clean);
  const sample=cleanParts.map(part=>part.slice(0,1600)).join(' ');
  const candidate=classify(sample);
  if(candidate==='und')return candidate;
  // Compare separately detectable sections to catch mixed-language posts.
  const sections=cleanParts.flatMap(part=>part.split(/[\n.!?。！？]+/u)).slice(0,10);
  return sections.some(part=>{
    if(part.length<25)return false;
    const other=classify(part.trim().slice(0,400),true);
    return other!=='und'&&other!==candidate;
  })?'und':candidate;
}

export function sourceLanguage(input:Row,parts:string[],previous?:Row) {
  const explicit=input.source_lang_mode==='manual'||(input.source_lang_mode===undefined&&input.source_lang!==undefined);
  if(explicit){
    const label=lang(input.source_lang);
    if(label==='und'&&input.source_lang!=='und')fail(400,'invalid_source_language');
    return {label,mode:'manual'};
  }
  if(input.source_lang_mode!==undefined&&input.source_lang_mode!=='auto')fail(400,'invalid_source_language');
  if(input.source_lang_mode===undefined&&previous?.source_lang_mode==='manual')
    return {label:previous.source_lang,mode:'manual'};
  return {label:detectSourceLanguage(...parts),mode:'auto'};
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
