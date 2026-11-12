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
