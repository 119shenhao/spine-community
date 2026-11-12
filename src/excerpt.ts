// Single source of truth for character-bounded previews across feed and translation.
// The UI subsequently applies a line clamp; this bound keeps R2 payloads small.
export const FEED_EXCERPT_LIMIT=800;
export const TRANSLATION_SUMMARY_LIMIT=260;
export function excerptText(value:string,max=FEED_EXCERPT_LIMIT,ellipsis=true):string {
  const text=String(value??'').replace(/\s+/gu,' ').trim();
  const chars=[...text];
  if(chars.length<=max)return text;
  const head=chars.slice(0,max).join('');
  const next=chars[max]||'';
  let safe=head;
  // Avoid splitting a letter/number sequence, including accented and Cyrillic words.
  // For unbroken CJK or unusually long tokens, retain the preview rather than go blank.
  if(/[\p{L}\p{N}]$/u.test(head)&&/^[\p{L}\p{N}]/u.test(next)){
    const boundary=head.replace(/[\p{L}\p{N}]+$/u,'').trimEnd();
    if(boundary)safe=boundary;
  }
  return safe.trimEnd()+(ellipsis?'…':'');
}

/** The translation cache for a summary must be invalidated when this algorithm changes. */
export const SUMMARY_TRANSLATION_REVISION=2;
export const SUMMARY_TRANSLATION_ENGINE='nmt-summary-sentence-v2';

/** Send complete sentences to Azure rather than a dangling clause or half-word. */
export function translationSummaryText(value:string,max=TRANSLATION_SUMMARY_LIMIT):string {
  const text=String(value??'').replace(/\s+/gu,' ').trim();
  if([...text].length<=max)return text;
  const head=[...text].slice(0,max).join('');
  let lastSentence=0;
  // Require punctuation to end at a word boundary, quotation mark or CJK character.
  for(const match of head.matchAll(/[.!?。！？]+(?:["'”’）)\]]*)(?=\s|$|[\p{Script=Han}])/gu))
    lastSentence=match.index!+match[0].length;
  // Avoid a summary that consists solely of an introductory abbreviation.
  if(lastSentence>=Math.min(80,Math.floor(max*.35)))
    return head.slice(0,lastSentence).trimEnd();
  return excerptText(text,max,false).replace(/[,:;\s–—-]+$/u,'').trimEnd();
}
