import {renderContributorRanking} from './contributors-ui.js';
const sourceRows=[['imported','importedContent'],['user','userContent'],['','allContent']];
function countTable(values,period,t,esc){
 const labels=sourceRows.map(([key,label])=>{
  const topicKey=key?key+'_topics':period?'new_topics':'topics';
  const commentKey=key?key+'_comments':period?'new_comments':'comments';
  return `<tr><th scope="row">${t(label)}</th><td>${esc(values[topicKey]||0)}</td><td>${esc(values[commentKey]||0)}</td></tr>`;
 }).join('');
 const missing=values.unknown_topics||values.unknown_comments?
  `<tr><th scope="row">${t('unknownSource')}</th><td>${esc(values.unknown_topics||0)}</td><td>${esc(values.unknown_comments||0)}</td></tr>`:'';
 return `<div class="table-wrap"><table class="metric-table"><thead><tr><th>${t('contentSource')}</th><th>${t(period?'periodTopics':'topicCount')}</th><th>${t(period?'periodComments':'commentCount')}</th></tr></thead><tbody>${labels}${missing}</tbody></table></div>`;
}
export function renderContentPeriod(data,t,esc){
 const sum=data.metrics.reduce((a,r)=>{
  for(const k of ['new_topics','new_comments','imported_topics','imported_comments','user_topics','user_comments','unknown_topics','unknown_comments'])
   a[k]=(a[k]||0)+(r[k]||0);
  return a;
 },{});
 const pv=data.metrics.reduce((n,r)=>n+(r.pv||0),0);
 const columnNames=['UTC',t('users'),t('periodTopics'),t('periodComments'),t('importedContent')+' · '+t('topicCount'),t('importedContent')+' · '+t('commentCount'),t('userContent')+' · '+t('topicCount'),t('userContent')+' · '+t('commentCount'),t('reports'),'UV ≈','PV','5m ≈','Hour UTC','Peak PV'];
 const fields=['day_utc','new_users','new_topics','new_comments','imported_topics','imported_comments','user_topics','user_comments','new_reports','uv_estimate','pv','peak_active_5m_estimate','peak_hour_utc','peak_hour_pv'];
 return `<h3>${t('periodContent')}</h3>${countTable(sum,true,t,esc)}<div class="stat">PV<strong>${esc(pv)}</strong></div>
 ${data.contentUndated.topics||data.contentUndated.comments?`<p class="subtle">${t('undatedContent')}: ${esc(data.contentUndated.topics)} / ${esc(data.contentUndated.comments)}</p>`:''}
 <p class="subtle">${t('analyticsNote')}</p><div class="table-wrap"><table class="metric-table">
 <thead><tr>${columnNames.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead>
 <tbody>${data.metrics.map(r=>`<tr>${fields.map(k=>`<td>${esc(r[k]??'—')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
export function renderContentStats(data,t,esc){
 const days=data.days===30?30:7;
 const dayButton=value=>`<button type="button" class="button ${days===value?'active':''}" data-action="analytics-days" data-days="${value}" aria-pressed="${days===value}">${value}d</button>`;
 return `<h3>${t('currentContent')}</h3>${countTable(data.contentTotals,false,t,esc)}<p class="subtle">${t('contentCountNote')}</p>
 <div class="stack" id="analytics-period-controls">${dayButton(7)}${dayButton(30)}</div>
 <div id="content-stats-ranking">${renderContributorRanking(data,t,esc)}</div>
 <section id="content-stats-period">${renderContentPeriod(data,t,esc)}</section>`;
}

/** Update the two period buttons in place. querySelectorAll returns a collection;
 * querySelector only returns one element and must never be iterated. */
export function updateAnalyticsDayButtons(container,days){
 if(!container)return;
 for(const button of container.querySelectorAll('[data-action="analytics-days"]')){
  const selected=Number(button.dataset.days)===days;
  button.classList.toggle('active',selected);
  button.setAttribute('aria-pressed',String(selected));
 }
}
