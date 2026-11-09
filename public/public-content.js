const HOSTS={
 preview:'https://spine-data-dev.nbn369.com',
 production:'https://spine-data.nbn369.com'
};
const PUBLIC_ID=/^[A-Za-z0-9_-]{1,128}$/;

function contentError(status) {
 return Object.assign(new Error(status===404?'not_found':'public_content_unavailable'),{status});
}

export function publicContentReader(health,user,api,fetcher=fetch,locale=null) {
 const base=health?.publicContent?.baseUrl;
 const eligible=base===HOSTS[health?.environment]&&Boolean(base)&&(!user||health.publicContent.signedIn===true);
 async function applyViewer(data,key,version) {
  const topics=data.topics||(data.topic?[data.topic]:[]);
  const comments=[...(data.comments||[]),...(data.progress||[])];
  const commentRefs=new Map(comments.map(row=>[row.id,row]));
  const ref=row=>[row.id,row.status||'published',row.content_version];
  const state=await api('/api/public-content/viewer',{method:'POST',signal:AbortSignal.timeout(2500),
   body:JSON.stringify({page:key,version,topics:topics.map(ref),comments:[...commentRefs.values()].map(ref)})});
  if(state.useWorker||!Array.isArray(state.topics)||!Array.isArray(state.comments))return false;
  const add=(rows,flags)=>{
   const byId=new Map(flags.map(flag=>[flag.id,flag]));
   if(new Set(rows.map(row=>row.id)).size!==flags.length||rows.some(row=>!byId.has(row.id)))return false;
   for(const row of rows){
    const flag=byId.get(row.id);
    row.liked=Boolean(flag.liked);
    if(row.status==='published')row.like_count=flag.like_count;
    if(flag.mine)row.author_id=user.id;
    if('followed' in flag){
     row.bookmarked=Boolean(flag.bookmarked);
     row.followed=Boolean(flag.followed);
     row.reply_count=flag.reply_count;
     if(flag.mine)row.symptom_duration_days=flag.symptom_duration_days;
    }
   }
   return true;
  };
  return add(topics,state.topics)&&add(comments,state.comments);
 }
 async function attachLocale(data,key,version) {
  if(!health?.publicContent?.separateTranslations||!locale||
    !data.translationLocales?.includes(locale))return;
  const url=base+'/i18n/'+encodeURIComponent(locale)+'/'+key;
  try {
   const response=await fetcher(url,{credentials:'omit',referrerPolicy:'no-referrer',
     redirect:'error',signal:AbortSignal.timeout(4500)});
   if(!response.ok)return;
   const translated=await response.json();
   if(translated.schemaVersion!==1||translated.translationLayout!=='separate-v1'||
      translated.locale!==locale||translated.sourceKey!==key||
      translated.contentVersion!==version||translated.invalidated||
      !Array.isArray(translated.items))return;
   const index=new Map();
   for(const item of translated.items) {
    if(!item||!['topic','comment'].includes(item.type)||typeof item.id!=='string'||
       !['summary','full','preview'].includes(item.scope)||typeof item.body!=='string')continue;
    index.set([item.type,item.id,item.scope].join(':'),item);
   }
   const apply=(rows,type,scope)=>{
    for(const row of rows) {
     const item=index.get([type,row.id,scope].join(':'));
     if(item?.sourceVersion!==row.content_version||row.status&&row.status!=='published')continue;
     (row.translations??={})[locale]={
       title:item.title||'',body:item.body,provider:item.provider,
       sourceVersion:item.sourceVersion
     };
    }
   };
   apply(data.topics||[],'topic','summary');
   apply(data.topic?[data.topic]:[],'topic','full');
   apply(data.comments||[],'comment','full');
   apply(data.progress||[],'comment','preview');
  }catch{} // CDN miss: show original; the visible missing rows are translated on demand.
 }
 async function read(key,fallback,accept,firstPage=true) {
  let envelope;
  try{
   const response=await fetcher(base+'/'+key,{credentials:'omit',referrerPolicy:'no-referrer',
    redirect:'error',signal:AbortSignal.timeout(4500)});
   if(!response.ok)throw Object.assign(contentError(response.status===404?404:503),{missing:response.status===404});
   envelope=await response.json();
   if(envelope.schemaVersion!==1||!Number.isSafeInteger(envelope.contentVersion))throw contentError(503);
   if(envelope.invalidated===true)throw Object.assign(contentError(503),{missing:true});
   if(envelope.data===null)throw Object.assign(contentError(404),{withdrawn:firstPage});
   if(!accept(envelope))throw contentError(503);
   if(health?.publicContent?.separateTranslations&&envelope.data?.translationLayout!=='separate-v1')
     throw Object.assign(contentError(503),{missing:true});
  }catch(error){
   if(error.withdrawn&&!user)throw error;
   if(user||health.publicContent.fallback){
    const options=health.publicContent.fallback&&health.publicContent.onDemand&&error.missing?{headers:{'x-spine-projection-miss':key}}:undefined;
    const data=await fallback(options);
    return options?{...data,projectionKey:data.resetFeed?'feeds/latest/page-1.json':key}:data;
   }
   throw contentError(error.status===404?404:503);
  }
  if(user){
   let ready=false;
   try{ready=await applyViewer(envelope.data,key,envelope.contentVersion);}catch{}
   if(!ready)return fallback();
  }
  await attachLocale(envelope.data,key,envelope.contentVersion);
  return {...envelope.data,projectionVersion:envelope.contentVersion,projectionKey:key};
 }

 return {
  feed(query,previousVersion=null){
   const path='/api/topics?'+query;
   const offset=Number(query.get('offset')||0);
   const standard=(!query.has('sort')||query.get('sort')==='latest')&&
    [...query.keys()].every(key=>key==='sort'||key==='offset')&&Number.isInteger(offset)&&
    offset>=0&&offset<=10000&&offset%20===0;
   if(!eligible||!standard||(offset>0&&!previousVersion&&!health.publicContent.onDemand))return api(path);
   const fallback=async options=>{
    if(offset===0||!previousVersion)return api(path,options);
    const fresh=new URLSearchParams(query);
    fresh.delete('offset');
    return {...await api('/api/topics?'+fresh,options),resetFeed:true};
   };
   return read(`feeds/latest/page-${offset/20+1}.json`,fallback,e=>
    Array.isArray(e.data.topics)&&(offset===0||e.contentVersion===previousVersion),offset===0);
  },
  topic(topicId,query,page=1,previousVersion=null){
   const path='/api/topics/'+encodeURIComponent(topicId)+'?'+query;
   if(!eligible||!PUBLIC_ID.test(topicId)||query.has('focus')||query.has('progress')||
     (page>1&&!previousVersion&&!health.publicContent.onDemand))return api(path);
   const key=page===1?`topics/${topicId}/detail.json`:
      `topics/${topicId}/comments/${health?.publicContent?.pageSize===20?'size-20/':''}page-${page}.json`;
   return read(key,options=>api(path,options),e=>e.topicId===topicId&&Array.isArray(e.data.comments)&&
    (page===1?e.data.topic?.id===topicId&&Array.isArray(e.data.progress):e.contentVersion===previousVersion),page===1);
  }
 };
}
