const HOSTS={
 preview:'https://spine-data-dev.nbn369.com',
 production:'https://spine-data.nbn369.com'
};
const PUBLIC_ID=/^[A-Za-z0-9_-]{1,128}$/;

function contentError(status) {
 return Object.assign(new Error(status===404?'not_found':'public_content_unavailable'),{status});
}

export function publicContentReader(health,user,api,fetcher=fetch) {
 const base=health?.publicContent?.baseUrl;
 const eligible=!user&&base===HOSTS[health?.environment]&&Boolean(base);
 async function read(key,fallback,accept,firstPage=true) {
  try{
   const response=await fetcher(base+'/'+key,{credentials:'omit',referrerPolicy:'no-referrer',
    redirect:'error',signal:AbortSignal.timeout(4500)});
   if(!response.ok)throw contentError(response.status===404?404:503);
   const envelope=await response.json();
   if(envelope.schemaVersion!==1||!Number.isSafeInteger(envelope.contentVersion))throw contentError(503);
   if(envelope.data===null)throw Object.assign(contentError(404),{withdrawn:firstPage});
   if(!accept(envelope))throw contentError(503);
   return {...envelope.data,projectionVersion:envelope.contentVersion};
  }catch(error){
   if(error.withdrawn)throw error;
   if(health.publicContent.fallback)return fallback();
   throw contentError(error.status===404?404:503);
  }
 }

 return {
  feed(query,previousVersion=null){
   const path='/api/topics?'+query;
   const offset=Number(query.get('offset')||0);
   const standard=(!query.has('sort')||query.get('sort')==='latest')&&
    [...query.keys()].every(key=>key==='sort'||key==='offset')&&Number.isInteger(offset)&&
    offset>=0&&offset<=10000&&offset%20===0;
   if(!eligible||!standard||(offset>0&&!previousVersion))return api(path);
   const fallback=async()=>{
    if(offset===0)return api(path);
    const fresh=new URLSearchParams(query);
    fresh.delete('offset');
    return {...await api('/api/topics?'+fresh),resetFeed:true};
   };
   return read(`feeds/latest/page-${offset/20+1}.json`,fallback,e=>
    Array.isArray(e.data.topics)&&(previousVersion===null||e.contentVersion===previousVersion),offset===0);
  },
  topic(topicId,query,page=1,previousVersion=null){
   const path='/api/topics/'+encodeURIComponent(topicId)+'?'+query;
   if(!eligible||!PUBLIC_ID.test(topicId)||query.has('focus')||query.has('progress')||
     (page>1&&!previousVersion))return api(path);
   const key=page===1?`topics/${topicId}/detail.json`:`topics/${topicId}/comments/page-${page}.json`;
   return read(key,()=>api(path),e=>e.topicId===topicId&&Array.isArray(e.data.comments)&&
    (page===1?e.data.topic?.id===topicId&&Array.isArray(e.data.progress):e.contentVersion===previousVersion),page===1);
  }
 };
}
