// Keep like, bookmark and follow controls in sync without rebuilding the page.
export function applyInteractionResult(state, action, type, id, result, buttons, icon, translate) {
  if (typeof result?.active !== 'boolean' || (action === 'like' && (!Number.isSafeInteger(result.like_count) || result.like_count < 0))) {
    throw new Error('invalid_interaction_response');
  }
  const active = result.active;
  const values = [state.topic, ...(state.comments || []), ...(state.feed || [])];
  for (const item of values) {
    if (!item || item.id !== id || Boolean(item.topic_id) !== (type === 'comment')) continue;
    if (action === 'like') {
      item.liked = active;
      item.like_count = result.like_count;
    } else if (action === 'bookmark') {
      item.bookmarked = active;
    } else if (action === 'follow') {
      item.followed = active;
    }
  }
  for (const button of buttons) {
    if (button.dataset.action !== action || button.dataset.type !== type || button.dataset.id !== id) continue;
    button.dataset.active = String(active);
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
    if (action === 'like') {
      const count = button.querySelector('[data-like-count]');
      if (count) count.textContent = String(result.like_count);
    } else {
      button.innerHTML = icon(action === 'bookmark' ? 'bookmark' : 'follow') +
        translate(action === 'bookmark' ? (active ? 'bookmarked' : 'bookmark') : (active ? 'followed' : 'follow'));
    }
  }
}
