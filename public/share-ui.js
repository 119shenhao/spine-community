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
  {name:'Bluesky',href:query('https://bsky.app/intent/compose',{text:text+'\n'+link})},
  // Public QQ/Qzone/Weibo share pages take normal web URLs. WeChat,
  // Douyin and Bilibili do not expose a verified generic article-share URL.
  {name:'WeChat',method:'copy'},
  {name:'QQ',href:query('https://connect.qq.com/widget/shareqq/index.html',{url:link,title:text,site:'Spine Community'})},
  {name:'Douyin',method:'copy'},
  {name:'Bilibili',method:'copy'},
  {name:'Weibo',href:query('https://service.weibo.com/share/share.php',{url:link,title:text})},
  {name:'Qzone',href:query('https://sns.qzone.qq.com/cgi-bin/qzshare/cgi_qzshare_onekey',{url:link,title:text,site:'Spine Community'})}
 ];
}


/**
 * Local vector marks: the fallback sharing panel must work without external
 * brand fonts, icon CDNs, scripts, or extra Worker requests.
 * Keep accessible platform names in the caller, not as visible button text.
 */
const socialMarks={
 Facebook:'<path d="M15.2 8H13V6.5c0-.8.4-1.1 1.2-1.1h1.3V2.2c-.5-.1-1.3-.2-2.4-.2-2.8 0-4.5 1.7-4.5 4.6V8H6v3.6h2.6V22H13V11.6h2.1l.1-3.6Z"/>',
 X:'<path d="M18.9 2H22l-6.8 7.8L23 22h-6.2l-4.9-7.5L5.5 22H2.4l7.2-8.3L1.9 2h6.4l4.4 7L18.9 2Zm-1.1 18h1.7L7.3 3.9H5.4L17.8 20Z"/>',
 Reddit:'<path d="M19.8 9.3a2 2 0 0 0-1.7.9c-1.6-1-3.6-1.6-5.8-1.6l1.1-4.1 2.9.7a2 2 0 1 0 .4-1.6l-3.8-.9a.9.9 0 0 0-1.1.7L10.4 8.7c-2.1.2-4.1.8-5.5 1.8a2 2 0 1 0-2.3 3.2c0 3.8 4.3 6.8 9.4 6.8s9.4-3 9.4-6.8a2 2 0 0 0-1.6-4.4ZM8.5 12.2a1.35 1.35 0 1 1 0 2.7 1.35 1.35 0 0 1 0-2.7Zm6.6 4.8c-1.7 1.2-4.5 1.2-6.2 0a.7.7 0 0 1 .8-1.1c1.1.8 3.4.8 4.6 0a.7.7 0 0 1 .8 1.1Zm.4-2.1a1.35 1.35 0 1 1 0-2.7 1.35 1.35 0 0 1 0 2.7Z"/>',
 LinkedIn:'<path d="M3 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM1.4 8H4.6V22H1.4V8ZM7.4 8h3.1v1.9h.1a3.5 3.5 0 0 1 3.3-2.1c3.6 0 4.2 2.2 4.2 5.2V22h-3.3v-8c0-1.9 0-4-2.4-4-2.4 0-2.8 1.9-2.8 3.9V22H7.4V8Z"/>',
 WhatsApp:'<path d="M12 2a9.7 9.7 0 0 0-8.3 14.8L2.5 22l5.3-1.4A9.8 9.8 0 1 0 12 2Zm0 17.8a8 8 0 0 1-4-1l-3.1.8.8-3A8.1 8.1 0 1 1 12 19.8Zm4.4-6.1c-.2-.1-1.5-.8-1.8-.8-.2-.1-.4 0-.6.2l-.8 1c-.1.1-.3.2-.5.1a6.2 6.2 0 0 1-1.8-1.1 6.7 6.7 0 0 1-1.3-1.7c-.1-.2 0-.4.1-.5l.5-.6.3-.4c.1-.2.1-.4 0-.5l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.5.1-.7.3-.3.3-1 1-1 2.3s1 2.6 1.2 2.8c.1.2 2 3.1 5 4.2.7.3 1.3.5 1.8.5.7.1 1.5 0 2-.3.6-.3 1.5-1.4 1.7-2 .1-.5.1-.8-.1-.8Z"/>',
 Telegram:'<path d="M21.5 3 2.7 10.3a1 1 0 0 0 .1 1.9l4.6 1.4 1.8 5.6a1 1 0 0 0 1.7.4l2.7-2.6 4.7 3.5a1 1 0 0 0 1.6-.6l2.8-15.7a1 1 0 0 0-1.2-1.2ZM8.6 12.6l9.4-6.1-7.4 8.1-.4 2.6-1.6-4.6Z"/>',
 Bluesky:'<path d="M6 3.2C8.4 5 11 8.5 12 10.4c1-1.9 3.6-5.4 6-7.2 1.8-1.4 4.7-2.5 4.7 1.2 0 .7-.4 5.5-.7 6.3-.9 2.8-4.1 3.5-6.9 3 4.9.8 6.1 3.4 3.4 6-5.1 5-7.3-4.4-9.5-6.9C9.7 15.6 7.5 25 2.4 20c-2.7-2.6-1.5-5.2 3.4-6-2.8.5-6-.2-6.9-3C-1.4 10.2-1.8 5.4-1.8 4.7-1.8 1 1.2 2.1 3 3.2Z" transform="translate(2 0) scale(.85 1)"/>'
};

