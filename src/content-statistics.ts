import {all,one,Row} from './core';

// Current visible totals and historical entered-at totals are incrementally
// maintained by D1 triggers. Neither admin overview nor 7d/30d calls scan
// the full content_origins, topics or comments tables.
export async function contentStatistics(db:D1Database,days:number){
 const totals=await all(db,`SELECT content_type,source,n count
   FROM visible_content_totals WHERE n>0`);
 const current:Row={topics:0,comments:0,imported_topics:0,imported_comments:0,
   user_topics:0,user_comments:0,unknown_topics:0,unknown_comments:0};
 for(const r of totals){
   const key=r.content_type==='topic'?'topics':'comments';
   current[key]+=r.count;current[r.source+'_'+key]+=r.count;
 }
 const daily=await all(db,`SELECT day_utc,
   sum(CASE WHEN content_type='topic' THEN n ELSE 0 END) new_topics,
   sum(CASE WHEN content_type='comment' THEN n ELSE 0 END) new_comments,
   sum(CASE WHEN content_type='topic' AND source='imported' THEN n ELSE 0 END) imported_topics,
   sum(CASE WHEN content_type='comment' AND source='imported' THEN n ELSE 0 END) imported_comments,
   sum(CASE WHEN content_type='topic' AND source='user' THEN n ELSE 0 END) user_topics,
   sum(CASE WHEN content_type='comment' AND source='user' THEN n ELSE 0 END) user_comments,
   sum(CASE WHEN content_type='topic' AND source='unknown' THEN n ELSE 0 END) unknown_topics,
   sum(CASE WHEN content_type='comment' AND source='unknown' THEN n ELSE 0 END) unknown_comments
   FROM content_origin_day_totals
   WHERE day_utc>=date('now',?) AND day_utc<date('now','+1 day')
   GROUP BY day_utc`, '-'+(days-1)+' days');
 const undated=await one(db,`SELECT
   sum(CASE WHEN content_type='topic' THEN n ELSE 0 END) topics,
   sum(CASE WHEN content_type='comment' THEN n ELSE 0 END) comments
   FROM content_origin_day_totals WHERE day_utc=''`);
 return {current,daily,undated:{topics:undated?.topics||0,comments:undated?.comments||0}};
}
