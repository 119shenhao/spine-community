// Read-only provider catalogue and provider-specific quota editor.
// Credentials remain Cloudflare Secrets, not browser-managed settings.
export async function renderTranslationAdmin(target,api,esc,locale){
 const zh=locale==='zh-CN'||locale==='zh-TW';
 const tr=(cn,en)=>zh?cn:en;
 const response=await api('/api/admin/translation-providers');
 const num=n=>Number(n||0).toLocaleString(locale);
 const pct=(used,limit)=>limit>0?Math.min(100,Math.round(Number(used||0)*100/limit)):0;
 const rows=response.providers||[];
 const current=rows.find(p=>p.id===response.activeProvider);
 const azure=rows.find(p=>p.id==='azure');
 if(!azure)throw new Error('translation_provider_not_configured');
 const status=p=>p.status==='ready'?tr('已启用','Ready'):
   p.status==='disabled'?tr('服务已配置但翻译暂停','Configured, translation paused'):
   p.status==='not_integrated'?tr('暂未接入','Not integrated'):
   tr('尚未配置凭据','Credentials not configured');
 const item=p=>`<div class="admin-row"><strong>${esc(p.name)}</strong>
   · ${esc(status(p))}
   ${p.active?`<span class="subtle">${tr(' · 当前服务商',' · Active provider')}</span>`:''}
   <p class="subtle">${p.implemented?
     tr('已接入实际翻译接口','Real translation adapter connected'):
     tr('仅作为未来服务商预留，不能启用或调用','Listed for future use; cannot be enabled or called')}</p>
  </div>`;
 const stats=[
  {label:tr('今日额度','Daily'),data:azure.daily},
  {label:tr('本月额度','Monthly'),data:azure.monthly},
  {label:tr('滚动31天用量','Rolling 31 days'),data:azure.rolling31Day}
 ];
 const summary=stats.map(({label,data})=>`<div class="stat"><span>${label}</span>
   <strong>${num(data?.reserved??data?.recorded)} / ${num(data?.limit)}</strong>
   <small>${tr('剩余','Remaining')} ${num(data?.remaining)} · ${pct(data?.reserved??data?.recorded,data?.limit)}%</small>
   </div>`).join('');
 const bad=(azure.blockers||[]).map(b=>`<code>${esc(b)}</code>`).join('，');
 target.innerHTML=`
  <h2>${tr('翻译服务管理','Translation providers')}</h2>
  <p class="subtle">${tr('服务商单独管理；目前只有 Azure 已集成，未来新增阿里云时不会自动复用 Azure 密钥或额度。','Providers are managed separately. Only Azure is integrated; other providers do not reuse its credentials or quota.')}</p>
  <h3>${tr('可用翻译服务商','Provider catalogue')}</h3>
  ${rows.map(item).join('')}
  <p>${tr('当前正在使用','Active provider')}：<strong>${esc(current?.name||response.activeProvider)}</strong></p>
  <div class="admin-grid">${summary}</div>
  ${bad?`<div class="notice">${tr('限制状态','Limits')}: ${bad}</div>`:''}
  <h3>${tr('Azure Translator 额度设置','Azure Translator quota settings')}</h3>
  <form class="form-grid" id="translation-provider-form">
   <input type="hidden" name="provider" value="azure"/>
   <label>${tr('当前翻译服务商','Active translation provider')}
    <select name="active_provider" required>
     ${rows.map(p=>`<option value="${esc(p.id)}" ${p.active?'selected':''} ${p.selectable?'':'disabled'}>${esc(p.name)}${p.selectable?'':tr('（未接入）',' (not available)')}</option>`).join('')}
    </select>
   </label>
   <label>${tr('每日网站预算（字符）','Daily website budget (characters)')}
    <input name="daily_limit" type="number" required min="1" max="${Number(response.capMonthly)}" step="1" value="${Number(azure.daily?.limit||0)}"/>
   </label>
   <label>${tr('每月网站预算（字符）','Monthly website budget (characters)')}
    <input name="monthly_limit" type="number" required min="1" max="${Number(response.capMonthly)}" step="1" value="${Number(azure.monthly?.limit||0)}"/>
   </label>
   <div class="notice info">
    ${tr('Azure F0 官方免费月额度','Azure F0 advertised free monthly allowance')}: <strong>${num(azure.freeMonthly)}</strong>。
    ${tr('为预留安全余量，网站每月最多允许设置','Website cap to leave safety headroom')}: <strong>${num(response.capMonthly)}</strong>。
    ${tr('计数仅代表本论坛用量，不代表 Azure 账户实时总用量。','These counters cover this website, not your full Azure account usage.')}
   </div>
   <p class="subtle">${tr('只修改额度，不会重置已累计字符数；如果当前已经超过新限额，将暂停新的翻译直到预算恢复。','Changes do not reset existing usage; lowering below current usage pauses new translation until budget is available.')}</p>
   <div class="form-actions"><button type="submit" class="button primary">${tr('保存额度设置','Save quota settings')}</button></div>
  </form>
 `;
}
