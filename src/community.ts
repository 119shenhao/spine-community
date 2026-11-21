import {Env,Row,all,one,stmt,now,id,fail,json,body,textField,lang,locales,requireUser,writable,rate,hash,randomToken,cookie,safeUser,analyticsEnabled} from './core';
import {getContent,decorate,purge,notify} from './content';
import {excerptText,FEED_EXCERPT_LIMIT} from './excerpt';
import {identityLoginConfig} from './auth';
export async function communityRoute(req:Request,env:Env,u:Row|null,path:string):Promise<Response|null>{
  const method=req.method,url=new URL(req.url);
  if(path==='/api/me'&&method==='GET')return json({user:safeUser(u),googleConfigured:Boolean(env.GOOGLE_CLIENT_ID&&env.GOOGLE_CLIENT_SECRET),identityConfigured:Boolean(identityLoginConfig(env,url.origin)),imageUploadsEnabled:false});
  if(path==='/api/me'&&method==='PATCH'){
    const user=requireUser(u),b=await body(req),nickname=textField(b.nickname,1,80,'nickname');
     const mode=b.preferred_locale==='auto'?'auto':'manual';
     const locale=mode==='auto'?user.preferred_locale:lang(b.preferred_locale);
     if(!locales.includes(locale))fail(400,'invalid_locale');
    const region=typeof b.public_region==='string'?b.public_region.trim().slice(0,80):null;
    await stmt(env.DB,'UPDATE users SET nickname=?,preferred_locale=?,preferred_locale_mode=?,public_region=?,updated_at=? WHERE id=?',nickname,locale,mode,region,now(),user.id).run();return json({ok:true});
  }
  if(path==='/api/me/content'&&method==='GET'){
    const user=requireUser(u),kind=url.searchParams.get('kind')||'topics',offset=Math.max(0,Math.min(10000,Number(url.searchParams.get('offset'))||0));
    if(!['topics','comments','bookmarks','follows'].includes(kind))fail(400,'invalid_list');
    let rows:Row[];
    if(kind==='comments')rows=await all(env.DB,`SELECT c.*,u.nickname FROM comments c JOIN users u ON u.id=c.author_id WHERE c.author_id=? ORDER BY c.created_at DESC,c.id DESC LIMIT 21 OFFSET ?`,user.id,offset);
    else rows=await all(env.DB,`SELECT t.*,u.nickname,u.public_region FROM topics t JOIN users u ON u.id=t.author_id ${kind==='bookmarks'?'JOIN bookmarks x ON x.topic_id=t.id':kind==='follows'?'JOIN topic_follows x ON x.topic_id=t.id':''} WHERE ${kind==='topics'?'t.author_id=?':"x.user_id=? AND t.status IN ('published','deleted')"} ORDER BY ${kind==='topics'?'t.created_at':'x.created_at'} DESC,t.id DESC LIMIT 21 OFFSET ?`,user.id,offset);
    const next=rows.length>20?offset+20:null;rows=rows.slice(0,20);await decorate(env,rows,u,kind==='comments'?'comment':'topic');
    for(const r of rows)if(r.status==='deleted'){r.title=null;r.body=null;}else if(kind!=='comments'){r.summary=excerptText(r.body,FEED_EXCERPT_LIMIT);delete r.body;}
    return json({items:rows,next});
  }
  if(path==='/api/notifications'&&method==='GET'){
    const user=requireUser(u);
    const visibility=`n.recipient_id=? AND t.status IN ('published','deleted') AND (n.comment_id IS NULL OR c.status IN ('published','deleted'))`;
    const items=await all(env.DB,`SELECT n.*,a.nickname actor_name FROM notifications n JOIN topics t ON t.id=n.topic_id LEFT JOIN comments c ON c.id=n.comment_id LEFT JOIN users a ON a.id=n.actor_id WHERE ${visibility} ORDER BY n.created_at DESC,n.id DESC LIMIT 100`,user.id);
    const total=await one(env.DB,`SELECT count(*) count FROM notifications n JOIN topics t ON t.id=n.topic_id LEFT JOIN comments c ON c.id=n.comment_id WHERE ${visibility} AND n.read_at IS NULL`,user.id);
    const grouped:Row[]=[];for(const n of items){const k=n.event_type.endsWith('_like')?`${n.event_type}:${n.topic_id}:${n.comment_id}:${Math.floor(n.created_at/600)}`:n.id;let g=grouped.find(g=>g.key===k);if(g){g.ids.push(n.id);g.count++;g.unread||=!n.read_at;}else grouped.push({...n,key:k,ids:[n.id],count:1,unread:!n.read_at});}
    return json({items:grouped,unread:total?.count||0});
  }
  if(path==='/api/notifications/read'&&method==='POST'){
    const user=requireUser(u),b=await body(req);if(b.all===true)await stmt(env.DB,'UPDATE notifications SET read_at=? WHERE recipient_id=? AND read_at IS NULL',now(),user.id).run();
    else{if(!Array.isArray(b.ids)||b.ids.length>100||b.ids.some((x:unknown)=>typeof x!=='string'))fail(400,'invalid_notifications');await env.DB.batch(b.ids.map((n:string)=>stmt(env.DB,'UPDATE notifications SET read_at=? WHERE recipient_id=? AND id=?',now(),user.id,n)));}
    return json({ok:true});
  }
  if(path==='/api/reports'&&method==='POST'){
    const user=await writable(env.DB,u);await rate(env.DB,'report:'+user.id,10,3600);const b=await body(req),type=b.type==='comment'?'comment':'topic',content=await getContent(env,type,b.id,user);
    const reason=textField(b.reason,1,120,'reason'),detail=typeof b.detail==='string'?b.detail.slice(0,2000):'';
    const key=type==='topic'?'topic_id':'comment_id';
    if(await one(env.DB,`SELECT id FROM reports WHERE reporter_id=? AND ${key}=? AND status IN ('open','reviewing')`,user.id,content.id))fail(409,'already_reported');
    await env.DB.batch([stmt(env.DB,`INSERT INTO reports(id,reporter_id,${key},reason,detail,priority) VALUES(?,?,?,?,?,?)`,id(),user.id,content.id,reason,detail,['privacy','scam','harmful'].includes(reason)?1:0),stmt(env.DB,"INSERT INTO daily_community_metrics(day_utc,new_reports) VALUES(date('now'),1) ON CONFLICT(day_utc) DO UPDATE SET new_reports=new_reports+1")]);return json({ok:true},201);
  }
  if(path==='/api/appeals'&&method==='POST'){
    const user=requireUser(u);await rate(env.DB,'appeal:'+user.id,5,86400);const b=await body(req),reason=textField(b.reason,1,2000,'reason');
    const type=b.type==='comment'?'comment':b.type==='sanction'?'sanction':'topic';
    const c=type==='sanction'?await one(env.DB,'SELECT user_id author_id FROM user_sanctions WHERE id=?',b.id):await getContent(env,type,b.id,user);
    if(!c||c.author_id!==user.id)fail(403,'forbidden');
    await stmt(env.DB,`INSERT INTO appeals(id,appellant_id,${type}_id,reason) VALUES(?,?,?,?)`,id(),user.id,b.id,reason).run();return json({ok:true},201);
  }
  if(path==='/api/privacy-requests'&&method==='GET'){return json({items:await all(env.DB,'SELECT id,request_type,status,requested_at FROM privacy_requests WHERE user_id=? ORDER BY requested_at DESC',requireUser(u).id)});}
  if(path==='/api/privacy-requests'&&method==='POST'){
    const user=requireUser(u);await rate(env.DB,'privacy:'+user.id,3,86400);const b=await body(req);if(!['account_delete','personal_data_delete','data_export'].includes(b.type))fail(400,'invalid_request');
    await stmt(env.DB,'INSERT INTO privacy_requests(id,user_id,request_type) VALUES(?,?,?)',id(),user.id,b.type).run();return json({ok:true},201);
  }
  if(path==='/api/me/export'&&method==='GET'){
    const user=requireUser(u);return json({profile:safeUser(user),topics:await all(env.DB,'SELECT id,title,body,source_lang,status,created_at FROM topics WHERE author_id=?',user.id),comments:await all(env.DB,'SELECT id,topic_id,body,source_lang,status,created_at FROM comments WHERE author_id=?',user.id)},200,{'content-disposition':'attachment; filename="my-spine-community-data.json"'});
  }
  if(path==='/api/pageview'&&method==='POST'){
    const agent=req.headers.get('user-agent')||'';if(/bot|spider|crawl|headless/i.test(agent))return json({ok:true,recorded:false});
    const b=await body(req);if(typeof b.path!=='string'||b.path.length>300)fail(400,'invalid_pageview');
    if(!await analyticsEnabled(env.DB))return json({ok:true,recorded:false,reason:'analytics_disabled'});
    let token=cookie(req,'sc_visitor');if(!/^[A-Za-z0-9_-]{43}$/.test(token))token=randomToken();
    // A cryptographically random 256-bit cookie is the secret; a daily hash prevents stored cross-day identifiers.
    const day=new Date().toISOString().slice(0,10),visitor=await hash('spine-traffic-v1:'+day+':'+token);
    await rate(env.DB,'pv:'+visitor,300,86400);await rate(env.DB,'pv-global:'+day,10000,86400);
    const seen=await one(env.DB,'SELECT 1 FROM traffic_visitors WHERE day_utc=? AND visitor_hash=?',day,visitor),hour=Math.floor(now()/3600)*3600;
    await env.DB.batch([
      stmt(env.DB,`INSERT INTO traffic_visitors VALUES(?,?,?) ON CONFLICT(day_utc,visitor_hash) DO UPDATE SET last_seen=excluded.last_seen`,day,visitor,now()),
      stmt(env.DB,`INSERT INTO hourly_traffic_metrics VALUES(?,1) ON CONFLICT(hour_start_utc) DO UPDATE SET pv=pv+1`,hour),
      stmt(env.DB,`INSERT INTO daily_traffic_metrics(day_utc,uv_estimate,pv,peak_active_5m_estimate,peak_hour_utc,peak_hour_pv) VALUES(?,?,1,1,?,1) ON CONFLICT(day_utc) DO UPDATE SET uv_estimate=(SELECT count(*) FROM traffic_visitors WHERE day_utc=?),pv=pv+1,peak_active_5m_estimate=MAX(peak_active_5m_estimate,(SELECT count(*) FROM traffic_visitors WHERE day_utc=? AND last_seen>=?)),peak_hour_utc=CASE WHEN (SELECT pv FROM hourly_traffic_metrics WHERE hour_start_utc=?)>peak_hour_pv THEN ? ELSE peak_hour_utc END,peak_hour_pv=MAX(peak_hour_pv,(SELECT pv FROM hourly_traffic_metrics WHERE hour_start_utc=?))`,day,seen?0:1,Math.floor(hour/3600)%24,day,day,now()-300,hour,Math.floor(hour/3600)%24,hour)
    ]);
    return json({ok:true,recorded:true},200,{'set-cookie':`sc_visitor=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400${url.protocol==='https:'?'; Secure':''}`});
  }
  return null;
}
