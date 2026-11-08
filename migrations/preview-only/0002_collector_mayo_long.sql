-- Preview-only staging for Mayo Clinic Connect long discussions.
-- Do NOT merge this migration into the production migration chain.
-- Contents are not visible through forum APIs until one atomic publish.
CREATE TABLE collector_mayo_stage (
 source_id TEXT PRIMARY KEY CHECK(length(source_id) BETWEEN 1 AND 128),
 expected_pages INTEGER NOT NULL CHECK(expected_pages BETWEEN 1 AND 400),
 title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
 body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 30000),
 source_lang TEXT NOT NULL DEFAULT 'en' CHECK(source_lang='en'),
 content_hash TEXT NOT NULL CHECK(length(content_hash)=64),
 created_at INTEGER NOT NULL DEFAULT (unixepoch()),
 updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE collector_mayo_pages (
 source_id TEXT NOT NULL REFERENCES collector_mayo_stage(source_id) ON DELETE CASCADE,
 page_number INTEGER NOT NULL CHECK(page_number BETWEEN 1 AND 400),
 content_hash TEXT NOT NULL CHECK(length(content_hash)=64),
 comment_count INTEGER NOT NULL CHECK(comment_count BETWEEN 1 AND 30),
 saved_at INTEGER NOT NULL DEFAULT (unixepoch()),
 PRIMARY KEY(source_id,page_number)
);
CREATE TABLE collector_mayo_comments (
 source_id TEXT NOT NULL REFERENCES collector_mayo_stage(source_id) ON DELETE CASCADE,
 source_comment_id TEXT NOT NULL CHECK(length(source_comment_id) BETWEEN 1 AND 32),
 comment_id TEXT NOT NULL UNIQUE,
 parent_source_comment_id TEXT,
 page_number INTEGER NOT NULL,
 position INTEGER NOT NULL CHECK(position BETWEEN 1 AND 30),
 body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 12000),
 source_lang TEXT NOT NULL DEFAULT 'en' CHECK(source_lang='en'),
 status TEXT NOT NULL CHECK(status IN ('published','pending_review','blocked')),
 PRIMARY KEY(source_id,source_comment_id),
 UNIQUE(source_id,page_number,position),
 FOREIGN KEY(source_id,page_number) REFERENCES collector_mayo_pages(source_id,page_number) ON DELETE CASCADE
);
CREATE INDEX idx_collector_mayo_parent ON collector_mayo_comments(source_id,parent_source_comment_id);

-- This insert is executed only after writing all final topic/comments in the same
-- D1 batch. If an incomplete publish occurs the trigger aborts the whole batch.
CREATE TABLE collector_mayo_publish_guard (
 source_id TEXT PRIMARY KEY,
 topic_id TEXT NOT NULL
);
CREATE TRIGGER collector_mayo_publish_verify BEFORE INSERT ON collector_mayo_publish_guard BEGIN
 SELECT CASE WHEN NOT EXISTS(
   SELECT 1 FROM collector_mayo_stage st
   WHERE st.source_id=NEW.source_id
     AND st.expected_pages=(SELECT COUNT(*) FROM collector_mayo_pages p WHERE p.source_id=st.source_id)
     AND (SELECT COUNT(*) FROM collector_mayo_comments sc WHERE sc.source_id=st.source_id)
       =(SELECT COALESCE(SUM(p.comment_count),0) FROM collector_mayo_pages p WHERE p.source_id=st.source_id)
     AND (SELECT COUNT(*) FROM comments c WHERE c.topic_id=NEW.topic_id)
       =(SELECT COUNT(*) FROM collector_mayo_comments sc WHERE sc.source_id=st.source_id)
     AND EXISTS(SELECT 1 FROM topics t WHERE t.id=NEW.topic_id AND t.content_hash=st.content_hash)
 ) THEN RAISE(ABORT,'mayo_publish_incomplete') END;
END;
