import {all,one,Row} from './core';
// Counts content rows once; reply ancestry never multiplies a row.
export async function contentStatistics(db:D1Database,days:number){
 const totals=await all(db,`SELECT o.content_type,o.source,count(*) count
 FROM content_origins o JOIN (
 SELECT 'topic' content_type,id FROM topics WHERE status='published'
 UNION ALL SELECT 'comment',c.id FROM comments c JOIN topics t ON t.id=c.topic_id
 WHERE c.status='published' AND t.status IN ('published','deleted')
 ) c ON c.content_type=o.content_type AND c.id=o.content_id
 GROUP BY o.content_type,o.source`);
 const current:Row={topics:0,comments:0,imported_topics:0,imported_comments:0,
 user_topics:0,user_comments:0,unknown_topics:0,unknown_comments:0};
 for(const r of totals){const key=r.content_type==='topic'?'topics':'comments';current[key]+=r.count;current[r.source+'_'+key]+=r.count;}
 const daily=await all(db,`SELECT date(entered_at,'unixepoch') day_utc,
 sum(content_type='topic') new_topics,sum(content_type='comment') new_comments,
 sum(content_type='topic' AND source='imported') imported_topics,
 sum(content_type='comment' AND source='imported') imported_comments,
 sum(content_type='topic' AND source='user') user_topics,
 sum(content_type='comment' AND source='user') user_comments,
 sum(content_type='topic' AND source='unknown') unknown_topics,
 sum(content_type='comment' AND source='unknown') unknown_comments
 FROM content_origins WHERE entered_at>=unixepoch(date('now',?)) AND entered_at<unixepoch(date('now','+1 day'))
 GROUP BY day_utc`, '-'+(days-1)+' days');
 const undated=await one(db,`SELECT sum(content_type='topic') topics,sum(content_type='comment') comments
 FROM content_origins WHERE entered_at IS NULL`);
 return {current,daily,undated:{topics:undated?.topics||0,comments:undated?.comments||0}};
}
