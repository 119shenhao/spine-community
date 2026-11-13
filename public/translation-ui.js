// The browser renders translations and decrypts public projection payloads only
// after the Worker authorizes the current original version. It never calls Azure.
const keyOf=({type,id,version,scope})=>[type,id,version,scope].join(':');
const normalized=language=>{
 const tag=language.toLowerCase();
 if(/^zh-(tw|hk|mo|hant)(-|$)/.test(tag))return 'zh-hant';
 if(/^zh-(cn|sg|hans)(-|$)/.test(tag))return 'zh-hans';
 return tag.split('-')[0];
};
const decode=value=>Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));

export async function unpackTranslation(result,entry) {
 if(!result?.translated)return null;
 if(!result.key)return typeof result.body==='string'?result:null;
 const key=await crypto.subtle.importKey('raw',decode(result.key),'AES-GCM',false,['decrypt']);
 const encrypted=decode(entry.ciphertext);
 const bytes=await crypto.subtle.decrypt({name:'AES-GCM',iv:encrypted.subarray(0,12)},key,encrypted.subarray(12));
 const value=JSON.parse(new TextDecoder().decode(bytes));
 return typeof value.body==='string'?value:null;
}

export function translationView(locale,{request,configured,hasCache,direct,render,onStale}) {
 const entries=new Map(),views=new WeakMap(),pages=new WeakMap(),queue=new Set(),cacheChecks=new WeakMap();
 let closed=false,stale=false,timer,observer;
 function item(type,row,scope='full') {
  if(!(configured||hasCache||row.translations?.[locale])||(!row.body&&!row.summary)||(row.status&&row.status!=='published')||
   !Number.isSafeInteger(row.content_version))return null;
  const source=row.source_lang||'und';
  if(row.source_lang_mode&&row.source_lang_mode!=='legacy'&&source!=='und'&&normalized(source)===normalized(locale))return null;
  const page=pages.get(row)||null, projected=page&&row.translations?.[locale];
  const ready=direct&&projected?.sourceVersion===row.content_version&&typeof projected.body==='string'&&
   typeof projected.title==='string'&&typeof projected.provider==='string'&&
   (type!=='topic'||scope!=='summary'||projected.summaryRevision===2);
  const entry={type,id:row.id,version:row.content_version,scope,page,
   token:direct?undefined:projected?.token,ciphertext:direct?undefined:projected?.ciphertext};
  const key=keyOf(entry);
  let state=entries.get(key);
  if(!state){
   state={entry,key,result:ready?projected:null,original:false,attempts:0,checked:Boolean(ready),finished:Boolean(ready),nodes:new Set()};
   entries.set(key,state);
  }else if(!state.entry.page&&entry.page){
   state.entry=entry;
   if(ready){state.result=projected;state.checked=true;state.finished=true;}
  }
  return state;
 }
 async function load(states,generate,signal) {
  if(closed||!states.length)return;
  const payload=states.map(({entry:{ciphertext,...entry}})=>entry);
  let results;
  try{results=(await request({locale,items:payload,generate},signal)).items;}catch{return;}
  if(closed||!Array.isArray(results))return;
  await Promise.all(states.map(async(state,i)=>{
   const response=results[i];
   state.checked=true;
   if(!stale&&state.entry.page&&['content_changed','not_found'].includes(response?.reason)){
    stale=true;
    onStale?.();
    return;
   }
   if(generate&&response?.reason==='translation_in_progress'&&state.attempts<4){
    const wait=[0,700,1800,4200][state.attempts];
    setTimeout(()=>{if(!closed&&[...state.nodes].some(node=>node.isConnected&&visible(node.parentElement)))enqueue(state);},wait);
    return;
   }
   if(generate||response?.reason!=='translation_cache_miss')state.finished=true;
   let value;
   try{value=await unpackTranslation(response,state.entry);}catch{return;}
   if(closed||!value)return;
   state.result=value;
   state.finished=true;
   for(const node of state.nodes){
    if(node.isConnected)render(node,state);
    else state.nodes.delete(node);
   }
  }));
 }
 const visible=element=>{
  const rect=element.getBoundingClientRect();
  return rect.bottom>0&&rect.top<innerHeight&&rect.right>0&&rect.left<innerWidth;
 };
 function enqueue(state) {
  if(closed||state.finished||(!configured&&state.checked))return;
  queue.add(state);
  if(!timer)timer=setTimeout(flush,35);
 }
 async function flush() {
  timer=null;
  const states=[...queue].filter(state=>!state.finished&&[...state.nodes].some(node=>node.isConnected&&visible(node.parentElement)));
  queue.clear();
  for(let i=0;i<states.length&&!closed;i+=4){
   const batch=states.slice(i,i+4);
   // A public CDN object can still be in the old format during migration.
   // Finish its cache-only D1 check before requesting a new Azure translation.
   const checks=[...new Set(batch.map(state=>cacheChecks.get(state)).filter(Boolean))];
   if(checks.length)await Promise.allSettled(checks);
   if(closed)break;
   const unresolved=batch.filter(state=>!state.finished);
   if(!unresolved.length)continue;
   unresolved.forEach(state=>state.attempts++);
   await load(unresolved,configured);
  }
 }
 return {
  markPage(data){
   if(data.projectionKey)for(const row of [...(data.topics||[]),...(data.topic?[data.topic]:[]),...(data.comments||[]),...(data.progress||[])]){
    pages.set(row,data.projectionKey);
   }
  },
  async prime(candidates){
   const states=[...new Set(candidates.map(([type,row,scope])=>item(type,row,scope)).filter(state=>state&&!state.checked))].slice(0,8);
   if(!states.length||!(hasCache||states.some(state=>state.entry.token)))return;
   if(direct){
    // Do not block first paint. Missing/stale locale objects may still have
    // a valid D1 translation from before the CDN format migration.
    const checking=load(states,false,AbortSignal.timeout(1200));
    for(const state of states)cacheChecks.set(state,checking);
    return;
   }
   await load(states,false,AbortSignal.timeout(450));
  },
  item,
  observe(nodes){
   if(closed)return;
   observer?.disconnect();
   for(const state of entries.values())for(const node of state.nodes)if(!node.isConnected)state.nodes.delete(node);
   observer=new IntersectionObserver(changes=>{
    for(const change of changes){
     if(!change.isIntersecting)continue;
     for(const state of views.get(change.target)||[])enqueue(state);
    }
   });
   for(const node of nodes){
    const state=entries.get(node.dataset.translation);
    if(!state)continue;
    state.nodes.add(node);
    if(state.result){render(node,state);continue;}
    const target=node.parentElement;
    const states=views.get(target)||new Set();
    states.add(state);views.set(target,states);
    observer.observe(target);
   }
  },
  toggle(node){
   const state=entries.get(node.dataset.translation);
   if(!state?.result)return;
   state.original=!state.original;
   for(const bound of state.nodes)if(bound.isConnected)render(bound,state);
  },
  suspend(){observer?.disconnect();clearTimeout(timer);timer=null;queue.clear();},
  close(){closed=true;observer?.disconnect();clearTimeout(timer);}
 };
}

