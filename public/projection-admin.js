const ROOT='/api/admin/public-projection';
const chinese=locale=>locale==='zh-CN'||locale==='zh-TW';

export async function renderProjectionAdmin(target,api,esc,locale,after=null) {
 const zh=chinese(locale);
 const {scan,queue,failed,purge_ready,enabled,preview}=await api(ROOT+(after?'?after='+encodeURIComponent(after):''));
 if(!target.isConnected)return;
 const label=(en,cn)=>zh?cn:en;
 const button=(action,text,extra='')=>`<button type="button" class="button" data-action="projection-${action}" ${extra}>${text}</button>`;
 const active=scan&&['listing','comparing'].includes(scan.phase);
 const resultNames={
  missing:label('Missing','缺失'),outdated:label('Older version','版本落后'),
  mismatch:label('Hash or version mismatch','摘要或版本不符'),check_failed:label('Check failed','检查失败'),
  changed_during_scan:label('Changed during scan','扫描期间变更'),orphan:label('Extra R2 object','R2 多余对象')
 };
 const phaseNames={
  listing:label('Listing R2 objects','列举 R2 对象中'),comparing:label('Comparing with D1','核对 D1 中'),
  complete:label('Scope checked','本次范围已核对'),partial:label('Partial / recheck required','部分完成 / 需复查')
 };
 target.innerHTML=`
  <h2>${label('Check D1 / R2 consistency','检查 D1 / R2 一致性')}</h2>
  <p class="subtle">${label('Manual scan. R2 LIST uses Class A operations. Deep checks add up to one GET per matched object. Each scan is capped at 5,000 objects.', '仅手动检查。R2 LIST 计入 Class A，深度核验最多为每个匹配对象增加一次 GET。每次最多核对 5,000 个对象。')}</p>
  <p>${label('Purge configuration','CDN 清理配置')} · ${purge_ready?label('Present','已设置'):label('Missing','缺失')} · ${enabled?label('Publishing enabled','投影已启用'):label('Publishing disabled','投影关闭')}</p>
  <p>${label('Publishing queue','发布队列')} · ${queue.map(row=>esc(row.state)+': '+esc(row.count)).join(' · ')}</p>
  ${failed.map(row=>`<div class="admin-row"><code>${esc(row.scope)} / ${esc(row.target)}</code> · ${esc(row.last_error)} · ${esc(row.attempts)}
   ${button('retry',label('Retry task','重试任务'),`data-key="${esc(row.key||(row.scope==='feed'?'feeds/latest/page-1.json':'topics/'+row.target+'/detail.json'))}"`)}
  </div>`).join('')}
  ${preview?button('drain',label('Process Preview queue','处理预览队列')):''}
  ${active?'':`<div class="form-grid">
   <label>${label('Topic ID (blank for all)','帖子 ID（留空检查全部）')}<input id="projection-target" maxlength="128"></label>
   <label>${label('R2 keys per list request','每批列举对象数')}<input id="projection-batch" type="number" min="1" max="100" value="100"></label>
   <label class="check"><input id="projection-orphans" type="checkbox">${label('Report extra R2 objects','检查 R2 多余对象')}</label>
   <label class="check"><input id="projection-deep" type="checkbox">${label('Verify JSON bodies (extra GETs)','深度核验 JSON（额外 GET）')}</label>
   ${button('start',label('Start check','开始检查'))}
  </div>`}
  ${!scan?'':`<h3>${esc(phaseNames[scan.phase])}${scan.paused?' · '+label('Paused','已暂停'):''}</h3>
   <p><code>${esc(scan.id)}</code> · ${esc(scan.target||label('All','全部'))}</p>
   <p>${label('Checked / expected','已查 / 预期')} ${scan.checked_count} / ${scan.expected_count}
    · ${label('R2 listed','R2 已列举')} ${scan.listed_count} · ${label('Normal','正常')} ${scan.counts.ok||0}
    · ${label('Exceptions','异常')} ${Object.keys(resultNames).reduce((n,key)=>n+(scan.counts[key]||0),0)}</p>
   ${scan.error?`<p class="notice">${esc(scan.error)}</p>`:''}
   ${active?`<div class="stack">
     ${scan.paused?button('resume',label('Resume','恢复')):button('step',label('Check next batch','检查下一批'))+button('pause',label('Pause','暂停'))}
     ${button('cancel',label('End this scan','结束本次检查'))}
   </div>`:''}
   <p class="subtle">${label('R2 comparison and CDN purge state are separate. A completed purge does not verify every cache node.', 'R2 对账结果与 CDN 清理状态分别记录。清理成功后仍需请求公开 URL 验证缓存。')}</p>
   ${scan.items.map(item=>`<div class="admin-row">
     <label class="check">${!active&&!item.repair_version&&['missing','outdated','mismatch','orphan'].includes(item.result)?`<input type="checkbox" name="projection-repair" value="${esc(item.object_key)}">`:''}<code>${esc(item.object_key)}</code></label>
     <p>${esc(resultNames[item.result]||item.result)} · D1 ${esc(item.expected_version??'—')} · R2 ${esc(item.r2_version??'—')}
      · CDN ${esc(item.purge_state??'—')}${item.purge_error?' · '+esc(item.purge_error):''}
      ${item.repair_version?' · '+label('Repair version','修复版本')+' '+esc(item.repair_version):''}</p>
   </div>`).join('')}
   ${scan.next?`<a class="button" href="#/admin?tab=publicProjection&after=${encodeURIComponent(scan.next)}">${label('Next report page','下一页报告')}</a>`:''}
   ${!active&&scan.items.some(item=>!item.repair_version&&['missing','outdated','mismatch','orphan'].includes(item.result))?
     button('repair',label('Repair selected exceptions','修复选中的异常')):''}
   <input type="hidden" id="projection-scan" value="${esc(scan.id)}">`}
 `;
}

export async function projectionAdminAction(element,target,send,locale) {
 const action=element.dataset.action.slice('projection-'.length);
 const field=id=>target.querySelector('#projection-'+id);
 const scan=field('scan')?.value;
 if(action==='start')return send(ROOT+'/start',{
  target:field('target').value.trim(),batch_size:field('batch').valueAsNumber,
  include_orphans:field('orphans').checked,deep:field('deep').checked
 });
 if(action==='repair'||action==='retry'){
  const keys=[...target.querySelectorAll('[name="projection-repair"]:checked')].map(node=>node.value);
  if(action==='repair'&&keys.length===0)return;
  const message=chinese(locale)?'确认按 D1 当前内容重新发布并清理相关 CDN URL？':
   'Confirm publishing from current D1 data and purging the affected CDN URLs?';
  if(!window.confirm(message))return;
  return send(ROOT+'/'+action,{scan,keys,key:element.dataset.key,confirm:true});
 }
 return send(ROOT+'/'+action,{scan});
}
