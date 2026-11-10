// Validate and update the in-memory comment list without triggering a page render.
export function applyReplyResult(state,result,editing=false){
 const c=result?.comment;
 if(!c||typeof c.id!=='string'||!c.id||c.topic_id!==state.topic?.id||!Number.isSafeInteger(result.reply_count)||result.reply_count<0||
   (result.id!==undefined&&result.id!==c.id)||!['published','pending_review','blocked','hidden'].includes(c.status))throw new Error('invalid_comment_response');
 const at=state.comments.findIndex(item=>item.id===c.id);
 if(editing&&at<0)throw new Error('comment_not_loaded');
 if(at<0)state.comments.push(c);else state.comments[at]=c;
 state.topic.reply_count=result.reply_count;
 if(c.kind==='progress'){
  const previous=state.progress||[];
  const next=previous.filter(p=>p.id!==c.id);
  if(c.status==='published')next.push({id:c.id,body:c.body,source_lang:c.source_lang,source_lang_mode:c.source_lang_mode,content_version:c.content_version,progress_seq:c.progress_seq,created_at:c.created_at});
  state.progress=next.sort((a,b)=>b.progress_seq-a.progress_seq).slice(0,2);
 }
 return {comment:c,insert:at<0};
}
