import {Env,Row,all,one,stmt,now,id,fail,json,body,textField,requireRole,locales,analyticsEnabled} from './core';
import {contentStatistics} from './content-statistics';
import {contributorRanking,contributorSort} from './contributors';
import {purge,notify} from './content';
import {verificationWrite} from './language-state';
import {proposeHistoricalLanguage} from './historical-language';
import {AZURE_SITE_MAX_MONTHLY,translationBudgetStatus,translationProvidersStatus} from './translation';
const audit=(env:Env,u:Row,type:string,target:string,action:string,reason:string)=>stmt(env.DB,'INSERT INTO moderation_actions(id,actor_id,target_type,target_id,action,reason) VALUES(?,?,?,?,?,?)',id(),u.id,type,target,action,reason);
export async function adminRoute(req:Request,env:Env,user:Row|null,path:string):Promise<Response|null>{
  if(!path.startsWith('/api/admin/'))return null;
  const u=requireRole(user),url=new URL(req.url);
  if(path==='/api/admin/contributors'&&req.method==='GET'){
    const rank=contributorSort(url.searchParams.get('rank'));
    return json({contributorSort:rank,contributors:await contributorRanking(env.DB,rank)});
  }
  if(path==='/api/admin/overview'&&req.method==='GET'){
    const days=url.searchParams.get('days')==='30'?30:7;
    const rank=contributorSort(url.searchParams.get('rank'));
    const content=await contentStatistics(env.DB,days);
    return json({days,contributorSort:rank,contributors:await contributorRanking(env.DB,rank),contentTotals:content.current,contentUndated:content.undated,reports:await all(env.DB,`SELECT r.*,CASE WHEN r.topic_id IS NOT NULL THEN t.title ELSE substr(c.body,1,150) END preview FROM reports r LEFT JOIN topics t ON t.id=r.topic_id LEFT JOIN comments c ON c.id=r.comment_id WHERE r.status IN ('open','reviewing') ORDER BY r.priority DESC,r.created_at LIMIT 100`),
      queue:await all(env.DB,`SELECT id,'topic' type,author_id,title,body,status,created_at FROM topics INDEXED BY idx_topics_moderation_recent WHERE status IN ('pending_review','blocked','hidden') UNION ALL SELECT id,'comment',author_id,NULL,body,status,created_at FROM comments INDEXED BY idx_comments_moderation_recent WHERE status IN ('pending_review','blocked','hidden') ORDER BY created_at DESC LIMIT 100`),
      appeals:await all(env.DB,"SELECT * FROM appeals WHERE status IN ('open','reviewing') ORDER BY created_at LIMIT 100"),
      logs:await all(env.DB,'SELECT m.*,u.nickname actor_name FROM moderation_actions m JOIN users u ON u.id=m.actor_id ORDER BY m.created_at DESC LIMIT 100'),
      users:u.role==='admin'?await all(env.DB,`SELECT u.id,u.nickname,u.status,COALESCE((SELECT group_concat(role) FROM user_roles r WHERE r.user_id=u.id),'member') role FROM users u ORDER BY u.created_at DESC LIMIT 100`):[],
      sanctions:await all(env.DB,`SELECT s.*,u.nickname FROM user_sanctions s JOIN users u ON u.id=s.user_id WHERE s.lifted_at IS NULL ORDER BY s.created_at DESC LIMIT 100`),
      privacy:u.role==='admin'?await all(env.DB,"SELECT p.*,u.nickname FROM privacy_requests p JOIN users u ON u.id=p.user_id WHERE p.status IN ('open','processing') ORDER BY p.requested_at LIMIT 100"):[],
      metrics:(await all(env.DB,`WITH RECURSIVE days(d,n) AS(SELECT date('now'),1 UNION ALL SELECT date(d,'-1 day'),n+1 FROM days WHERE n<?) SELECT d day_utc,COALESCE(c.new_users,0) new_users,COALESCE(c.new_topics,0) new_topics,COALESCE(c.new_comments,0) new_comments,COALESCE(c.new_reports,0) new_reports,COALESCE(t.uv_estimate,0) uv_estimate,COALESCE(t.pv,0) pv,COALESCE(t.peak_active_5m_estimate,0) peak_active_5m_estimate,t.peak_hour_utc,COALESCE(t.peak_hour_pv,0) peak_hour_pv FROM days LEFT JOIN daily_community_metrics c ON c.day_utc=d LEFT JOIN daily_traffic_metrics t ON t.day_utc=d ORDER BY d DESC`,days)).map(row=>({...row,new_topics:0,new_comments:0,imported_topics:0,imported_comments:0,user_topics:0,user_comments:0,unknown_topics:0,unknown_comments:0,...content.daily.find(d=>d.day_utc===row.day_utc)})),
      settings:u.role==='admin'?await all(env.DB,'SELECT key,value FROM settings'):[],analyticsEnabled:await analyticsEnabled(env.DB)});
  }
  // Preview-only bounded backfill. 'legacy' means provisional, and must not
  // be confused with a detector/admin verification. Production D1 is excluded.
  if(path==='/api/admin/historical-language-backfill'){
    requireRole(u,true);
    if(env.APP_ENV!=='preview')fail(403,'preview_only');
    if(req.method!=='GET'&&req.method!=='POST')fail(405,'method_not_allowed');
    const b=req.method==='POST'?await body(req):{};
    const type=req.method==='GET'?url.searchParams.get('type'):b.type;
    if(type!=='topic'&&type!=='comment')fail(400,'invalid_language_target');
    const after=req.method==='GET'?url.searchParams.get('after')||'':b.after||'';
    if(typeof after!=='string'||(after&&!/^[A-Za-z0-9_-]{1,128}$/.test(after)))
      fail(400,'invalid_cursor');
    if(b?.preview_confirm!==undefined&&b.preview_confirm!=='spine-community-db-preview')
      fail(400,'invalid_preview_confirmation');
    if(req.method==='POST'&&b.preview_confirm!=='spine-community-db-preview')
      fail(400,'preview_confirmation_required');
    const table=type==='topic'?'topics':'comments';
    const rows=await all(env.DB,`SELECT c.id,${type==='topic'?'c.title':'NULL title'},c.body,c.source_lang,c.source_lang_mode,
        c.content_version FROM ${table} c LEFT JOIN content_language_verifications v
        ON v.content_type=? AND v.content_id=c.id AND v.content_version=c.content_version
        WHERE c.status='published' AND c.id>? AND c.source_lang_mode<>'manual'
          AND (c.source_lang_mode='legacy' OR c.source_lang='und')
          AND v.content_id IS NULL ORDER BY c.id LIMIT 20`,type,after);
    const candidates=rows.map(row=>({row,proposal:proposeHistoricalLanguage(row,
      type==='topic'?[row.title,row.body]:[row.body])}));
    const next=rows.length===20?rows.at(-1)!.id:null;
    if(req.method==='GET')return json({type,next,items:candidates.map(({row,proposal})=>({
      id:row.id,source_lang:row.source_lang,source_lang_mode:row.source_lang_mode,
      content_version:row.content_version,...proposal
    }))});
    let updated=0,alreadyProvisional=0,conflicts=0,detected=0,defaulted=0;
    for(const {row,proposal} of candidates){
      if(proposal.mode==='legacy'&&row.source_lang===proposal.language&&row.source_lang_mode==='legacy'){
        alreadyProvisional++;continue;
      }
      // All predicates are checked again inside the atomic D1 batch, preventing
      // accidental overwrite of a human correction or concurrently edited text.
      const update=stmt(env.DB,`UPDATE ${table} SET source_lang=?,source_lang_mode=?,
        content_version=content_version+1,updated_at=unixepoch()
        WHERE id=? AND status='published' AND content_version=?
          AND source_lang_mode<>'manual' AND (source_lang_mode='legacy' OR source_lang='und')
          AND NOT EXISTS(SELECT 1 FROM content_language_verifications
           WHERE content_type=? AND content_id=? AND content_version=?)`,
       proposal.language,proposal.mode,row.id,row.content_version,type,row.id,row.content_version);
      const writes=[update];
      if(proposal.verified)writes.push(verificationWrite(env.DB,type,row.id,
        row.content_version+1,proposal.language,'tinyld-heavy',proposal.score));
      const result=await env.DB.batch(writes);
      if(result[0].meta.changes!==1){conflicts++;continue;}
      if(proposal.verified&&result[1].meta.changes!==1)
        throw new Error('historical_language_proof_not_saved');
      updated++;
      if(proposal.verified)detected++;else defaulted++;
      await audit(env,u,type,row.id,'automatic_historical_language',
        proposal.reason+': '+proposal.language+(proposal.verified?' (verified)':' (provisional, review pending)')).run();
    }
    return json({type,next,examined:rows.length,updated,detected,defaulted,
      alreadyProvisional,conflicts,remainingReviewRequired:true});
  }
  if(path==='/api/admin/language-review'){
    requireRole(u,true);
    if(req.method==='GET'){
      // Only unresolved published content is listed; confirmed cached
      // language records are excluded without altering original content.
      const items=await all(env.DB,`SELECT * FROM (
        SELECT t.id,'topic' type,substr(t.title,1,160) title,
          substr(t.body,1,200) preview,t.source_lang,t.source_lang_mode,t.content_version,t.created_at
        FROM topics t LEFT JOIN content_language_verifications v
          ON v.content_type='topic' AND v.content_id=t.id AND v.content_version=t.content_version
        WHERE t.status='published' AND (t.source_lang_mode='legacy' OR t.source_lang='und') AND v.language IS NULL
        UNION ALL
        SELECT c.id,'comment' type,'' title,substr(c.body,1,200) preview,
          c.source_lang,c.source_lang_mode,c.content_version,c.created_at
        FROM comments c LEFT JOIN content_language_verifications v
          ON v.content_type='comment' AND v.content_id=c.id AND v.content_version=c.content_version
        WHERE c.status='published' AND (c.source_lang_mode='legacy' OR c.source_lang='und') AND v.language IS NULL
        ) ORDER BY created_at DESC LIMIT 100`);
      return json({items});
    }
    if(req.method!=='POST')fail(405,'method_not_allowed');
    const b=await body(req),reason=textField(b.reason,3,500,'reason');
    if(b.type!=='topic'&&b.type!=='comment')fail(400,'invalid_language_target');
    if(typeof b.id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(b.id)||
      typeof b.source_lang!=='string'||!locales.includes(b.source_lang))fail(400,'invalid_source_language');
    const table=b.type==='topic'?'topics':'comments';
    const previous=await one(env.DB,`SELECT content_version FROM ${table} WHERE id=? AND status='published'`,b.id);
    if(!previous)fail(404,'not_found');
    const updated=await one(env.DB,`UPDATE ${table} SET source_lang=?,source_lang_mode='manual',
      content_version=content_version+1,updated_at=unixepoch()
      WHERE id=? AND status='published' AND content_version=? RETURNING content_version`,
      b.source_lang,b.id,previous.content_version);
    if(!updated)fail(409,'content_changed');
    await verificationWrite(env.DB,b.type,b.id,updated.content_version,b.source_lang,'admin-manual',null).run();
    await audit(env,u,b.type,b.id,'correct_language',
      b.type+': '+b.source_lang+' ('+reason+')').run();
    return json({ok:true,version:updated.content_version});
  }
  if(path==='/api/admin/translation-budget'&&req.method==='GET'){
    requireRole(u,true);
    return json(await translationBudgetStatus(env));
  }
  if(path==='/api/admin/translation-providers'){
    requireRole(u,true);
    if(req.method==='GET')return json(await translationProvidersStatus(env));
    if(req.method!=='POST')fail(405,'method_not_allowed');
    const input=await body(req);
    // Aliyun is a catalogue placeholder, not a ready-to-use adapter.
    // Never silently route its requests to Azure or accept unbounded limits.
    if(input.provider!=='azure'||input.active_provider!=='azure')fail(400,'translation_provider_not_integrated');
    const daily=input.daily_limit,monthly=input.monthly_limit;
    if(!Number.isSafeInteger(daily)||!Number.isSafeInteger(monthly)||
      daily<1||monthly<1||daily>monthly||monthly>AZURE_SITE_MAX_MONTHLY)fail(400,'invalid_translation_budget');
    await env.DB.batch([
      stmt(env.DB,`INSERT INTO settings(key,value) VALUES('translation_active_provider','azure')
        ON CONFLICT(key) DO UPDATE SET value=excluded.value`),
      stmt(env.DB,`INSERT INTO settings(key,value) VALUES('translation_azure_daily_limit',?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value`,String(daily)),
      stmt(env.DB,`INSERT INTO settings(key,value) VALUES('translation_azure_monthly_limit',?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value`,String(monthly)),
      audit(env,u,'setting','translation_azure_budget','update',
        'Azure daily '+daily+' / monthly '+monthly)
    ]);
    return json(await translationProvidersStatus(env));
  }
  if(req.method!=='POST')fail(405,'method_not_allowed');
  const b=await body(req),reason=textField(b.reason,1,2000,'reason');
  if(path==='/api/admin/content'){
    const type=b.type==='comment'?'comment':'topic',table=type==='topic'?'topics':'comments',c=await one(env.DB,`SELECT * FROM ${table} WHERE id=?`,b.id);if(!c)fail(404,'not_found');
    if(!['publish','hide','delete'].includes(b.action))fail(400,'invalid_action');
    if(c.status==='deleted')fail(409,'content_deleted');
    const writes=[];
    if(b.action==='delete'){requireRole(u,true);writes.push(...purge(env.DB,type,c.id));}
    else writes.push(stmt(env.DB,`UPDATE ${table} SET status=?,updated_at=? WHERE id=?`,b.action==='publish'?'published':'hidden',now(),c.id));
    writes.push(audit(env,u,type,c.id,b.action,reason));
    // Moderation publication of a progress update also delivers the requested follow notifications once.
    if(b.action==='publish'&&type==='comment'&&c.status!=='published'){
      const t=await one(env.DB,'SELECT author_id FROM topics WHERE id=?',c.topic_id);
      if(t)writes.push(notify(env.DB,t.author_id,c.author_id,'topic_reply',c.topic_id,c.id,'reply:'+c.id));
      if(c.parent_comment_id){const p=await one(env.DB,'SELECT author_id FROM comments WHERE id=?',c.parent_comment_id);if(p&&p.author_id!==t?.author_id)writes.push(notify(env.DB,p.author_id,c.author_id,'comment_reply',c.topic_id,c.id,'reply:'+c.id));}
      if(c.kind==='progress')writes.push(stmt(env.DB,`INSERT OR IGNORE INTO notifications(id,recipient_id,actor_id,event_type,topic_id,comment_id,event_key) SELECT lower(hex(randomblob(16))),user_id,?,'progress_update',?,?,? FROM topic_follows WHERE topic_id=? AND user_id<>?`,c.author_id,c.topic_id,c.id,'progress:'+c.id,c.topic_id,c.author_id));
    }
    await env.DB.batch(writes);return json({ok:true});
  }
  if(path==='/api/admin/sanctions'){
    const target=await one(env.DB,'SELECT id FROM users WHERE id=?',b.user_id);if(!target)fail(404,'not_found');
    const roles=await all(env.DB,'SELECT role FROM user_roles WHERE user_id=?',target.id);if(target.id===u.id||roles.some(r=>r.role==='admin')||(u.role==='moderator'&&roles.some(r=>r.role==='moderator')))fail(403,'forbidden');
    if(b.action==='lift'){
      const s=await one(env.DB,'SELECT * FROM user_sanctions WHERE id=? AND user_id=?',b.sanction_id,target.id);if(!s)fail(404,'not_found');if(s.sanction_type==='ban')requireRole(u,true);
      await env.DB.batch([stmt(env.DB,'UPDATE user_sanctions SET lifted_at=? WHERE id=?',now(),s.id),audit(env,u,'user',target.id,'lift_sanction',reason)]);return json({ok:true});
    }
    if(b.action==='ban')requireRole(u,true);else if(b.action!=='mute'||![1,3,7,30].includes(Number(b.days)))fail(400,'invalid_sanction');
    await env.DB.batch([stmt(env.DB,'INSERT INTO user_sanctions(id,user_id,sanction_type,ends_at,actor_id,reason) VALUES(?,?,?,?,?,?)',id(),target.id,b.action,b.action==='ban'?null:now()+Number(b.days)*86400,u.id,reason),audit(env,u,'user',target.id,b.action,reason)]);return json({ok:true});
  }
  if(path==='/api/admin/roles'){
    requireRole(u,true);if(b.user_id===u.id)fail(403,'cannot_change_own_role');if(!await one(env.DB,"SELECT 1 FROM users WHERE id=? AND status='active'",b.user_id))fail(404,'not_found');
    await env.DB.batch([b.enabled===true?stmt(env.DB,"INSERT OR IGNORE INTO user_roles(user_id,role,granted_by) VALUES(?,'moderator',?)",b.user_id,u.id):stmt(env.DB,"DELETE FROM user_roles WHERE user_id=? AND role='moderator'",b.user_id),audit(env,u,'role',b.user_id,b.enabled?'grant_moderator':'revoke_moderator',reason)]);return json({ok:true});
  }
  if(path==='/api/admin/resolve'){
    const type=b.type==='appeal'?'appeal':'report',table=type==='appeal'?'appeals':'reports';if(!['resolved','rejected','reviewing'].includes(b.status))fail(400,'invalid_status');if(!await one(env.DB,`SELECT id FROM ${table} WHERE id=?`,b.id))fail(404,'not_found');
    await env.DB.batch([stmt(env.DB,`UPDATE ${table} SET status=?,updated_at=? WHERE id=?`,b.status,now(),b.id),audit(env,u,type,b.id,b.status,reason)]);return json({ok:true});
  }
  if(path==='/api/admin/taxonomy'){
    requireRole(u,true);const termId=b.id||id();if(!['category','body_part','symptom','treatment'].includes(b.term_type))fail(400,'invalid_term_type');
    const slug=textField(b.slug,1,80,'slug');if(!/^[a-z0-9-]+$/.test(slug))fail(400,'invalid_slug');
    const writes=[stmt(env.DB,`INSERT INTO taxonomy_terms(id,term_type,slug,is_active) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET slug=excluded.slug,is_active=excluded.is_active`,termId,b.term_type,slug,b.active===false?0:1)];
    if(!b.labels||typeof b.labels!=='object')fail(400,'invalid_labels');for(const [locale,label] of Object.entries(b.labels)){if(!locales.includes(locale))continue;const text=textField(label,1,120,'label');writes.push(stmt(env.DB,'INSERT OR REPLACE INTO taxonomy_labels VALUES(?,?,?)',termId,locale,text));}
    if(Array.isArray(b.aliases)){if(b.aliases.length>60)fail(400,'too_many_aliases');writes.push(stmt(env.DB,'DELETE FROM taxonomy_aliases WHERE term_id=?',termId));for(const a of b.aliases){const text=textField(a,1,100,'alias').normalize('NFKC').toLowerCase();writes.push(stmt(env.DB,'INSERT OR IGNORE INTO taxonomy_aliases VALUES(?,?,\'und\',?,?)',id(),termId,text,text));}}
    writes.push(audit(env,u,'taxonomy',termId,'update',reason));await env.DB.batch(writes);return json({ok:true,id:termId});
  }
  if(path==='/api/admin/settings'){
    requireRole(u,true);if(!['translation_enabled','analytics_enabled'].includes(b.key)||!['true','false'].includes(b.value))fail(400,'setting_not_available');
    // Existing settings table is environment-specific; audit every traffic toggle.
    await env.DB.batch([stmt(env.DB,'INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',b.key,b.value),audit(env,u,'setting',b.key,'update',reason)]);return json({ok:true});
  }
  if(path==='/api/admin/privacy'){
    requireRole(u,true);const request=await one(env.DB,'SELECT * FROM privacy_requests WHERE id=?',b.id);if(!request)fail(404,'not_found');
    if(!['processing','resolved','rejected','fulfill'].includes(b.status))fail(400,'invalid_status');
    if(request.status==='resolved'||request.status==='rejected')fail(409,'request_already_handled');
    const writes:D1PreparedStatement[]=[];
    if(b.status==='fulfill'){
      if(request.request_type==='data_export')fail(400,'use_account_export');
      const uid=request.user_id;
      const roles=await all(env.DB,'SELECT role FROM user_roles WHERE user_id=?',uid);
      if(uid===u.id||roles.some(r=>r.role==='admin'))fail(403,'owner_review_required');
      // Erase only this person's text; keep stable IDs and other participants' replies.
      writes.push(stmt(env.DB,"UPDATE topics SET title=NULL,body=NULL,status='deleted',deleted_at=?,updated_at=?,content_version=content_version+1 WHERE author_id=? AND status<>'deleted'",now(),now(),uid));
      writes.push(stmt(env.DB,"UPDATE comments SET body=NULL,status='deleted',deleted_at=?,updated_at=?,content_version=content_version+1 WHERE author_id=? AND status<>'deleted'",now(),now(),uid));
      writes.push(stmt(env.DB,'DELETE FROM notifications WHERE recipient_id=? OR actor_id=?',uid,uid),stmt(env.DB,'DELETE FROM bookmarks WHERE user_id=?',uid),stmt(env.DB,'DELETE FROM topic_follows WHERE user_id=?',uid),stmt(env.DB,'DELETE FROM topic_likes WHERE user_id=?',uid),stmt(env.DB,'DELETE FROM comment_likes WHERE user_id=?',uid),stmt(env.DB,"UPDATE reports SET detail=NULL WHERE reporter_id=?",uid),stmt(env.DB,"UPDATE appeals SET reason='[removed at user request]' WHERE appellant_id=?",uid));
      if(request.request_type==='account_delete')writes.push(stmt(env.DB,'DELETE FROM auth_identities WHERE user_id=?',uid),stmt(env.DB,'DELETE FROM user_sessions WHERE user_id=?',uid),stmt(env.DB,'DELETE FROM user_roles WHERE user_id=?',uid),stmt(env.DB,"UPDATE users SET nickname='Deleted member',public_region=NULL,preferred_locale='en',status='deleted',updated_at=? WHERE id=?",now(),uid));
      else writes.push(stmt(env.DB,'UPDATE users SET public_region=NULL,updated_at=? WHERE id=?',now(),uid));
    }
    if(b.status==='resolved'&&request.request_type!=='data_export')fail(400,'fulfill_deletion_request_first');
    const status=b.status==='fulfill'?'resolved':b.status;
    writes.push(stmt(env.DB,'UPDATE privacy_requests SET status=?,resolved_at=?,handled_by=? WHERE id=?',status,status==='processing'?null:now(),u.id,b.id),audit(env,u,'privacy',b.id,b.status,reason));
    await env.DB.batch(writes);return json({ok:true});
  }
  fail(404,'not_found');
}

