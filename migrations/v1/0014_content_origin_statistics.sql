-- Content provenance is independent of display names and parent thread source.
-- Existing import/sync writers exclusively use this non-login system ID.
CREATE TABLE content_origins (
 content_type TEXT NOT NULL CHECK(content_type IN ('topic','comment')),
 content_id TEXT NOT NULL,
 source TEXT NOT NULL CHECK(source IN ('imported','user','unknown')),
 entered_at INTEGER,
 evidence TEXT NOT NULL,
 PRIMARY KEY(content_type,content_id)
);
CREATE INDEX idx_content_origins_entered ON content_origins(entered_at,content_type,source);
INSERT INTO content_origins
 SELECT 'topic',c.id,CASE WHEN c.author_id='system-unknown-import' AND u.is_system=1 THEN 'imported'
 WHEN u.is_system=0 THEN 'user' ELSE 'unknown' END,
 CASE WHEN u.is_system=0 THEN c.created_at ELSE NULL END,'legacy-writer-contract'
 FROM topics c JOIN users u ON u.id=c.author_id;
INSERT INTO content_origins
 SELECT 'comment',c.id,CASE WHEN c.author_id='system-unknown-import' AND u.is_system=1 THEN 'imported'
 WHEN u.is_system=0 THEN 'user' ELSE 'unknown' END,
 CASE WHEN u.is_system=0 THEN c.created_at ELSE NULL END,'legacy-writer-contract'
 FROM comments c JOIN users u ON u.id=c.author_id;
-- Only successful first imports provide a trustworthy local insertion date.
UPDATE content_origins SET entered_at=(
 SELECT min(b.created_at) FROM import_batches b,json_each(b.result_json,'$.results') r
 WHERE json_extract(r.value,'$.type')=content_type AND json_extract(r.value,'$.id')=content_id
 AND COALESCE(json_extract(r.value,'$.skipped'),0)=0
),evidence='import-batch'
WHERE source='imported' AND EXISTS(
 SELECT 1 FROM import_batches b,json_each(b.result_json,'$.results') r
 WHERE json_extract(r.value,'$.type')=content_type AND json_extract(r.value,'$.id')=content_id
 AND COALESCE(json_extract(r.value,'$.skipped'),0)=0);
UPDATE content_origins SET entered_at=(SELECT min(s.completed_at) FROM collect_sources s
 WHERE s.topic_id=content_id AND s.state='completed' AND s.completed_duplicate=0),evidence='collection-receipt'
 WHERE content_type='topic' AND source='imported' AND entered_at IS NULL AND EXISTS(
 SELECT 1 FROM collect_sources s WHERE s.topic_id=content_id AND s.state='completed'
 AND s.completed_duplicate=0 AND s.completed_at IS NOT NULL);
-- Replies can be added after a thread's collection; never infer their date from its parent.
-- The trigger covers unchanged, verified sync scripts as well as application writers.
CREATE TRIGGER content_origin_topic_insert AFTER INSERT ON topics
BEGIN
 INSERT INTO content_origins(content_type,content_id,source,entered_at,evidence)
 SELECT 'topic',NEW.id,CASE WHEN NEW.author_id='system-unknown-import' AND is_system=1 THEN 'imported'
 WHEN is_system=0 THEN 'user' ELSE 'unknown' END,unixepoch(),'writer-contract-v1'
 FROM users WHERE id=NEW.author_id;
END;
-- The trigger covers unchanged, verified sync scripts as well as application writers.
CREATE TRIGGER content_origin_comment_insert AFTER INSERT ON comments
BEGIN
 INSERT INTO content_origins(content_type,content_id,source,entered_at,evidence)
 SELECT 'comment',NEW.id,CASE WHEN NEW.author_id='system-unknown-import' AND is_system=1 THEN 'imported'
 WHEN is_system=0 THEN 'user' ELSE 'unknown' END,unixepoch(),'writer-contract-v1'
 FROM users WHERE id=NEW.author_id;
END;
