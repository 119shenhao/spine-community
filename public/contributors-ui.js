// Read-only activity cards for real community members.
export function renderContributorRanking(data,t,esc){
 const days=data.days===30?30:7,sort=data.contributorSort||'topics';
 const sortLink=(key,label)=>`<a class="button small ${key===sort?'active':''}" href="/admin?tab=analytics&days=${days}&rank=${key}">${esc(label)}</a>`;
 const rows=data.contributors||[];
 return `<section class="contributors-section" aria-label="${esc(t('topContributors'))}">
 <h3>${esc(t('topContributors'))}</h3><p class="subtle">${esc(t('contributorHint'))}</p>
 <nav class="stack contributor-filters" aria-label="${esc(t('topContributors'))}">
 ${sortLink('topics',t('topicCount'))}${sortLink('comments',t('commentCount'))}${sortLink('total',t('totalContributions'))}</nav>
 <div class="table-wrap"><table class="metric-table contributor-table"><thead><tr>
 <th>${esc(t('contributorRank'))}</th><th>${esc(t('nickname'))}</th><th>${esc(t('topicCount'))}</th>
 <th>${esc(t('commentCount'))}</th><th>${esc(t('totalContributions'))}</th></tr></thead><tbody>
 ${rows.map((u,i)=>`<tr><td>${i+1}</td><th scope="row"><a href="/users/${encodeURIComponent(u.id)}">${esc(u.nickname)}</a></th><td>${esc(u.posts)}</td><td>${esc(u.replies)}</td><td>${esc(u.total)}</td></tr>`).join('')||`<tr><td colspan="5">${esc(t('emptyList'))}</td></tr>`}
 </tbody></table></div></section>`;
}
export function renderContributorItems(items,kind,t,esc,date){
 return items.map(item=>kind==='comments'
 ?`<article class="topic-card"><p class="subtle"><a href="/topic/${encodeURIComponent(item.topic_id)}?comment=${encodeURIComponent(item.id)}">${esc(item.topic_title||t('deletedTopic'))}</a> · ${esc(date(item.created_at))}</p><p class="prose">${esc(item.body)}</p><a class="subtle" href="/topic/${encodeURIComponent(item.topic_id)}?comment=${encodeURIComponent(item.id)}">${esc(t('viewDiscussion'))} →</a></article>`
 :`<article class="topic-card"><div class="topic-meta"><time>${esc(date(item.created_at))}</time><span>· ${esc(item.source_lang)}</span></div><h3><a href="/topic/${encodeURIComponent(item.id)}">${esc(item.title)}</a></h3><p class="summary">${esc(item.summary)}</p><a class="subtle" href="/topic/${encodeURIComponent(item.id)}">${esc(t('viewDiscussion'))} →</a></article>`).join('');
}
export function renderContributorProfile(data,t,esc,date){
 const u=data.user,kind=data.kind,profilePath='/users/'+encodeURIComponent(u.id);
 return `<a class="back-link" href="/">← ${esc(t('backLink'))}</a>
 <section class="panel contributor-profile"><div class="contributor-identity">
 <span class="avatar contributor-avatar" aria-hidden="true">${esc(u.nickname.slice(0,1))}</span>
 <div><h1 class="page-title">${esc(u.nickname)}</h1><p class="subtle">${esc(t('joinDate'))} · ${esc(date(u.created_at))}</p></div></div>
 <div class="contributor-totals">
 <div><strong>${esc(u.posts)}</strong><span>${esc(t('topicCount'))}</span></div>
 <div><strong>${esc(u.replies)}</strong><span>${esc(t('commentCount'))}</span></div>
 <div><strong>${esc(Number(u.posts)+Number(u.replies))}</strong><span>${esc(t('totalContributions'))}</span></div>
 </div></section>
 <nav class="tabs" aria-label="${esc(t('topContributors'))}">
 <a class="button ${kind==='topics'?'active':''}" href="${profilePath}?kind=topics">${esc(t('contributorTopics'))}</a>
 <a class="button ${kind==='comments'?'active':''}" href="${profilePath}?kind=comments">${esc(t('contributorReplies'))}</a></nav>
 <section id="contributor-items">${data.items.length?renderContributorItems(data.items,kind,t,esc,date):`<p class="subtle">${esc(t('emptyList'))}</p>`}</section>
 <div id="contributor-pagination">${data.next===null?'':`<button type="button" class="button load-more" data-action="load-contributor">${esc(t('loadMore'))}</button>`}</div>`;
}
