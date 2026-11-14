-- The content fingerprint alone cannot find historical rows whose hash is NULL.
-- All import/collect/sync code must still compare exact title + body for these rows.
-- An index on the bounded title (<=200 characters) lets SQLite use MULTI-INDEX OR
-- with the existing hash/primary-key indexes without indexing a 30 KB body.
CREATE INDEX IF NOT EXISTS idx_topics_exact_title ON topics(title);

-- Pending-review / blocked / hidden queues should read the newest rows first,
-- rather than walking published topics and comments. Statuses match admin.ts.
-- Keep both indexes partial to avoid entries for the overwhelmingly common
-- published and deleted content; a compound UNION ALL can merge the two streams.
CREATE INDEX IF NOT EXISTS idx_topics_moderation_recent
 ON topics(created_at DESC,id DESC)
 WHERE status IN ('pending_review','blocked','hidden');
CREATE INDEX IF NOT EXISTS idx_comments_moderation_recent
 ON comments(created_at DESC,id DESC)
 WHERE status IN ('pending_review','blocked','hidden');