const chineseSocialMarks={
 // Locally rendered symbols: no external SDK, icon CDN or tracker.
 WeChat:'<path d="M9.3 3C4.8 3 1.5 6 1.5 9.9c0 2.1 1.1 3.9 2.9 5.1l-.8 3 3.3-1.7c.9.2 1.7.3 2.7.3.4 0 .8 0 1.2-.1a6.3 6.3 0 0 1 6.8-7.5C17.1 5.4 13.8 3 9.3 3ZM6.4 7.2a1 1 0 1 1 0 2 1 1 0 0 1 0-2Zm6 0a1 1 0 1 1 0 2 1 1 0 0 1 0-2Z"/><path d="M17.3 9.5c-3.3 0-6 2.3-6 5.3 0 3.1 2.6 5.3 6 5.3.6 0 1.2-.1 1.7-.3l2.9 1.3-.6-2.5c1.4-1 2.2-2.3 2.2-3.9 0-3-2.7-5.2-6.2-5.2Zm-2.1 3.2a.8.8 0 1 1 0 1.6.8.8 0 0 1 0-1.6Zm4.4 0a.8.8 0 1 1 0 1.6.8.8 0 0 1 0-1.6Z"/>',
 QQ:'<path d="M12 2c-3.2 0-5 3.1-5 7.2 0 2.6-1.6 5.1-2.7 7.2-.5 1 .3 2 1.4 1.6l2-.7c-.2.6-.9 2.5-.6 3.3.4 1.2 2.2 1.3 3 .1l.6-.9h2.6l.6.9c.8 1.2 2.6 1.1 3-.1.3-.8-.4-2.7-.6-3.3l2 .7c1.1.4 1.9-.6 1.4-1.6-1.1-2.1-2.7-4.6-2.7-7.2C17 5.1 15.2 2 12 2Zm-2.1 5.5a.8.8 0 1 1 0 1.6.8.8 0 0 1 0-1.6Zm4.2 0a.8.8 0 1 1 0 1.6.8.8 0 0 1 0-1.6ZM12 10.2c1 0 2.1.6 2.1 1.1S13 12.8 12 12.8s-2.1-1-2.1-1.5 1.1-1.1 2.1-1.1Z"/>',
 Douyin:'<path d="M14.5 2h3.2c.1 3.1 1.8 5 4.3 5.3v3.3a9.6 9.6 0 0 1-4.3-1.2v5.4a7.1 7.1 0 1 1-6.6-7v3.6a3.5 3.5 0 1 0 3.4 3.4V2Z"/>',
 Bilibili:'<path d="M7.4 2.6 9 5.2m7.6-2.6L15 5.2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" fill="none"/><rect x="2.5" y="6" width="19" height="15" rx="4"/><rect x="5.4" y="9" width="13.2" height="8.3" rx="2.4" fill="white"/><path d="M9 11v3m6-3v3" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>',
 Weibo:'<path d="M18.7 9.2c1.6-.3 3.2.5 3.5 2 .8 2.7-1.7 6-5.1 7.6-4.2 2.1-9.8 1.8-13-.9C.6 15 3.6 10.6 8.4 9.2c1.8-.5 2.6-.3 3.4-.2 1 .1 1.3-.3 1.8-1.5.8-2 3.6-1.3 3.4 1.3l-.2.7c.6-.1 1.2-.3 1.9-.3Zm-8.5 3.2c-3 .6-4.8 2.4-4.3 4.2.5 1.8 3 2.5 5.8 1.8 2.7-.6 4.6-2.5 4.2-4.1-.4-1.6-2.7-2.4-5.7-1.9Z"/><circle cx="10.7" cy="15.6" r="1.6" fill="white"/><path d="M16.9 2.4c3.4-.3 5.4 2 4.9 5.2m-5-2c1.5-.2 2.4.8 2.4 2" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/>',
 Qzone:'<path d="m12 1.6 3.4 6.8 7.5 1.1-5.4 5.2 1.3 7.6-6.8-3.6-6.8 3.6 1.3-7.6-5.4-5.2 7.5-1.1L12 1.6Z"/>'
};
Object.assign(socialMarks,chineseSocialMarks);

export function socialShareIcon(platform){
 const mark=socialMarks[platform];
 return mark?'<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">'+mark+'</svg>':'';
}
