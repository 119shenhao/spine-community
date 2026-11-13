/**
 * Pure helpers for explicit, user-initiated sharing.
 * The generated URL points to the topic's own History API route; no API calls,
 * tracking parameters, or third-party SDKs are needed.
 */
export function topicShareUrl(topicId,origin){
 const id=String(topicId||'');
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(id))throw new Error('Invalid topic id');
 return new URL('/topic/'+encodeURIComponent(id),origin).href;
}

export function socialShareTargets(title,url){
 const text=String(title||'Spine Community').trim();
 const link=String(url);
 const query=(base,values)=>{
  const result=new URL(base);
  for(const [key,value] of Object.entries(values))result.searchParams.set(key,value);
  return result.href;
 };
 return [
  {name:'Facebook',href:query('https://www.facebook.com/sharer/sharer.php',{u:link})},
  {name:'X',href:query('https://twitter.com/intent/tweet',{text,url:link})},
  {name:'Reddit',href:query('https://www.reddit.com/submit',{url:link,title:text})},
  {name:'LinkedIn',href:query('https://www.linkedin.com/sharing/share-offsite/',{url:link})},
  {name:'WhatsApp',href:query('https://wa.me/',{text:text+'\n'+link})},
  {name:'Telegram',href:query('https://t.me/share/url',{url:link,text})},
  {name:'Bluesky',href:query('https://bsky.app/intent/compose',{text:text+'\n'+link})}
 ];
}
