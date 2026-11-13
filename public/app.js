import {dictionaries,languages} from './i18n.js';
import {topicShareUrl,socialShareTargets,socialShareIcon} from './share-ui.js';
import {initialLocale} from './locale.js';
import {defaultReadingPreferences,loadReadingPreferences,applyReadingPreferences,saveReadingPreferences,readingLabels} from './reading-preferences.js';
import {postingLanguage,profilePostingLanguageOptions} from './posting-language.js';
import {applyInteractionResult} from './interaction-ui.js';
import {applyReplyResult} from './reply-ui.js';
import {feedParams,sortRoute} from './feed-ui.js';
import {cardPreview} from './feed-preview.js';
import {publicContentReader} from './public-content.js';
import {translationView} from './translation-ui.js';
import {renderProjectionAdmin,projectionAdminAction} from './projection-admin.js';
import {renderTranslationAdmin} from './translation-admin.js';
import {renderContentStats,renderContentPeriod,updateAnalyticsDayButtons} from './content-stats-ui.js';
import {renderContributorProfile,renderContributorItems,renderContributorRanking} from './contributors-ui.js';
import {renderLanguageReview} from './language-admin.js';
const $=(s,root=document)=>root.querySelector(s),$$=(s,root=document)=>[...root.querySelectorAll(s)];
// Resolve and persist the visitor's language before any Google sign-in redirect.
// An account's database default ('en') must not reset the UI language on login.
let locale=initialLocale(localStorage,navigator.language,languages);
// Rendering preferences belong to the visitor's browser, including signed-out visitors.
const readingStorage=(()=>{try{return window.localStorage;}catch{return null;}})();
let readingPreferences=loadReadingPreferences(readingStorage);
applyReadingPreferences(document.documentElement,readingPreferences);
const readingText=key=>readingLabels(locale)[key];
const state={user:null,google:false,health:null,terms:[],next:null,feed:[],highlights:[],topic:null,comments:[],notificationItems:[],unread:0,admin:null};
let sequence=0,observer,toastTimer,translations;
let analyticsRankingRequest=0;
const historicalLanguageAfter={topic:'',comment:''};
const t=k=>dictionaries[locale][k]||k;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const svg={home:'<path d="m3 9 9-7 9 7v12H3Z"/><path d="M9 21v-8h6v8"/>',search:'<circle cx="10.5" cy="10.5" r="7"/><path d="m16 16 5 5"/>',neck:'<path d="M9 3c-2 3 0 5 1 7s-2 4-3 5-1 4-1 6M15 3c-2 3 0 5 1 7s-2 4-3 5-1 4-1 6M9 5h6M10 10h6M7 16h6M6 21h6"/>',story:'<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 11h8M8 15h5"/>',user:'<circle cx="12" cy="8" r="4"/><path d="M4 21c0-9 16-9 16 0"/>',bell:'<path d="M5 17h14l-2-4V9a5 5 0 0 0-10 0v4ZM10 21h4"/>',heart:'<path d="M20 5c-3-3-7-1-8 1-1-2-5-4-8-1-4 4 2 10 8 15 6-5 12-11 8-15Z"/>',chat:'<path d="M21 11a9 9 0 0 1-9 9H4l-2 2V11a9 9 0 0 1 19 0Z"/>',bookmark:'<path d="M6 3h12v19l-6-4-6 4Z"/>',follow:'<path d="M6 17c-6-6 3-14 6-5 3-9 12-1 6 5l-6 5Z"/><path d="M12 2v4M2 5l3 3M22 5l-3 3"/>',leaf:'<path d="M5 19C-2 5 15 2 21 3c0 13-7 19-16 16Zm0 0L17 7"/>',check:'<path d="m4 12 5 5L20 6"/>',arrow:'<path d="M4 12h16m-5-5 5 5-5 5"/>',shield:'<path d="m12 2 9 4v7c-2 5-5 7-9 9-4-2-7-4-9-9V6Z"/><path d="m8 12 3 3 5-6"/>',plus:'<path d="M12 4v16M4 12h16"/>',globe:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c-6 6-6 12 0 18 6-6 6-12 0-18Z"/>'};
svg.share='<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m9 11 6-4M9 13l6 4"/>';
const icon=k=>`<span class="icon" aria-hidden="true"><svg viewBox="0 0 24 24">${svg[k]||svg.story}</svg></span>`;
const button=(label,action,attrs='',kind='')=>`<button type="button" class="button ${kind}" data-action="${action}" ${attrs}>${label}</button>`;
const date=n=>new Intl.DateTimeFormat(locale,{month:'short',day:'numeric',year:'numeric'}).format(new Date(n*1000));
const termName=id=>state.terms.find(x=>x.id===id)?.label||id;
const statusHtml=s=>s&&!['published','deleted'].includes(s)?`<span class="status">${esc(t(s))}</span>`:'';
function errorText(e){const c=e.code;if(e.status===401)return t('loginNote');if(e.status===404)return t('notFound');if(e.status===429)return t('rateLimit');if(['account_muted','account_banned'].includes(c))return t('muted');if(e.status===403)return t('forbidden');if(c?.startsWith('invalid_'))return t('required');return t('errorTitle');}
async function api(path,options={}){const r=await fetch(path,{credentials:'same-origin',...options,headers:{...(options.body?{'content-type':'application/json'}:{}),...options.headers}});let v;try{v=await r.json();}catch{v={};}if(!r.ok){const e=new Error(v.error||'request_failed');e.code=v.error;e.status=r.status;throw e;}return v;}
const send=(path,body,method='POST')=>api(path,{method,body:JSON.stringify(body)});
const publicReads=()=>publicContentReader(state.health,state.user,api,fetch,locale);
function toast(message){clearTimeout(toastTimer);$('#toast').textContent=message;$('#toast').hidden=false;toastTimer=setTimeout(()=>$('#toast').hidden=true,4500);}
function modal(html){const content=$('#modal-content');content.innerHTML=html;content.scrollTop=0;if(!$('#modal').open)$('#modal').showModal();}
function closeModal(){$('#modal').close();}
function showReadingSettings(){
 const radioGroup=(name,title,entries,current)=>`<fieldset class="reading-options"><legend>${esc(title)}</legend>${entries.map(([value,label])=>`<label class="reading-choice"><input type="radio" name="${name}" value="${value}" ${value===current?'checked':''}><span>${esc(label)}</span></label>`).join('')}</fieldset>`;
 modal(`<h2>${esc(readingText('title'))}</h2><p>${esc(readingText('hint'))}</p><div class="reading-options-grid">${radioGroup('reading-theme',readingText('theme'),[['standard',readingText('standard')],['warm',readingText('warm')]],readingPreferences.theme)}${radioGroup('reading-size',readingText('size'),[['regular',readingText('regular')],['comfortable',readingText('comfortable')],['large',readingText('large')]],readingPreferences.size)}</div><button type="button" class="button" data-action="reading-reset">${esc(readingText('reset'))}</button>`);
}
function readingSettingsCard(){
 return `<section class="panel reading-settings-panel" aria-labelledby="reading-settings-title"><div class="reading-settings-summary"><div><h2 id="reading-settings-title">${esc(readingText('title'))}</h2><p class="subtle">${esc(readingText('hint'))}</p></div>${button(esc(readingText('link')),'reading-options','','primary')}</div></section>`;
}
function needUser(){if(state.user)return true;showLogin();return false;}
const isPreview=()=>state.health?.environment==='preview'||(!state.health?.environment&&(location.hostname.startsWith('feature-')||['localhost','127.0.0.1'].includes(location.hostname)));
function showLogin(){modal(`<h2>${t('login')}</h2><p>${t('loginNote')}</p>${state.google?`<a class="button primary" href="/api/auth/google">G &nbsp; ${t('google')}</a>`:`<div class="notice">${t('loginSetup')}</div>`}${isPreview()?`<p class="subtle">${t('previewOnly')}</p>`:''}`);}
const chineseShareNames={WeChat:'微信',QQ:'QQ',Douyin:'抖音',Bilibili:'B站',Weibo:'微博',Qzone:'QQ空间'};
const sharePlatformName=name=>locale.startsWith('zh')?(chineseShareNames[name]||name):name;
function shareTopicDialog(c,url){
 const targets=socialShareTargets(c.title,url);
 const card=target=>{
  const name=sharePlatformName(target.name),mark=socialShareIcon(target.name);
  const label=target.method==='copy'?t('shareCopyToApp').replace('{app}',name):name;
  const attrs=`class="share-platform share-${esc(target.name.toLowerCase())}" aria-label="${esc(label)}" title="${esc(label)}"`;
  return target.method==='copy'
   ?`<button type="button" ${attrs} data-action="share-app-copy" data-platform="${esc(target.name)}">${mark}<span class="sr-only">${esc(label)}</span></button>`
   :`<a href="${esc(target.href)}" target="_blank" rel="noopener noreferrer" ${attrs}>${mark}<span class="sr-only">${esc(label)}</span></a>`;
 };
 modal(`<h2>${esc(t('sharePost'))}</h2><p>${esc(t('sharePostHint'))}</p><div class="share-grid" role="group" aria-label="${esc(t('sharePost'))}">${targets.map(card).join('')}</div><p class="subtle share-app-note">${esc(t('shareAppHint'))}</p><div class="share-link-row"><input id="share-url" type="text" readonly aria-label="${esc(t('copyLink'))}" value="${esc(url)}">${button(t('copyLink'),'share-copy','','primary')}</div>${typeof navigator.share==='function'?`<div class="share-native">${button(icon('share')+t('shareSystem'),'share-native')}</div>`:''}`);
}
async function showShareTopic(c){
 if(!c||c.status!=='published')return;
 const url=topicShareUrl(c.id,location.origin);
 // Invoke Web Share immediately in the click gesture. iOS Safari requires a
 // transient user activation; an intermediate modal or async work may lose it.
 if(typeof navigator.share==='function'){
  try{
   await navigator.share({title:c.title||'Spine Community',url});
   return;
  }catch(e){
   // A cancelled native share leaves the fallback choices available.
   shareTopicDialog(c,url);
   if(e?.name!=='AbortError')toast(t('shareSystemError'));
   return;
  }
 }
 shareTopicDialog(c,url);
}
function route(){return {path:location.pathname==='/index.html'?'/':location.pathname,params:new URLSearchParams(location.search)};}
// Keep list entries in memory, including all loaded pages and their translation views.
// Entry keys distinguish different visits to the same URL and different search filters.
const listViews=new Map();
const listFields=['feed','next','feedVersion','highlights','meNext','contributorId','contributorNext'];
const navigationKey=()=>crypto.randomUUID();
let navigationEntry={key:navigationKey(),index:0,url:location.pathname+location.search+location.hash,list:null};
history.replaceState({...history.state,scNavigation:navigationEntry},'');
if('scrollRestoration' in history)history.scrollRestoration='manual';
let renderedListEntry=null;
function saveListView(){
 if(renderedListEntry!==navigationEntry.key)return;
 const main=$('#main');
 if(!main||main.querySelector('.loading'))return;
 observer?.disconnect();translations?.suspend();
 const data=Object.fromEntries(listFields.map(key=>[key,state[key]]));
 listViews.delete(navigationEntry.key);
 listViews.set(navigationEntry.key,{entry:{...navigationEntry},nodes:[...main.childNodes],data,
  translations,locale,user:state.user?.id||null,top:window.scrollY,left:window.scrollX});
 translations=null;
 while(listViews.size>12){const key=listViews.keys().next().value;listViews.get(key).translations?.close();listViews.delete(key);}
}
function restoreListView(n){
 const saved=listViews.get(navigationEntry.key);
 if(!saved||saved.locale!==locale||saved.user!==(state.user?.id||null))return false;
 translations?.close();translations=saved.translations;
 Object.assign(state,saved.data);
 $('#main').replaceChildren(...saved.nodes);
 renderedListEntry=navigationEntry.key;
 // Restore after the full list is mounted, before observing infinite pagination.
 window.scrollTo({top:saved.top,left:saved.left,behavior:'instant'});
 requestAnimationFrame(()=>{if(n===sequence){loadButton();translateVisible(n);}});
 return true;
}
function topicListEntry(){return listViews.get(navigationEntry.list);}
function returnToList(){
 const saved=topicListEntry();
 if(saved&&navigationEntry.index>saved.entry.index){history.go(saved.entry.index-navigationEntry.index);return;}
 return navigate('/');
}
function navigate(path){
 const url=new URL(path,location.origin);
 if(url.origin!==location.origin||url.pathname.startsWith('/api/'))return;
 const destination=url.pathname+url.search+url.hash;
 if(destination===location.pathname+location.search+location.hash)return;
 saveListView();
 const list=renderedListEntry===navigationEntry.key&&listViews.has(navigationEntry.key)?navigationEntry.key:navigationEntry.list;
 navigationEntry={key:navigationKey(),index:navigationEntry.index+1,url:destination,list:url.pathname.startsWith('/topic/')?list:null};
 history.pushState({scNavigation:navigationEntry},'',destination);
 window.scrollTo({top:0,behavior:'instant'});
 return render();
}
function highlight(value){let raw=String(value||'');const words=[...new Set(state.highlights.filter(s=>s.length>1))].sort((a,b)=>b.length-a.length).slice(0,120);if(!words.length)return esc(raw);const regex=new RegExp(words.map(w=>w.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|'),'giu');let out='',last=0;for(const m of raw.matchAll(regex)){out+=esc(raw.slice(last,m.index))+'<mark>'+esc(m[0])+'</mark>';last=m.index+m[0].length;}return out+esc(raw.slice(last));}
function renderChrome(){document.documentElement.lang=locale;$('#language').value=locale;const badge=$('#preview-badge');badge.textContent=isPreview()?t('preview'):'';badge.hidden=!isPreview();const {path,params}=route();
 const nav=(name,href,k,active=false)=>`<a class="nav-link ${active?'active':''}" href="${href}">${icon(k)}${t(name)}</a>`;
 $('#sidebar').innerHTML=`<nav class="primary-nav">${nav('home','/','home',path==='/')}${nav('search','/search','search',path==='/search')}${nav('mySpace','/me','user',path.startsWith('/me'))}<button type="button" class="nav-link nav-compose" data-action="compose">${icon('plus')}${t('newPost')}</button></nav><div class="sidebar-label">${t('spaces')}</div><nav class="secondary-nav">${nav('neck','/search?body_part=neck','neck',params.get('body_part')==='neck')}${nav('back','/search?body_part=lower-back','neck',params.get('body_part')==='lower-back')}${nav('stories','/search?category=patient-story','story',params.has('category'))}</nav>${state.user&&['admin','moderator'].includes(state.user.role)?`<div class="sidebar-label">${t('admin')}</div><nav>${nav('admin','/admin','shield',path==='/admin')}</nav>`:''}<div class="sidebar-note"><strong>${t('welcome')}</strong>${t('medical')}<p><a href="/privacy">${t('privacy')}</a></p></div>`;
 $('#account-actions').innerHTML=state.user?`<a href="/notifications" class="bell" aria-label="${t('notifications')}">${icon('bell')}${state.unread?`<span class="count">${state.unread>99?'99+':state.unread}</span>`:''}</a><details class="account-menu"><summary class="account-trigger" aria-label="${esc(t('mySpace'))}"><span class="avatar">${esc(state.user.nickname.slice(0,1))}</span><span class="nickname">${esc(state.user.nickname)}</span><span class="account-chevron" aria-hidden="true">▾</span></summary><div class="account-dropdown"><a href="/me">${t('mySpace')}</a><a href="/me?kind=settings">${t('settings')}</a><button type="button" data-action="reading-options">${esc(readingText('link'))}</button><button type="button" data-action="logout">${t('logout')}</button></div></details>`:button(t('login'),'login','','primary');
 $('#right-rail').innerHTML=`<div class="rail-panel"><div class="rail-caption">SPINE COMMUNITY</div><h3>${t('approach')}</h3><p>${t('approachBody')}</p>${['value1','value2','value3'].map(k=>`<div class="rail-line">${icon('check')}<span>${t(k)}</span></div>`).join('')}</div><div class="rail-panel accent">${icon('leaf')}<h3>${t('careTitle')}</h3><p>${t('careBody')}</p><a class="button" href="/privacy">${t('privacy')}</a></div>${isPreview()?`<p class="subtle">${t('previewOnly')}</p>`:''}`;
 $('#footer').innerHTML=`${t('medical')}<br><a href="/privacy">${t('privacy')}</a>${isPreview()?` · ${t('previewOnly')}`:''}`;
}
function empty(title='emptyTitle',message='emptyBody',action=true){return `<div class="panel empty">${icon('chat')}<h3>${t(title)}</h3><p>${t(message)}</p>${action?button(t('share')+' '+icon('arrow'),'compose','','primary'):''}</div>`;}
function errorPanel(e){return `<div class="panel empty">${icon('leaf')}<h3>${esc(errorText(e))}</h3>${e.status===503?`<p>${t('setup')}</p>`:''}${button(t('retry'),'retry')}</div>`;}
function tagHtml(terms){return `<div class="tags">${(terms||[]).map(term=>`<span class="tag ${esc(term.term_type)}">${esc(termName(term.id))}</span>`).join('')}</div>`;}
function translationLabel(state){
 return `${t('translation')} · ${t('translationCaution')} <button type="button" data-action="toggle-original">${t(state.original?'translated':'original')}</button>`;
}
function translationShell(type,c,scope='full',preview=false){
 const state=translations?.item(type,c,scope);
 if(!state)return '';
 return `<div class="translation-note" data-translation="${esc(state.key)}" data-preview="${preview}" ${state.result?'':'hidden'}>${state.result?translationLabel(state):''}</div>`;
}
function renderTranslation(node,state){
 const root=node.parentElement,id=CSS.escape(state.entry.id);
 const title=$(`[data-title="${id}"]`,root),body=$(`[data-body="${id}"]`,root);
 if(!('originalTitle' in node.dataset)){
  node.dataset.originalTitle=title?.innerHTML||'';
  node.dataset.originalBody=body?.innerHTML||'';
 }
 if(title)title.innerHTML=state.original?node.dataset.originalTitle:highlight(state.result.title);
 if(body){
  const translated=node.dataset.preview==='true'?[...state.result.body].slice(0,180).join(''):state.result.body;
  body.innerHTML=state.original?node.dataset.originalBody:highlight(translated);
 }
 node.hidden=false;
 const toggle=$('[data-action="toggle-original"]',node);
 if(toggle)toggle.textContent=t(state.original?'translated':'original');
 else node.innerHTML=translationLabel(state);
}
function translateVisible(n){
 if(n===sequence)translations?.observe($$('[data-translation]'));
}
function actions(c,type='topic'){const table=type==='topic'?'topics':'comments',attrs=`data-id="${esc(c.id)}" data-type="${type}"`;return `<div class="card-footer">${c.status==='published'?`<button class="text-action ${c.liked?'active':''}" data-action="like" ${attrs} data-active="${c.liked?'true':'false'}" aria-pressed="${c.liked?'true':'false'}">${icon('heart')}<span data-like-count>${c.like_count||0}</span></button>`:''}${type==='topic'?(c.status==='published'?`<button type="button" class="text-action" data-action="reply" ${attrs}>${icon('chat')}<span data-reply-count>${c.reply_count||0}</span> ${t('reply')}</button>`:`<a class="text-action" href="/topic/${esc(c.id)}">${icon('chat')}<span data-reply-count>${c.reply_count||0}</span> ${t('reply')}</a>`):''}${type==='comment'&&c.status==='published'?`<button class="text-action" data-action="reply" ${attrs}>${t('reply')}</button>`:''}${type==='topic'&&c.status==='published'?`<button class="text-action ${c.bookmarked?'active':''}" data-action="bookmark" ${attrs} data-active="${c.bookmarked?'true':'false'}" aria-pressed="${c.bookmarked?'true':'false'}">${icon('bookmark')}${t(c.bookmarked?'bookmarked':'bookmark')}</button>`:''}<span class="spacer"></span>${state.user?.id===c.author_id&&c.status!=='deleted'?`<button class="text-action" data-action="edit" ${attrs}>${t('edit')}</button><button class="text-action" data-action="delete" ${attrs}>${t('delete')}</button>${['blocked','hidden'].includes(c.status)?`<button class="text-action" data-action="appeal" ${attrs}>${t('appeal')}</button>`:''}`:''}${c.status==='published'?`<button class="text-action" data-action="report" ${attrs}>${t('report')}</button>`:''}</div>`;}
function displayAuthor(c){return c?.nickname==='未知用户'&&(c.author_id===undefined||c.author_id==='system-unknown-import')?'Anonymous':c?.nickname||'?';}
function authorLink(c){const name=esc(displayAuthor(c));return c?.author_id&&c.author_id!=='system-unknown-import'?`<a class="author-link" href="/users/${encodeURIComponent(c.author_id)}">${name}</a>`:name;}
function topicCard(c){const deleted=c.status==='deleted';return `<article class="topic-card" data-topic="${esc(c.id)}"><div class="topic-card-main" data-topic-open="${esc(c.id)}"><div class="topic-meta"><span class="avatar">${esc(displayAuthor(c).slice(0,1))}</span><span>${authorLink(c)}</span><span>·</span><time>${date(c.created_at)}</time><span>· ${esc(c.source_lang)}</span>${c.public_region?`<span>· ${esc(c.public_region)}</span>`:''}${statusHtml(c.status)}</div><h3><a href="/topic/${esc(c.id)}" data-title="${esc(c.id)}">${deleted?t('deletedTopic'):highlight(c.title)}</a></h3>${deleted?'':`<p class="summary" data-body="${esc(c.id)}">${highlight(cardPreview(c))}</p>`}${translationShell('topic',c,'summary')}${tagHtml(c.terms)}${c.relaxed?.length?`<div class="subtle">${t('relaxed')}: ${c.relaxed.map(k=>t(k)).join(', ')}</div>`:''}</div>${actions(c)}</article>`;}
function searchForm(params){const options=(type)=>state.terms.filter(x=>x.term_type===type).map(x=>`<option value="${esc(x.id)}" ${params.get(type)===x.id?'selected':''}>${esc(x.label)}</option>`).join('');return `<form id="search-form" class="search-card"><div class="search-field">${icon('search')}<input name="q" aria-label="${t('search')}" placeholder="${t('searchPlaceholder')}" maxlength="120" value="${esc(params.get('q')||'')}"><button class="button primary" type="submit">${t('searchButton')}</button></div><div class="filter-grid">${['body_part','symptom','duration','treatment'].map(k=>`<label>${t(k)}<select name="${k}"><option value="">${t('any')}</option>${k==='duration'?['acute','subacute','chronic'].map(v=>`<option value="${v}" ${params.get(k)===v?'selected':''}>${t(v)}</option>`).join(''):options(k)}</select></label>`).join('')}</div></form>`;}
async function showFeed(n,params,isSearch,force){const query=feedParams(params,isSearch);state.next=null;state.feed=[];state.highlights=[];$('#main').innerHTML=`${isSearch?searchForm(query):''}<div class="feed-heading"><h2>${t(isSearch?'search':'latest')}</h2><select id="sort" aria-label="${t('relevant')}">${['relevant','latest','discussion'].map(v=>`<option value="${v}" ${query.get('sort')===v?'selected':''}>${t(v==='latest'?'newest':v)}</option>`).join('')}</select></div><div id="feed"><div class="loading"><span class="spinner"></span></div></div><div id="load-area"></div>`;
 try{const data=await (isSearch||force?api('/api/topics?'+query):publicReads().feed(query));if(n!==sequence)return;translations.markPage(data);await translations.prime(data.topics.slice(0,4).map(row=>['topic',row,'summary']));if(n!==sequence)return;state.feed=data.topics;state.feedVersion=data.projectionVersion||null;state.highlights=data.highlights;state.next=data.next;$('#feed').innerHTML=`${data.similar?`<div class="notice">${t('similar')}</div>`:''}${data.topics.length?data.topics.map(topicCard).join(''):empty(isSearch?'noResults':'emptyTitle')}`;loadButton();translateVisible(n);}catch(e){if(n===sequence)$('#feed').innerHTML=errorPanel(e);}}
function loadButton(){const target=$('#load-area');if(!target)return;target.innerHTML=state.next!==null?button(t('loadMore'),'load-more','','load-more'):'';observer?.disconnect();if(state.next!==null){observer=new IntersectionObserver(entries=>{if(entries[0].isIntersecting)loadMore().catch(e=>toast(errorText(e)));},{rootMargin:'100px'});observer.observe(target);}}
let moreLoading=false;
async function loadMore(){if(state.next===null||moreLoading)return;moreLoading=true;observer?.disconnect();try{const current=route();const p=feedParams(current.params,current.path==='/search');p.set('offset',state.next);const n=sequence,data=await (current.path==='/search'?api('/api/topics?'+p):publicReads().feed(p,state.feedVersion));if(n!==sequence)return;translations.markPage(data);await translations.prime(data.topics.slice(0,4).map(row=>['topic',row,'summary']));if(n!==sequence)return;state.feedVersion=data.projectionVersion||null;if(data.resetFeed){state.feed=[];$('#feed').replaceChildren();}const seen=new Set(state.feed.map(item=>item.id));const added=data.topics.filter(item=>!seen.has(item.id));state.feed.push(...added);state.next=data.next;$('#feed').insertAdjacentHTML('beforeend',added.map(topicCard).join(''));loadButton();translateVisible(n);}finally{moreLoading=false;}}
function composer(c=null){if(!needUser())return;const selected=new Set((c?.terms||[]).map(x=>x.id));modal(`<h2>${t(c?'edit':'share')}</h2><form id="compose-form" class="form-grid" data-id="${esc(c?.id||'')}"><label>${t('title')}<input name="title" required maxlength="200" value="${esc(c?.title||'')}"></label><label>${t('body')}<textarea name="body" required maxlength="30000">${esc(c?.body||'')}</textarea></label>${sourceFields(c)}<details><summary>${t('spaces')} / ${t('symptom')} / ${t('treatment')} · ${t('optional')}</summary><div>${state.terms.map(term=>`<label class="check"><input type="checkbox" name="terms" value="${esc(term.id)}" ${selected.has(term.id)?'checked':''}>${esc(term.label)}</label>`).join('')}</div><label>${t('durationDays')} · ${t('optional')}<input type="number" name="symptom_duration_days" min="0" max="36500" value="${c?.symptom_duration_days??''}"></label></details><div class="notice">${t('publicNote')} ${t('translationPrivacy')}</div><button class="button" type="button" disabled>${icon('plus')}${t('imagesOff')}</button><div class="form-actions">${button(t('cancel'),'close-modal')}<button class="button primary" type="submit">${t(c?'save':'publish')}</button></div></form>`);}
function languageOptions(selected,includeOther=true){return [...languages,...(includeOther?['und']:[])].map(l=>`<option value="${l}" ${l===selected?'selected':''}>${l==='und'?t('otherLanguage'):l==='zh-CN'?'简体中文':l==='zh-TW'?'繁體中文':new Intl.DisplayNames([locale],{type:'language'}).of(l)}</option>`).join('');}
function sourceFields(c){
 const preferred=postingLanguage(state.user,locale,languages);
 const suggested=preferred==='zh-CN'?'简体中文':preferred==='zh-TW'?'繁體中文':new Intl.DisplayNames([locale],{type:'language'}).of(preferred);
 const manual=c?.source_lang_mode==='manual'?c.source_lang:null;
 // Preserve an existing manual language outside the common choices when editing.
 const saved=manual&&manual!=='und'&&!languages.includes(manual)
  ?`<option value="${esc(manual)}" selected>${esc(new Intl.DisplayNames([locale],{type:'language'}).of(manual)||manual)}</option>`:'';
 return `<label>${t('sourceLanguage')}<select name="source_lang"><option value="auto" ${manual?'':'selected'}>${t('detectLanguage')} · ${esc(suggested)}</option>${languageOptions(manual)}${saved}</select></label>`;
}
function sourcePayload(fields){
 const label=fields.source_lang;
 return label==='auto'||!label?{source_lang_mode:'auto'}:
  {source_lang_mode:'manual',source_lang:label};
}
async function showTopic(n,topicId,params,force){$('#main').innerHTML='<div class="loading"><span class="spinner"></span></div>';try{const p=new URLSearchParams();if(params.get('comment'))p.set('focus',params.get('comment'));if(params.get('progress'))p.set('progress','1');const data=await (force?api('/api/topics/'+encodeURIComponent(topicId)+'?'+p):publicReads().topic(topicId,p));if(n!==sequence)return;translations.markPage(data);await translations.prime([['topic',data.topic],...data.progress.map(row=>['comment',row,'preview']),...data.comments.slice(0,4).map(row=>['comment',row])]);if(n!==sequence)return;state.topicVersion=data.projectionVersion||null;state.commentPage=1;state.topic=data.topic;state.comments=data.comments;state.progress=data.progress;state.commentNext=data.next;renderTopic(data.progress);translateVisible(n);if(params.get('comment'))setTimeout(()=>n===sequence&&$('[data-comment="'+CSS.escape(params.get('comment'))+'"]')?.scrollIntoView({block:'center'}),150);}catch(e){if(n===sequence)$('#main').innerHTML=errorPanel(e);}}
function commentHtml(c){let depth=0,parent=c.parent_comment_id,seen=new Set();while(parent&&!seen.has(parent)){seen.add(parent);depth++;parent=state.comments.find(x=>x.id===parent)?.parent_comment_id;}return `<article class="comment ${depth?'nested':''}" class-depth="${Math.min(depth,4)}" id="comment-${esc(c.id)}" data-comment="${esc(c.id)}"><div class="topic-meta"><span class="avatar">${esc(displayAuthor(c).slice(0,1))}</span><strong>${authorLink(c)}</strong><time>${date(c.created_at)}</time>${c.kind==='progress'?`<span class="tag">${t('progress')} #${c.progress_seq}</span>`:''}${c.parent_comment_id?`<a href="/topic/${esc(c.topic_id)}?comment=${esc(c.parent_comment_id)}">↳ ${t('reply')}</a>`:''}${statusHtml(c.status)}</div><div class="prose ${c.status==='deleted'?'deleted':''}" data-body="${esc(c.id)}">${c.status==='deleted'?t('deletedComment'):esc(c.body)}</div>${translationShell('comment',c)}${actions(c,'comment')}</article>`;}
function renderTopic(progress=[]){const c=state.topic,deleted=c.status==='deleted';$('#main').innerHTML=`<a href="${esc(topicListEntry()?.entry.url||'/')}" class="back-link" data-action="back-to-list">← ${t('backLink')}</a><article class="panel"><div class="topic-meta"><span class="avatar">${esc(displayAuthor(c).slice(0,1))}</span><strong>${authorLink(c)}</strong><time>${date(c.created_at)}</time><span>${esc(c.source_lang)}</span>${c.public_region?`<span>${esc(c.public_region)}</span>`:''}${statusHtml(c.status)}</div><h1 class="article-title ${deleted?'deleted':''}" data-title="${esc(c.id)}">${deleted?t('deletedTopic'):esc(c.title)}</h1>${tagHtml(c.terms)}<div class="prose" data-body="${esc(c.id)}">${deleted?'':esc(c.body)}</div>${translationShell('topic',c)}${actions(c)}${c.status==='published'?`<div class="stack">${button(icon('follow')+t(c.followed?'followed':'follow'),'follow',`data-id="${esc(c.id)}" data-type="topic" data-active="${c.followed?'true':'false'}" aria-pressed="${c.followed?'true':'false'}"`,c.followed?'active':'')}${state.user?.id===c.author_id?button(icon('plus')+t('update'),'progress','','primary'):''}</div>`:''}${progress.length?`<section class="progress-panel"><h3>${t('progress')}</h3>${progress.map(p=>progressItem(c.id,p)).join('')}<a href="/topic/${esc(c.id)}?progress=1" class="subtle">${t('allProgress')} →</a></section>`:''}${c.status==='published'?`<div class="topic-share-row">${button(icon('share')+t('sharePost'),'share-topic',`data-id="${esc(c.id)}"`,'small')}</div>`:''}</article><div class="feed-heading"><h2>${t('comments')} <span class="subtle" data-reply-count>${c.reply_count}</span></h2>${route().params.get('progress')?`<a href="/topic/${esc(c.id)}">${t('comments')}</a>`:''}</div><section class="panel" id="comments">${state.comments.length?state.comments.map(commentHtml).join(''):`<p class="subtle empty-comments">${t('emptyList')}</p>`}</section>${state.commentNext?button(t('loadMore'),'load-comments','','load-more'):''}${c.status==='published'?`<section class="panel">${state.user?`<form id="root-reply" class="form-grid"><label>${t('reply')}<textarea class="short" name="body" required maxlength="12000" placeholder="${t('commentPlaceholder')}"></textarea></label>${sourceFields()}<small>${t('publicNote')} ${t('translationPrivacy')}</small><div class="form-actions"><button class="button primary" type="submit">${t('reply')}</button></div></form>`:`<p class="subtle">${t('loginNote')}</p>${button(t('google'),'login','','primary')}`}</section>`:''}`;}
function progressItem(topicId,p){
 return `<div class="progress-item"><a href="/topic/${esc(topicId)}?comment=${esc(p.id)}">${t('update')} #${p.progress_seq} · ${date(p.created_at)}</a><span data-body="${esc(p.id)}">${esc([...p.body].slice(0,180).join(''))}</span>${translationShell('comment',p,'preview',true)}</div>`;
}
function updateProgressPanel(){
 const current=$('.progress-panel');
 if(!state.progress?.length){current?.remove();return;}
 const topicId=esc(state.topic.id),html=`<section class="progress-panel"><h3>${t('progress')}</h3>${state.progress.map(p=>progressItem(state.topic.id,p)).join('')}<a href="/topic/${topicId}?progress=1" class="subtle">${t('allProgress')} →</a></section>`;
 if(current)current.outerHTML=html;else {const article=$('#main > article.panel'),share=$('.topic-share-row',article);if(share)share.insertAdjacentHTML('beforebegin',html);else article?.insertAdjacentHTML('beforeend',html);}
}
function updateReplyUI(result,editing=false){
 const {comment,insert}=applyReplyResult(state,result,editing),section=$('#comments');
 if(!section)throw new Error('comments_not_loaded');
 const selector=`[data-comment="${CSS.escape(comment.id)}"]`;
 const existing=$(selector,section);
 if(existing)existing.outerHTML=commentHtml(comment);
 else{if(insert)$('.empty-comments',section)?.remove();section.insertAdjacentHTML('beforeend',commentHtml(comment));}
 $$('[data-reply-count]').forEach(node=>node.textContent=String(state.topic.reply_count));
 if(comment.kind==='progress')updateProgressPanel();
 const node=$(selector,section);
 if(node){node.classList.add('just-posted');node.tabIndex=-1;const generation=sequence;
  setTimeout(()=>{if(sequence!==generation||!node.isConnected)return;node.focus({preventScroll:true});node.scrollIntoView({behavior:'smooth',block:'center'});},100);
  setTimeout(()=>{if(node.isConnected)node.classList.remove('just-posted');},4500);
 }
 translateVisible(sequence);
}
function replyModal(c=null,kind='regular',editing=false,topicId=null){if(!needUser())return;modal(`<h2>${t(editing?'edit':kind==='progress'?'update':'reply')}</h2><form id="reply-form" class="form-grid" data-id="${esc(c?.id||'')}" data-topic-id="${esc(topicId||c?.topic_id||'')}" data-kind="${kind}" data-edit="${editing}"><label>${t('body')}<textarea name="body" required maxlength="12000">${editing?esc(c.body):''}</textarea></label>${sourceFields(editing?c:null)}<div class="notice">${t('publicNote')} ${t('translationPrivacy')}</div><div class="form-actions">${button(t('cancel'),'close-modal')}<button type="submit" class="button primary">${t(editing?'save':'publish')}</button></div></form>`);}
async function showMe(n,params){if(!state.user){$('#main').innerHTML=`<div class="profile-title"><h1 class="page-title">${t('mySpace')}</h1></div>${readingSettingsCard()}${empty('login','loginNote',false)}${button(t('google'),'login','','primary')}`;return;}const kind=params.get('kind')||'topics';const tabs=[['topics','myTopics'],['comments','myComments'],['bookmarks','myBookmarks'],['follows','myFollows'],['settings','settings']];$('#main').innerHTML=`<div class="profile-title"><h1 class="page-title">${t('mySpace')}</h1>${button(t('logout'),'logout','','logout-link')}</div>${readingSettingsCard()}<nav class="tabs">${tabs.map(([v,k])=>`<a class="button ${kind===v?'active':''}" href="/me?kind=${v}">${t(k)}</a>`).join('')}</nav><div id="my-content"><div class="loading"><span class="spinner"></span></div></div>`;
 if(kind==='settings'){const u=state.user;$('#my-content').innerHTML=`<section class="panel"><form id="profile-form" class="form-grid"><label>${t('nickname')}<input required name="nickname" maxlength="80" value="${esc(u.nickname)}"></label><label>${t('postingLanguage')}<select name="preferred_locale">${profilePostingLanguageOptions(u,locale,languages,t,languageOptions)}</select></label><label>${t('region')}<input name="public_region" maxlength="80" value="${esc(u.public_region||'')}"></label><div><button class="button primary" type="submit">${t('save')}</button></div></form></section><section class="panel"><h3>${t('settings')}</h3><p class="subtle">${t(isPreview()?'requestNote':'requestNoteProduction')}</p><div class="stack">${button(t('privacyRequest'),'privacy-request')}${button(t('logout'),'logout')}</div><div id="privacy-history"></div></section>`;const p=await api('/api/privacy-requests');if(n===sequence)$('#privacy-history').innerHTML=p.items.map(p=>`<p class="subtle">${t(p.request_type)} · ${esc(p.status)} · ${date(p.requested_at)}</p>`).join('');return;}
 try{const data=await api('/api/me/content?kind='+encodeURIComponent(kind));if(n!==sequence)return;$('#my-content').innerHTML=data.items.length?data.items.map(c=>kind==='comments'?`<article class="topic-card"><a href="/topic/${esc(c.topic_id)}?comment=${esc(c.id)}">${date(c.created_at)} · ${t('reply')}</a>${statusHtml(c.status)}<p class="prose">${c.status==='deleted'?t('deletedComment'):esc(c.body)}</p>${actions(c,'comment')}</article>`:topicCard(c)).join(''):empty('emptyList','emptyBody');state.feed=data.items;state.meNext=data.next;if(data.next!==null)$('#my-content').insertAdjacentHTML('beforeend',button(t('loadMore'),'load-mine','','load-more'));translateVisible(n);}catch(e){if(n===sequence)$('#my-content').innerHTML=errorPanel(e);}}
async function showContributor(n,id,params){
 $('#main').innerHTML='<div class="loading"><span class="spinner"></span></div>';
 const kind=params.get('kind')==='comments'?'comments':'topics';
 try{
  const data=await api('/api/users/'+encodeURIComponent(id)+'?kind='+kind);
  if(n!==sequence)return;
  await translations.prime(data.items.slice(0,4).map(row=>[kind==='topics'?'topic':'comment',row,kind==='topics'?'summary':'full']));
  if(n!==sequence)return;
  state.contributorNext=data.next;
  state.contributorId=data.user.id;
  $('#main').innerHTML=renderContributorProfile(data,t,esc,date,translationShell);
  translateVisible(n);
 }catch(e){if(n===sequence)$('#main').innerHTML=errorPanel(e);}
}
async function showNotifications(n){if(!needUser()){$('#main').innerHTML=empty('login','loginNote',false);return;}const data=await api('/api/notifications');if(n!==sequence)return;state.notificationItems=data.items;state.unread=data.unread;renderChrome();$('#main').innerHTML=`<div class="feed-heading"><h1 class="page-title">${t('notifications')}</h1>${button(t('markAll'),'read-all','','small')}</div><div class="panel">${data.items.length?data.items.map((item,i)=>`<article class="notification ${item.unread?'unread':''}">${icon(item.event_type.endsWith('_like')?'heart':item.event_type==='progress_update'?'follow':'chat')}<div><a data-action="read-notification" data-index="${i}" href="/topic/${esc(item.topic_id)}${item.comment_id?'?comment='+esc(item.comment_id):''}">${esc(item.count>1?item.count+' '+t('people'):item.actor_name||'Member')} ${t(item.event_type)}</a><small>${date(item.created_at)}</small></div></article>`).join(''):`<p class="subtle">${t('noNotifications')}</p>`}</div>`;}
async function showAdmin(n,params){if(!state.user||!['admin','moderator'].includes(state.user.role)){ $('#main').innerHTML=errorPanel({status:403});return;}
 const tab=params.get('tab')||'moderation';const tabs=['moderation','reports','users','analytics','logs',...(state.user.role==='admin'?['taxonomy','settings','translationProviders','languageReview','publicProjection']:[])];
 $('#main').innerHTML=`<h1 class="page-title">${t('admin')}</h1><nav class="tabs">${tabs.map(v=>`<a href="/admin?tab=${v}" class="button ${v===tab?'active':''}">${v==='publicProjection'?(['zh-CN','zh-TW'].includes(locale)?'D1 / R2 一致性':'D1 / R2 consistency'):t(v)}</a>`).join('')}</nav><section class="panel" id="admin-content"><div class="loading"><span class="spinner"></span></div></section>`;
 if(tab==='languageReview'&&state.user.role==='admin'){
  await renderLanguageReview($('#admin-content'),api,esc,locale,isPreview());
  return;
 }
 if(tab==='translationProviders'&&state.user.role==='admin'){
  await renderTranslationAdmin($('#admin-content'),api,esc,locale);
  return;
 }
 if(tab==='publicProjection'&&state.user.role==='admin'){
  const target=$('#admin-content');
  await renderProjectionAdmin(target,api,esc,locale,params.get('after'));
  return;
 }
 const analyticsTab=tab==='analytics';
 const selectedDays=params.get('days')==='30'?30:7;
 const selectedRank=['topics','comments','total'].includes(params.get('rank'))?params.get('rank'):'topics';
 const data=await api('/api/admin/overview?days='+(analyticsTab?'30':selectedDays)+(analyticsTab?'&rank='+selectedRank:''));
 if(n!==sequence)return;
 state.admin=data;
 if(analyticsTab)state.analyticsDays=selectedDays;

 const adminAction=(label,endpoint,payload,kind='')=>button(t(label),'admin-action',`data-endpoint="${endpoint}" data-payload="${esc(JSON.stringify(payload))}"`,kind+' small');
 let html='';
 if(tab==='moderation')html=data.queue.map(c=>`<div class="admin-row"><strong>${esc(c.title||c.type)}</strong> ${statusHtml(c.status)}<p>${esc(c.body?.slice(0,1500))}</p><div>${adminAction('approve','content',{type:c.type,id:c.id,action:'publish'})}${adminAction('hide','content',{type:c.type,id:c.id,action:'hide'})}${state.user.role==='admin'?adminAction('delete','content',{type:c.type,id:c.id,action:'delete'},'danger'):''}</div></div>`).join('');
 if(tab==='reports')html=[...data.reports.map(r=>({...r,type:'report'})),...data.appeals.map(r=>({...r,type:'appeal'}))].map(r=>`<div class="admin-row"><strong>${t(r.type==='report'?'report':'appeal')}: ${esc(r.reason)}</strong><p>${esc(r.preview||r.detail||'')}</p>${r.topic_id?`<a href="/topic/${esc(r.topic_id)}">${t('comments')} →</a>`:''}${r.topic_id||r.comment_id?adminAction('hide','content',{type:r.comment_id?'comment':'topic',id:r.comment_id||r.topic_id,action:'hide'}):''}${adminAction('resolve','resolve',{type:r.type,id:r.id,status:'resolved'})}${adminAction('reject','resolve',{type:r.type,id:r.id,status:'rejected'})}</div>`).join('');
 if(tab==='users')html=`${data.users.map(u=>`<div class="admin-row"><strong>${esc(u.nickname)}</strong> · ${esc(u.role)}<small class="subtle"> · ${esc(u.id)}</small><div>${[1,3,7,30].map(days=>adminAction('mute','sanctions',{user_id:u.id,action:'mute',days})).map((s,i)=>s.replace(t('mute'),t('mute')+' '+[1,3,7,30][i]+'d')).join('')}${state.user.role==='admin'?adminAction('ban','sanctions',{user_id:u.id,action:'ban'},'danger')+adminAction(u.role.includes('moderator')?'revoke':'grant','roles',{user_id:u.id,enabled:!u.role.includes('moderator')}):''}</div></div>`).join('')}${data.sanctions.map(s=>`<div class="admin-row">${esc(s.nickname)} · ${esc(s.sanction_type)} · ${esc(s.reason)} ${s.ends_at?date(s.ends_at):''}${adminAction('lift','sanctions',{user_id:s.user_id,sanction_id:s.id,action:'lift'})}</div>`).join('')}`;
 if(tab==='analytics'){const enabled=data.analyticsEnabled===true;const controls=`<div class="admin-row" id="traffic-controls"><strong>${t('analyticsToggle')}</strong><p class="subtle" data-analytics-status>${t(enabled?'analyticsOn':'analyticsOff')}</p>${state.user.role==='admin'?`<button type="button" class="button ${enabled?'':'primary'}" data-action="toggle-analytics" data-enabled="${enabled}" aria-pressed="${enabled}">${t(enabled?'analyticsDisable':'analyticsEnable')}</button>`:''}</div>`;html=controls+renderContentStats({...data,days:selectedDays,metrics:data.metrics.slice(0,selectedDays)},t,esc);}
 if(tab==='logs')html=data.logs.map(r=>`<div class="admin-row"><strong>${esc(r.actor_name)} · ${esc(r.action)}</strong><p>${esc(r.target_type)} / ${esc(r.target_id)}<br>${esc(r.reason)}</p><small>${date(r.created_at)}</small></div>`).join('');
 if(tab==='taxonomy')html=button(t('addTerm'),'add-term','','primary')+state.terms.map(term=>`<div class="admin-row">${esc(term.label)} · ${esc(term.term_type)} ${button(t('edit'),'edit-term',`data-id="${esc(term.id)}"`,'small')}</div>`).join('');
 if(tab==='settings')html=`<p class="subtle">${t('translation')} · ${esc(data.settings.find(s=>s.key==='translation_enabled')?.value||'false')}</p><p class="subtle">${t('translationFallback')}</p>${button(t('privacy'),'privacy')}<h3>${t('privacyRequest')}</h3>${data.privacy.map(p=>`<div class="admin-row"><strong>${esc(p.nickname)}</strong> · ${t(p.request_type)}<p>${esc(p.status)} · ${date(p.requested_at)}</p>${adminAction('resolve','privacy',{id:p.id,status:p.request_type==='data_export'?'resolved':'fulfill'})}${adminAction('reject','privacy',{id:p.id,status:'rejected'})}</div>`).join('')||`<p class="subtle">${t('emptyList')}</p>`}`;
 $('#admin-content').innerHTML=html||`<p class="subtle">${t('emptyList')}</p>`;
}
async function render(force=false,restore=false){const n=++sequence;renderedListEntry=null;observer?.disconnect();translations?.close();
 const view=translationView(locale,{configured:state.health?.translationConfigured,hasCache:state.health?.translationCacheAvailable,
  direct:state.health?.publicContent?.directTranslations,
  request:(payload,signal)=>api('/api/translate',{method:'POST',body:JSON.stringify(payload),signal}),render:renderTranslation,
  onStale:()=>{if(translations===view)void render(true);}});
 translations=view;
 state.topic=null;renderChrome();const {path,params}=route();
 if(restore&&restoreListView(n))return;
 try{
 if(path==='/'||path==='/search')await showFeed(n,params,path==='/search',force);
 else if(path.startsWith('/topic/'))await showTopic(n,decodeURIComponent(path.slice(7)),params,force);
 else if(path==='/me')await showMe(n,params);
 else if(path.startsWith('/users/'))await showContributor(n,decodeURIComponent(path.slice(7)),params);
 else if(path==='/notifications')await showNotifications(n);
 else if(path==='/admin')await showAdmin(n,params);
 else if(path==='/privacy')$('#main').innerHTML=`<h1 class="page-title">${t('privacy')}</h1><section class="panel privacy-copy">${isPreview()?`<h3>${t('previewOnly')}</h3>`:''}<p>${t(isPreview()?'privacyText':'privacyProduction')}</p><p>${t('translationPrivacy')}</p><div class="notice info">${t('medical')}</div></section>`;
 else $('#main').innerHTML=empty('notFound','emptyBody',false);
 }catch(e){if(n===sequence)$('#main').innerHTML=errorPanel(e);}
 if(n===sequence&&(path==='/'||path==='/search'||path==='/me'||path.startsWith('/users/')))renderedListEntry=navigationEntry.key;
 if(n===sequence&&state.health?.analyticsEnabled===true)send('/api/pageview',{path:location.pathname}).catch(()=>{});
}
function findContent(type,id){return type==='topic'?(state.topic?.id===id?state.topic:state.feed.find(c=>c.id===id)):state.comments.find(c=>c.id===id)||state.feed.find(c=>c.id===id);}
async function refreshMe(){const me=await api('/api/me');state.user=me.user;state.google=me.googleConfigured;}
async function refreshUnread(){if(!state.user)return;try{const r=await api('/api/notifications');state.unread=r.unread;renderChrome();}catch{}}
function rememberAnalyticsFilters(){
 const url=new URL(location.href);
 url.searchParams.set('tab','analytics');
 url.searchParams.set('days',String(state.analyticsDays));
 url.searchParams.set('rank',state.admin?.contributorSort||'topics');
 history.replaceState(history.state,'',url.pathname+url.search+url.hash);
}
async function clicked(el,event){const action=el.dataset.action,{id,type,active}=el.dataset;
 if(action==='back-to-list'){if(event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||event.button!==0)return;event.preventDefault();return returnToList();}
 if(action==='share-topic')return showShareTopic(findContent('topic',id));
 if(action==='share-copy'||action==='share-app-copy'){
  const input=$('#share-url');if(!input)return;
  try{
   if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(input.value);
   else{input.focus();input.select();if(!document.execCommand('copy'))throw new Error('copy failed');}
   closeModal();toast(action==='share-app-copy'?t('shareAppCopied').replace('{app}',sharePlatformName(el.dataset.platform)):t('linkCopied'));
  }catch{input.focus();input.select();toast(t('shareCopyError'));}
  return;
 }
 if(action==='share-native'){
  const input=$('#share-url');if(!input||typeof navigator.share!=='function')return;
  try{await navigator.share({title:state.topic?.title||'Spine Community',url:input.value});closeModal();}
  catch(e){if(e?.name!=='AbortError')toast(t('shareSystemError'));}
  return;
 }
 if(action==='login')return showLogin();
 if(action==='reading-options')return showReadingSettings();
 if(action==='reading-reset'){readingPreferences=saveReadingPreferences(readingStorage,document.documentElement,defaultReadingPreferences);return showReadingSettings();}if(action==='close-modal')return closeModal();if(action==='retry')return render();if(action==='compose')return composer();if(action==='privacy'){return navigate('/privacy');}
 if(action==='load-more')return loadMore();
 if(action==='historical-language-scan'||action==='historical-language-apply'){
  if(!isPreview()||state.user?.role!=='admin'||!['topic','comment'].includes(type))
   throw new Error('preview_only');
  const after=historicalLanguageAfter[type];
  const area=$('#historical-language-status');
  if(after===null){
   if(area)area.textContent=locale.startsWith('zh')?'已处理完本轮候选。其余未确定记录继续等待人工复核。':'This scan has reached the end; unresolved provisional items remain for manual review.';
   return;
  }
  if(action==='historical-language-scan'){
   const result=await api('/api/admin/historical-language-backfill?type='+type+'&after='+encodeURIComponent(after));
   const confident=result.items.filter(item=>item.verified).length;
   const provisional=result.items.length-confident;
   if(area)area.textContent=(locale.startsWith('zh')?'下一批候选：':'Next candidate batch: ')+result.items.length+
    (locale.startsWith('zh')?'条；可确认：':' items; detected: ')+confident+
    (locale.startsWith('zh')?'，待复核：':' , provisional: ')+provisional+'.';
   return;
  }
  if(!window.confirm(locale.startsWith('zh')
    ?'确认只在开发预览库自动处理最多20条历史内容？不会写生产数据库，且临时语言仍需复核。'
    :'Process up to 20 historical items in preview D1 only? Provisional languages remain pending review.'))return;
  const result=await send('/api/admin/historical-language-backfill',{
   type,after,preview_confirm:'spine-community-db-preview'
  });
  historicalLanguageAfter[type]=result.next;
  await renderLanguageReview($('#admin-content'),api,esc,locale,isPreview());
  const current=$('#historical-language-status');
  if(current)current.textContent=(locale.startsWith('zh')?'本批自动更新：':'Updated in preview: ')+result.updated+
   (locale.startsWith('zh')?'条；已确认语言：':' items; verified: ')+result.detected+
   (locale.startsWith('zh')?'，临时值：':' , provisional values: ')+result.defaulted+
   (locale.startsWith('zh')?'，保留旧临时值：':' , kept provisional: ')+result.alreadyProvisional+'.';
  return;
 }
 if(action.startsWith('projection-')){
  const target=$('#admin-content');
  await projectionAdminAction(el,target,send,locale);
  if(target.isConnected)await renderProjectionAdmin(target,api,esc,locale);
  return;
 }
 if(['like','bookmark','follow'].includes(action)){if(!needUser())return;const plural=type==='comment'?'comments':'topics';const result=await api(`/api/${plural}/${encodeURIComponent(id)}/${action}`,{method:active==='true'?'DELETE':'PUT'});applyInteractionResult(state,action,type,id,result,$$('[data-action]'),icon,t);if(!result.active&&type==='topic'&&route().path==='/me'&&((action==='bookmark'&&route().params.get('kind')==='bookmarks')||(action==='follow'&&route().params.get('kind')==='follows'))){const area=$('#my-content'),card=$$('[data-topic]',area).find(node=>node.dataset.topic===id);card?.remove();state.feed=state.feed.filter(item=>item.id!==id);if(!state.feed.length&&state.meNext===null)area.innerHTML=empty('emptyList','emptyBody');}if(action!=='like')toast(t('success'));return;}
 if(action==='reply')return type==='topic'?replyModal(null,'regular',false,id):replyModal(findContent('comment',id));if(action==='progress')return replyModal(null,'progress');
 if(action==='edit'){if(!needUser())return;let c=findContent(type,id);if(type==='topic'){if(!c?.body)c=(await api('/api/topics/'+encodeURIComponent(id))).topic;composer(c);}else replyModal(c,c.kind,true);return;}
 if(action==='delete'){if(!needUser())return;modal(`<h2>${t('delete')}</h2><p>${t('confirmDelete')}</p><div class="form-actions">${button(t('cancel'),'close-modal')}${button(t('delete'),'confirm-delete',`data-id="${esc(id)}" data-type="${type}"`,'danger')}</div>`);return;}
 if(action==='confirm-delete'){await api(`/api/${type==='comment'?'comments':'topics'}/${encodeURIComponent(id)}`,{method:'DELETE'});closeModal();await render();return;}
 if(action==='report'||action==='appeal'){if(!needUser())return;modal(`<h2>${t(action)}</h2><form class="form-grid" id="report-form" data-id="${esc(id)}" data-type="${type}" data-kind="${action}"><label>${t('reason')}<textarea class="short" name="reason" required maxlength="${action==='appeal'?2000:120}"></textarea></label>${action==='report'?`<label>${t('detail')} · ${t('optional')}<textarea class="short" name="detail" maxlength="2000"></textarea></label>`:''}<div class="form-actions"><button class="button primary">${t('submit')}</button></div></form>`);return;}
 if(action==='logout'){await send('/api/auth/logout',{});state.user=null;state.unread=0;state.notificationItems=[];for(const saved of listViews.values())saved.translations?.close();listViews.clear();history.replaceState(null,'','/');await render();return;}
 if(action==='privacy-request'){modal(`<h2>${t('privacyRequest')}</h2><p>${t('requestNote')}</p><form id="privacy-form" class="form-grid"><label>${t('requestType')}<select name="type">${['account_delete','personal_data_delete','data_export'].map(k=>`<option value="${k}">${t(k)}</option>`).join('')}</select></label><button class="button primary">${t('submit')}</button></form>`);return;}
 if(action==='read-all'){await send('/api/notifications/read',{all:true});state.unread=0;await render();return;}
 if(action==='read-notification'){event.preventDefault();const item=state.notificationItems[Number(el.dataset.index)];await send('/api/notifications/read',{ids:item.ids});navigate(el.getAttribute('href'));refreshUnread();return;}
 if(action==='load-comments'){const n=sequence,p=new URLSearchParams({before:state.commentNext});if(route().params.get('progress'))p.set('progress','1');const data=await publicReads().topic(state.topic.id,p,state.commentPage+1,state.topicVersion);if(n!==sequence)return;translations.markPage(data);await translations.prime(data.comments.slice(0,4).map(row=>['comment',row]));if(n!==sequence)return;state.commentPage++;state.topicVersion=data.projectionVersion||null;if(data.topic)state.topic=data.topic;const existing=new Set(state.comments.map(c=>c.id));state.comments.push(...data.comments.filter(c=>!existing.has(c.id)));state.commentNext=data.next;if(data.progress)state.progress=data.progress;renderTopic(state.progress);translateVisible(n);return;}
 if(action==='load-contributor'){
   if(state.contributorNext===null)return;
   const id=state.contributorId,n=sequence,kind=route().params.get('kind')==='comments'?'comments':'topics';
   const data=await api('/api/users/'+encodeURIComponent(id)+'?kind='+kind+'&offset='+state.contributorNext);
   if(n!==sequence||state.contributorId!==id)return;
   await translations.prime(data.items.slice(0,4).map(row=>[kind==='topics'?'topic':'comment',row,kind==='topics'?'summary':'full']));
   if(n!==sequence||state.contributorId!==id)return;
   state.contributorNext=data.next;
   $('#contributor-items')?.insertAdjacentHTML('beforeend',renderContributorItems(data.items,kind,t,esc,date,translationShell));
   translateVisible(n);
   const pager=$('#contributor-pagination');if(pager)pager.innerHTML=data.next===null?'':button(t('loadMore'),'load-contributor','','load-more');
   return;
  }
 if(action==='load-mine'){const kind=route().params.get('kind')||'topics',n=sequence,data=await api('/api/me/content?kind='+kind+'&offset='+state.meNext);if(n!==sequence)return;state.feed.push(...data.items);state.meNext=data.next;el.remove();$('#my-content').insertAdjacentHTML('beforeend',data.items.map(c=>kind==='comments'?`<article class="topic-card"><a href="/topic/${c.topic_id}?comment=${c.id}">${date(c.created_at)}</a><p class="prose">${c.status==='deleted'?t('deletedComment'):esc(c.body)}</p>${actions(c,'comment')}</article>`:topicCard(c)).join('')+(data.next!==null?button(t('loadMore'),'load-mine','','load-more'):''));return;}
 if(action==='toggle-original'){translations?.toggle(el.closest('[data-translation]'));return;}
 if(action==='analytics-days'){
  const days=Number(el.dataset.days);
  if(![7,30].includes(days)||!state.admin||route().path!=='/admin'||route().params.get('tab')!=='analytics')return;
  if(state.analyticsDays===days)return;
  // All 30 daily rows are loaded when Analytics opens; no extra Worker/D1 request.
  const view={...state.admin,days,metrics:state.admin.metrics.slice(0,days)};
  const period=$('#content-stats-period');
  if(period)period.innerHTML=renderContentPeriod(view,t,esc);
  updateAnalyticsDayButtons($('#analytics-period-controls'),days);
  state.analyticsDays=days;
  rememberAnalyticsFilters();
  return;
 }
 if(action==='analytics-rank'){
  const rank=el.dataset.rank;
  if(!['topics','comments','total'].includes(rank)||!state.admin||route().path!=='/admin'||route().params.get('tab')!=='analytics')return;
  // Clicking the already selected sort cancels any older in-flight sort request.
  if(state.admin.contributorSort===rank){++analyticsRankingRequest;return;}
  const token=++analyticsRankingRequest,n=sequence;
  // Fetch only leaderboard rows, leaving traffic metrics, content totals and scroll unchanged.
  const data=await api('/api/admin/contributors?rank='+rank);
  if(token!==analyticsRankingRequest||n!==sequence||route().path!=='/admin'||route().params.get('tab')!=='analytics')return;
  state.admin.contributors=data.contributors;
  state.admin.contributorSort=data.contributorSort;
  const ranking=$('#content-stats-ranking');
  if(ranking)ranking.innerHTML=renderContributorRanking(state.admin,t,esc);
  rememberAnalyticsFilters();
  return;
 }
 if(action==='toggle-analytics'){if(state.user?.role!=='admin')throw new Error('forbidden');const enabled=el.dataset.enabled!=='true';await send('/api/admin/settings',{key:'analytics_enabled',value:String(enabled),reason:'Analytics '+(enabled?'enabled':'disabled')+' by administrator'});if(state.admin)state.admin.analyticsEnabled=enabled;if(state.health)state.health.analyticsEnabled=enabled;el.dataset.enabled=String(enabled);el.setAttribute('aria-pressed',String(enabled));el.classList.toggle('primary',!enabled);el.textContent=t(enabled?'analyticsDisable':'analyticsEnable');const status=$('[data-analytics-status]');if(status)status.textContent=t(enabled?'analyticsOn':'analyticsOff');toast(t('success'));return;}
  if(action==='admin-action'){const payload=JSON.parse(el.dataset.payload);modal(`<h2>${esc(el.textContent)}</h2><form id="admin-form" class="form-grid" data-endpoint="${esc(el.dataset.endpoint)}" data-payload="${esc(JSON.stringify(payload))}"><label>${t('reason')}<textarea class="short" name="reason" required maxlength="2000"></textarea></label><button class="button primary">${t('submit')}</button></form>`);return;}
 if(action==='add-term'||action==='edit-term'){const term=state.terms.find(x=>x.id===id);modal(`<h2>${t('taxonomy')}</h2><form id="term-form" class="form-grid" data-id="${esc(id||'')}"><label>Slug<input name="slug" required pattern="[a-z0-9-]+" maxlength="80" value="${esc(term?.slug||'')}"></label><label>${t('spaces')}<select name="term_type">${['body_part','symptom','treatment','category'].map(k=>`<option value="${k}" ${term?.term_type===k?'selected':''}>${t(k==='category'?'stories':k)}</option>`).join('')}</select></label><label>${t('title')} (${esc(locale)})<input name="label" required maxlength="120" value="${esc(term?.label||'')}"></label><label>${t('aliases')}<input name="aliases" maxlength="2000"></label><label>${t('reason')}<input name="reason" required maxlength="2000"></label><button class="button primary">${t('save')}</button></form>`);return;}
}
document.addEventListener('click',async event=>{const anchor=event.target.closest('a[href^="/"]');if(anchor&&!anchor.dataset.action&&!anchor.getAttribute('href').startsWith('/api/')&&!event.defaultPrevented&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey&&event.button===0&&!anchor.target&&!anchor.hasAttribute('download')){event.preventDefault();await navigate(anchor.getAttribute('href'));return;}if(!event.target.closest('.account-menu'))document.querySelector('.account-menu[open]')?.removeAttribute('open');const area=event.target.closest('[data-topic-open]');if(area&&!event.target.closest('a,button,input,select,textarea,[data-action]')){navigate('/topic/'+encodeURIComponent(area.dataset.topicOpen));return;}const el=event.target.closest('[data-action]');if(!el||el.disabled)return;if(el.tagName==='BUTTON')event.preventDefault();el.disabled=true;try{await clicked(el,event);}catch(e){if(e.status===401)showLogin();else toast(errorText(e));}finally{el.disabled=false;}});
document.addEventListener('submit',async event=>{const form=event.target;if(!(form instanceof HTMLFormElement))return;event.preventDefault();if(!form.reportValidity())return;const data=new FormData(form),v=Object.fromEntries(data),submit=$('[type="submit"],button:not([type="button"])',form);if(submit)submit.disabled=true;
 try{
  if(form.id==='search-form'){const p=new URLSearchParams();for(const [k,value]of data)if(value)p.set(k,value);const sort=$('#sort')?.value;if(sort)p.set('sort',sort);navigate('/search?'+p);return;}
  if(form.id==='compose-form'){const edit=form.dataset.id;const r=await send('/api/topics'+(edit?'/'+encodeURIComponent(edit):''),{title:v.title,body:v.body,...sourcePayload(v),terms:data.getAll('terms'),symptom_duration_days:v.symptom_duration_days||null},edit?'PATCH':'POST');closeModal();await navigate('/topic/'+(edit||r.id));if(r.status!=='published')toast(t(r.status));return;}
  if(form.id==='root-reply'||form.id==='reply-form'){const edit=form.dataset.edit==='true',parent=form.dataset.id,kind=form.dataset.kind||'regular';const topicId=form.dataset.topicId||state.topic?.id||findContent('comment',parent)?.topic_id;if(!topicId)throw new Error('topic_not_loaded');const result=await send(edit?'/api/comments/'+parent:'/api/topics/'+topicId+'/comments',{body:v.body,...sourcePayload(v),kind,parent_comment_id:!edit?parent||null:null},edit?'PATCH':'POST');if(form.id==='reply-form')closeModal();else{form.reset();document.activeElement?.blur();}if(state.topic?.id===topicId&&$('#comments'))updateReplyUI(result,edit);else{const feedTopic=state.feed.find(item=>item.id===topicId);if(feedTopic)feedTopic.reply_count=result.reply_count;for(const card of document.querySelectorAll('[data-topic]'))if(card.dataset.topic===topicId)for(const count of card.querySelectorAll('[data-reply-count]'))count.textContent=String(result.reply_count);toast(t('success'));}if(result.status&&result.status!=='published')toast(t(result.status));return;}
  if(form.id==='report-form'){await send(form.dataset.kind==='appeal'?'/api/appeals':'/api/reports',{...v,id:form.dataset.id,type:form.dataset.type});closeModal();toast(t('sent'));return;}
  if(form.id==='profile-form'){await send('/api/me',v,'PATCH');await refreshMe();toast(t('success'));renderChrome();return;}
  if(form.id==='privacy-form'){await send('/api/privacy-requests',v);closeModal();toast(t('sent'));await render();return;}
  if(form.classList.contains('language-review-form')){
   await send('/api/admin/language-review',{type:form.dataset.type,id:form.dataset.id,source_lang:v.source_lang,reason:v.reason});
   toast(t('success'));
   await renderLanguageReview($('#admin-content'),api,esc,locale,isPreview());
   return;
  }
  if(form.id==='translation-provider-form'){
   const daily=Number(v.daily_limit),monthly=Number(v.monthly_limit);
   if(!Number.isSafeInteger(daily)||!Number.isSafeInteger(monthly)||daily<1||monthly<daily){
    toast(locale.startsWith('zh')?'额度必须为正整数，且每日不能超过每月':'Invalid translation limits');
    return;
   }
   await send('/api/admin/translation-providers',{provider:'azure',active_provider:v.active_provider||'azure',daily_limit:daily,monthly_limit:monthly});
   toast(t('success'));
   await renderTranslationAdmin($('#admin-content'),api,esc,locale);
   return;
  }
  if(form.id==='admin-form'){await send('/api/admin/'+form.dataset.endpoint,{...JSON.parse(form.dataset.payload),reason:v.reason});closeModal();toast(t('success'));await render();return;}
  if(form.id==='term-form'){await send('/api/admin/taxonomy',{id:form.dataset.id||undefined,term_type:v.term_type,slug:v.slug,labels:{[locale]:v.label},...(v.aliases.trim()?{aliases:v.aliases.split(/[,，]/).map(s=>s.trim()).filter(Boolean)}:{}),reason:v.reason});state.terms=(await api('/api/taxonomy?locale='+locale)).terms;closeModal();toast(t('success'));await render();return;}
 }catch(e){toast(errorText(e));}finally{if(submit)submit.disabled=false;}
});
$('#language').addEventListener('change',async e=>{locale=e.target.value;translations?.close();++sequence;localStorage.setItem('sc_locale',locale);try{state.terms=(await api('/api/taxonomy?locale='+locale)).terms;}catch{}await render();});
document.addEventListener('change',e=>{
 if(e.target.matches('input[name="reading-theme"],input[name="reading-size"]')){
  const field=e.target.name==='reading-theme'?'theme':'size';
  readingPreferences=saveReadingPreferences(readingStorage,document.documentElement,{...readingPreferences,[field]:e.target.value});
  return;
 }
 if(e.target.id==='sort'){const current=route();navigate(sortRoute(current.path,current.params,e.target.value));}});
document.addEventListener('keydown',event=>{if(event.key==='Escape')document.querySelector('.account-menu[open]')?.removeAttribute('open');});
window.addEventListener('popstate',event=>{
 saveListView();
 navigationEntry=event.state?.scNavigation||{key:navigationKey(),index:0,url:location.pathname+location.search+location.hash,list:null};
 window.scrollTo({top:0,behavior:'instant'});
 render(false,true);
});
async function boot(){renderChrome();await Promise.allSettled([refreshMe(),api('/api/health').then(r=>state.health=r),api('/api/taxonomy?locale='+locale).then(r=>state.terms=r.terms)]);await render();refreshUnread();}
boot();setInterval(()=>{if(document.visibilityState==='visible')refreshUnread();},60000);


