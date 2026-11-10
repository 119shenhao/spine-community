// Administrator-only language evidence review, with versioned manual corrections.
// Never expose this to public or moderator users; server separately checks role.
export async function renderLanguageReview(target,api,esc,locale,preview=false) {
 const zh=locale==='zh-CN'||locale==='zh-TW';
 const t=(cn,en)=>zh?cn:en;
 const {items=[]}=await api('/api/admin/language-review');
 const options=['en','zh-CN','zh-TW','es','pt-BR','de','fr','ja'];
 const rows=items.map(row=>{
  const opt=options.map(lang=>`<option value="${lang}" ${lang===row.source_lang?'selected':''}>${lang}</option>`).join('');
  return `<div class="admin-row">
   <strong>${esc(row.type==='topic'?t('帖子','Post'):t('回复','Reply'))}</strong>
   · <small>${esc(row.id)}</small>
   · ${esc(row.source_lang)} (${esc(row.source_lang_mode)})
   <p>${esc(row.title||'')}</p>
   <p class="subtle">${esc(row.preview||'')}</p>
   <form class="form-grid language-review-form" data-type="${esc(row.type)}" data-id="${esc(row.id)}">
    <label>${t('确认原文语言','Confirm source language')}
     <select name="source_lang" required>${opt}</select>
    </label>
    <label>${t('纠正原因','Correction reason')}
     <input name="reason" required minlength="3" maxlength="500"
       placeholder="${t('例如：人工核对原文','e.g. Verified from original')}" />
    </label>
    <div class="form-actions"><button class="button primary" type="submit">${t('保存并重新生成缓存','Save and refresh cached pages')}</button></div>
   </form>
  </div>`;
 }).join('');
 const backfill=preview?`<section class="admin-row">
  <h3>${t('历史原文语言自动处理（仅开发预览）','Historical language backfill (preview only)')}</h3>
  <p class="subtle">${t('先读取候选，再自动处理最多20条：可信语言会验证，不确定语言保留合法旧值或保持未知，继续等待人工复核。','Inspect suggestions first, then process up to 20 items. Uncertain languages remain provisional and await manual review.')}</p>
  <div class="form-actions">
   <button class="button" type="button" data-action="historical-language-scan" data-type="topic">${t('预览主帖建议','Preview topic suggestions')}</button>
   <button class="button primary" type="button" data-action="historical-language-apply" data-type="topic">${t('自动处理下一批主帖','Process next topic batch')}</button>
   <button class="button" type="button" data-action="historical-language-scan" data-type="comment">${t('预览回复建议','Preview reply suggestions')}</button>
   <button class="button primary" type="button" data-action="historical-language-apply" data-type="comment">${t('自动处理下一批回复','Process next reply batch')}</button>
  </div>
  <p id="historical-language-status" class="subtle" role="status" aria-live="polite"></p>
 </section>`:'';
 target.innerHTML=`${backfill}<h2>${t('原文语言核对','Source-language review')}</h2>
  <p class="subtle">${t('仅列出最近100条尚未确认语言的内容。纠正会使译文缓存失效，并按需刷新 CDN 原文。','Shows up to 100 recent unverified items. Corrections invalidate old translations and queue original CDN refresh.')}</p>
  ${rows||`<p class="subtle">${t('暂无待处理内容','No unresolved items')}</p>`}`;
}
