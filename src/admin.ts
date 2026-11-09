import {Env,Row,all,one,stmt,now,id,fail,json,body,textField,requireRole,locales} from './core';
import {purge,notify} from './content';
import {translationBudgetStatus} from './translation';
const audit=(env:Env,u:Row,type:string,target:string,action:string,reason:string)=>stmt(env.DB,'INSERT INTO moderation_actions(id,actor_id,target_type,target_id,action,reason) VALUES(?,?,?,?,?,?)',id(),u.id,type,target,action,reason);
export async function adminRoute(req:Request,env:Env,user:Row|null,path:string):Promise<Response|null>{
  if(!path.startsWith('/api/admin/'))return null;
  const u=requireRole(user),url=new URL(req.url);
  if(path==='/api/admin/overview'&&req.method==='GET'){
    const days=url.searchParams.get('days')==='30'?30:7;
    return json({reports:await all(env.DB,`SELECT r.*,CASE WHEN r.topic_id IS NOT NULL THEN t.title ELSE substr(c.body,1,150) END preview FROM reports r LEFT JOIN topics t ON t.id=r.topic_id LEFT JOIN comments c ON c.id=r.comment_id WHERE r.status IN ('open','reviewing') ORDER BY r.priority DESC,r.created_at LIMIT 100`),
      queue:await all(env.DB,`SELECT id,'topic' type,author_id,title,body,status,created_at FROM topics WHERE status IN ('pending_review','blocked','hidden') UNION ALL SELECT id,'comment',author_id,NULL,body,status,created_at FROM comments WHERE status IN ('pending_review','blocked','hidden') ORDER BY created_at DESC LIMIT 100`),
      appeals:await all(env.DB,"SELECT * FROM appeals WHERE status IN ('open','reviewing') ORDER BY created_at LIMIT 100"),
      logs:await all(env.DB,'SELECT m.*,u.nickname actor_name FROM moderation_actions m JOIN users u ON u.id=m.actor_id ORDER BY m.created_at DESC LIMIT 100'),
      users:u.role==='admin'?await all(env.DB,`SELECT u.id,u.nickname,u.status,COALESCE((SELECT group_concat(role) FROM user_roles r WHERE r.user_id=u.id),'member') role FROM users u ORDER BY u.created_at DESC LIMIT 100`):[],
      sanctions:await all(env.DB,`SELECT s.*,u.nickname FROM user_sanctions s JOIN users u ON u.id=s.user_id WHERE s.lifted_at IS NULL ORDER BY s.created_at DESC LIMIT 100`),
      privacy:u.role==='admin'?await all(env.DB,"SELECT p.*,u.nickname FROM privacy_requests p JOIN users u ON u.id=p.user_id WHERE p.status IN ('open','processing') ORDER BY p.requested_at LIMIT 100"):[],
      metrics:await all(env.DB,`WITH RECURSIVE days(d,n) AS(SELECT date('now'),1 UNION ALL SELECT date(d,'-1 day'),n+1 FROM days WHERE n<?) SELECT d day_utc,COALESCE(c.new_users,0) new_users,COALESCE(c.new_topics,0) new_topics,COALESCE(c.new_comments,0) new_comments,COALESCE(c.new_reports,0) new_reports,COALESCE(t.uv_estimate,0) uv_estimate,COALESCE(t.pv,0) pv,COALESCE(t.peak_active_5m_estimate,0) peak_active_5m_estimate,t.peak_hour_utc,COALESCE(t.peak_hour_pv,0) peak_hour_pv FROM days LEFT JOIN daily_community_metrics c ON c.day_utc=d LEFT JOIN daily_traffic_metrics t ON t.day_utc=d ORDER BY d DESC`,days),
      settings:u.role==='admin'?await all(env.DB,'SELECT key,value FROM settings'):[],analyticsConfigured:Boolean(env.ANALYTICS_SALT)});
  }
  if(path==='/api/admin/translation-budget'&&req.method==='GET'){
    requireRole(u,true);
    return json(await translationBudgetStatus(env));
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
    requireRole(u,true);if(b.key!=='translation_enabled'||!['true','false'].includes(b.value))fail(400,'setting_not_available');
    // Provider credentials and explicit runtime opt-in are still required; this never enables image storage.
    await env.DB.batch([stmt(env.DB,'UPDATE settings SET value=? WHERE key=?',b.value,b.key),audit(env,u,'setting',b.key,'update',reason)]);return json({ok:true});
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
