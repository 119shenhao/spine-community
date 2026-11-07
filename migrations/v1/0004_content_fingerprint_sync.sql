-- Preview-only during development. Production requires an explicitly approved migration.
-- NULL means a legacy/unbackfilled topic; new writes populate SHA-256.
ALTER TABLE topics ADD COLUMN content_hash TEXT CHECK(content_hash IS NULL OR length(content_hash)=64);
CREATE UNIQUE INDEX ux_topics_content_hash ON topics(content_hash) WHERE content_hash IS NOT NULL;

-- A receipt is written in the preview DB only AFTER the whole source thread is
-- verified in production. Its presence permanently excludes later replies.
CREATE TABLE topic_sync_receipts (
 source_topic_id TEXT PRIMARY KEY REFERENCES topics(id) ON DELETE CASCADE,
 production_topic_id TEXT NOT NULL,
 content_hash TEXT NOT NULL CHECK(length(content_hash)=64),
 transferred_comments INTEGER NOT NULL DEFAULT 0 CHECK(transferred_comments>=0),
 synced_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_topic_sync_receipts_synced ON topic_sync_receipts(synced_at);
