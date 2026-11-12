-- Recover only replies created within a proven local first-collection transaction.
-- Sync does not copy collect_sources; never use source creation dates without this evidence.
UPDATE content_origins SET entered_at=(
 SELECT c.created_at FROM comments c WHERE c.id=content_id
),evidence='collection-reply-window'
WHERE content_type='comment' AND source='imported' AND entered_at IS NULL
AND EXISTS (
 SELECT 1 FROM comments c JOIN collect_sources s ON s.topic_id=c.topic_id
 WHERE c.id=content_id AND s.state='completed' AND s.completed_duplicate=0
 AND s.claimed_at IS NOT NULL AND s.completed_at IS NOT NULL
 AND c.created_at BETWEEN s.claimed_at AND s.completed_at
);

