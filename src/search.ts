import {Env,Row,all,stmt,fail,json,rate} from './core';
import {excerptText,FEED_EXCERPT_LIMIT} from './excerpt';
import {decorate} from './content';
export async function searchRoute(req:Request,env:Env,u:Row|null,path:string):Promise<Response|null>{
  if(!['/api/topics','/api/search'].includes(path)||req.method!=='GET')return null;
  const url=new URL(req.url),q=(url.searchParams.get('q')||'').trim().normalize('NFKC').toLowerCase();if(q.length>120)fail(400,'query_too_long');
  const filters=['body_part','symptom','treatment','category'].map(k=>[k,url.searchParams.get(k)||'']);
  const aliases=q?await all(env.DB,'SELECT term_id,normalized_alias FROM taxonomy_aliases WHERE instr(?,normalized_alias)>0',q):[];
  const concepts=[...new Set(aliases.map(a=>a.term_id))];
  const duration=url.searchParams.get('duration')||'';if(!['','acute','subacute','chronic'].includes(duration))fail(400,'invalid_duration');
  const sort=url.searchParams.get('sort')||'relevant';if(!['relevant','latest','discussion'].includes(sort))fail(400,'invalid_sort');
  const offset=Math.max(0,Math.min(10000,Number(url.searchParams.get('offset'))||0));
  const base:string[]=["t.status='published'"],args:any[]=[];
  let match='1',score='0',scoreArgs:any[]=[];
  const fts=q.match(/[\p{L}\p{N}]+/gu)?.filter(x=>x.length>1).slice(0,10).map(x=>'"'+x.replaceAll('"','')+'"*').join(' OR ')||'';
  if(q){
    const conditions=['instr(lower(t.title),?)>0','instr(lower(t.body),?)>0'];args.push(q,q);
    score='(CASE WHEN instr(lower(t.title),?)>0 THEN 12 ELSE 0 END)+(CASE WHEN instr(lower(t.body),?)>0 THEN 3 ELSE 0 END)';scoreArgs.push(q,q);
    if(fts){conditions.push('t.id IN (SELECT topic_id FROM topics_search WHERE topics_search MATCH ?)');args.push(fts);}
    if(concepts.length){
      const marks=concepts.map(()=>'?').join(',');
      const c=`(EXISTS(SELECT 1 FROM topic_terms tt WHERE tt.topic_id=t.id AND tt.term_id IN (${marks})) OR EXISTS(SELECT 1 FROM taxonomy_aliases a WHERE a.term_id IN (${marks}) AND instr(lower(t.title||' '||t.body),a.normalized_alias)>0))`;
      conditions.push(c);args.push(...concepts,...concepts);score+=`+(CASE WHEN ${c} THEN 8 ELSE 0 END)`;scoreArgs.push(...concepts,...concepts);
    }
    match='('+conditions.join(' OR ')+')';base.push(match);
  }
  const strict=[...base],strictArgs=[...args];
  const clauses: {key:string;sql:string;args:any[]}[]=[];
  for(const [key,value] of filters)if(value){clauses.push({key,sql:`(EXISTS(SELECT 1 FROM topic_terms tt JOIN taxonomy_terms tx ON tx.id=tt.term_id WHERE tt.topic_id=t.id AND tx.term_type=? AND tx.id=?) OR EXISTS(SELECT 1 FROM taxonomy_aliases a JOIN taxonomy_terms tx ON tx.id=a.term_id WHERE tx.term_type=? AND tx.id=? AND instr(lower(t.title||' '||t.body),a.normalized_alias)>0))`,args:[key,value,key,value]});}
  if(duration)clauses.push({key:'duration',sql:duration==='acute'?'t.symptom_duration_days<42':duration==='subacute'?'t.symptom_duration_days BETWEEN 42 AND 89':'t.symptom_duration_days>=90',args:[]});
  for(const c of clauses){strict.push(c.sql);strictArgs.push(...c.args);}
  const order=sort==='latest'?'t.created_at DESC,t.id DESC':sort==='discussion'?'t.reply_count DESC,t.created_at DESC,t.id DESC':'score DESC,t.created_at DESC,t.id DESC';
  const select=`SELECT t.*,u.nickname,u.public_region,${score} score FROM topics t JOIN users u ON u.id=t.author_id`;
  let rows=await all(env.DB,`${select} WHERE ${strict.join(' AND ')} ORDER BY ${order} LIMIT 21 OFFSET ?`,...scoreArgs,...strictArgs,offset);
  let similar=false;
  if(rows.length===0&&offset===0&&clauses.length){
    // Relax explicitly, still require a body/symptom concept or the original keyword.
    const gate=clauses.filter(c=>['body_part','symptom'].includes(c.key));
    if(q||gate.length){const gateSql=q?'1':'('+gate.map(c=>c.sql).join(' OR ')+')';const gateArgs=q?[]:gate.flatMap(c=>c.args);
      rows=await all(env.DB,`${select} WHERE ${base.join(' AND ')} AND ${gateSql} ORDER BY ${order} LIMIT 20`,...scoreArgs,...args,...gateArgs);similar=rows.length>0;
    }
  }
  const hasMore=!similar&&rows.length>20;rows=rows.slice(0,20);await decorate(env,rows,u);
  const highlights=[q,...(concepts.length? (await all(env.DB,`SELECT normalized_alias FROM taxonomy_aliases WHERE term_id IN (${concepts.map(()=>'?').join(',')})`,...concepts)).map(a=>a.normalized_alias):[])].filter(Boolean);
  for(const row of rows){row.summary=excerptText(row.body||'',FEED_EXCERPT_LIMIT);delete row.body;
    if(similar){const inferred=await all(env.DB,"SELECT DISTINCT term_id FROM taxonomy_aliases WHERE instr(lower(?),normalized_alias)>0",row.title+' '+row.summary);const ids=[...row.terms.map((t:Row)=>t.id),...inferred.map(t=>t.term_id)];row.relaxed=filters.filter(([,v])=>v&&!ids.includes(v)).map(([k])=>k);if(duration){const d=row.symptom_duration_days;const matches=d!==null&&(duration==='acute'?d<42:duration==='subacute'?d>=42&&d<=89:d>=90);if(!matches)row.relaxed.push('duration');}}
  }
  return json({topics:rows,next:hasMore?offset+20:null,similar,highlights});
}
