// Presentation-only protection for historical feed JSON written before the
// server switched from fixed-character previews to word-boundary excerpts.
// Never change the stored original post or its translation cache here.
export function cardPreview(row){
 const summary=typeof row?.summary==='string'?row.summary.trim():'';
 const source=summary||String(row?.body??'').slice(0,800).trim();
 if(!source)return '';
 const text=source.replace(/\s+/gu,' ').trim();
 const len=[...text].length;
 // Older feed projections used substr(body,1,260), sometimes ending in a
 // dangling Latin syllable. Drop that last fragment and show the ellipsis.
 // Newer word-safe 800-character excerpts are not modified.
 if(summary&&len>=245&&len<=270&&!/[.!?。！？…]$/u.test(text)){
   if(/[\p{Script=Latin}\p{N}]$/u.test(text)){
     const complete=text.replace(/[\p{Script=Latin}\p{M}\p{N}]+$/u,'').trimEnd();
     if(complete&&[...complete].length>=len-40)return complete+'…';
   }
   return text+'…';
 }
 return text;
}
