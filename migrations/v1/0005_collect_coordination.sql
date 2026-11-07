-- Isolated preview collection coordination. Only store external site/id for internal deduplication.
-- Original source author, link and full HTML are never exposed as a public forum identity.
CREATE TABLE collect_sources (
 site TEXT NOT NULL CHECK(length(site) BETWEEN 2 AND 32),
 source_id TEXT NOT NULL CHECK(length(source_id) BETWEEN 1 AND 128),
 state TEXT NOT NULL CHECK(state IN ('claimed','released','completed')),
 collector_id TEXT,
 lease_token_hash TEXT,
 lease_expires_at INTEGER,
 completion_token_hash TEXT,
 topic_id TEXT REFERENCES topics(id) ON DELETE SET NULL,
 content_hash TEXT CHECK(content_hash IS NULL OR length(content_hash)=64),
 completed_duplicate INTEGER NOT NULL DEFAULT 0 CHECK(completed_duplicate IN (0,1)),
 claimed_at INTEGER,
 completed_at INTEGER,
 updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
 PRIMARY KEY(site,source_id),
 CHECK (
  (state='claimed' AND lease_token_hash IS NOT NULL AND lease_expires_at IS NOT NULL AND completion_token_hash IS NULL)
  OR (state='released' AND lease_token_hash IS NULL AND lease_expires_at IS NULL AND completion_token_hash IS NULL)
  OR (state='completed' AND lease_token_hash IS NULL AND lease_expires_at IS NULL AND completion_token_hash IS NOT NULL AND topic_id IS NOT NULL)
 )
);
CREATE INDEX idx_collect_sources_exclusions ON collect_sources(site,state,source_id,lease_expires_at);
CREATE INDEX idx_collect_sources_topic ON collect_sources(topic_id);

-- Each completion transaction starts with this guard INSERT.
-- SQLite trigger checks the current claim atomically, not an earlier application-level SELECT.
-- The guard is removed before commit; a failed transaction rolls back the guard and all content.
CREATE TABLE collect_finalize_guard (
 site TEXT NOT NULL,
 source_id TEXT NOT NULL,
 lease_token_hash TEXT NOT NULL,
 PRIMARY KEY(site,source_id)
);
CREATE TRIGGER collect_finalize_claim_check BEFORE INSERT ON collect_finalize_guard
WHEN NOT EXISTS (
 SELECT 1 FROM collect_sources
 WHERE site=NEW.site AND source_id=NEW.source_id
   AND state='claimed' AND lease_token_hash=NEW.lease_token_hash
   AND lease_expires_at>unixepoch()
)
BEGIN SELECT RAISE(ABORT,'collect_claim_invalid'); END;
