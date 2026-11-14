-- Materialized public content totals, user contribution ranking and daily provenance counts.
-- No data is reclassified: imported / user / unknown and entered_at remain authoritative.
-- Snapshot visibility exactly matches the legacy public statistics queries.
CREATE TABLE visible_content_index (
 content_type TEXT NOT NULL CHECK(content_type IN ('topic','comment')),
 content_id TEXT NOT NULL,
 author_id TEXT NOT NULL,
 source TEXT NOT NULL CHECK(source IN ('imported','user','unknown')),
 PRIMARY KEY(content_type,content_id)
);
INSERT INTO visible_content_index(content_type,content_id,author_id,source)
 SELECT 'topic',t.id,t.author_id,o.source FROM topics t
 JOIN content_origins o ON o.content_type='topic' AND o.content_id=t.id
 WHERE t.status='published'
 UNION ALL
 SELECT 'comment',c.id,c.author_id,o.source FROM comments c
 JOIN topics t ON t.id=c.topic_id
 JOIN content_origins o ON o.content_type='comment' AND o.content_id=c.id
 WHERE c.status='published' AND t.status IN ('published','deleted');

CREATE TABLE visible_content_totals (
 content_type TEXT NOT NULL CHECK(content_type IN ('topic','comment')),
 source TEXT NOT NULL CHECK(source IN ('imported','user','unknown')),
 n INTEGER NOT NULL DEFAULT 0 CHECK(n>=0),
 PRIMARY KEY(content_type,source)
);
INSERT INTO visible_content_totals(content_type,source,n)
 SELECT content_type,source,count(*) FROM visible_content_index GROUP BY content_type,source;

CREATE TABLE visible_contributor_totals (
 author_id TEXT PRIMARY KEY,
 posts INTEGER NOT NULL DEFAULT 0 CHECK(posts>=0),
 replies INTEGER NOT NULL DEFAULT 0 CHECK(replies>=0)
);
INSERT INTO visible_contributor_totals(author_id,posts,replies)
 SELECT author_id,sum(content_type='topic'),sum(content_type='comment')
 FROM visible_content_index WHERE source='user' GROUP BY author_id;

-- Daily numbers intentionally count provenance rows regardless of publication status,
-- as in the original 7d/30d overview query. Empty day is a NULL entered_at.
CREATE TABLE content_origin_day_totals (
 day_utc TEXT NOT NULL,
 content_type TEXT NOT NULL CHECK(content_type IN ('topic','comment')),
 source TEXT NOT NULL CHECK(source IN ('imported','user','unknown')),
 n INTEGER NOT NULL DEFAULT 0 CHECK(n>=0),
 PRIMARY KEY(day_utc,content_type,source)
);
INSERT INTO content_origin_day_totals(day_utc,content_type,source,n)
 SELECT COALESCE(date(entered_at,'unixepoch'),''),content_type,source,count(*)
 FROM content_origins GROUP BY COALESCE(date(entered_at,'unixepoch'),''),content_type,source;

CREATE TRIGGER visible_content_add AFTER INSERT ON visible_content_index BEGIN
 INSERT INTO visible_content_totals(content_type,source,n)
 VALUES(NEW.content_type,NEW.source,1)
 ON CONFLICT(content_type,source) DO UPDATE SET n=n+1;
 INSERT INTO visible_contributor_totals(author_id,posts,replies)
 SELECT NEW.author_id,(NEW.content_type='topic'),(NEW.content_type='comment')
 WHERE NEW.source='user'
 ON CONFLICT(author_id) DO UPDATE SET
 posts=posts+excluded.posts,replies=replies+excluded.replies;
END;
CREATE TRIGGER visible_content_remove AFTER DELETE ON visible_content_index BEGIN
 UPDATE visible_content_totals SET n=n-1
 WHERE content_type=OLD.content_type AND source=OLD.source;
 UPDATE visible_contributor_totals SET
 posts=posts-(OLD.content_type='topic'), replies=replies-(OLD.content_type='comment')
 WHERE OLD.source='user' AND author_id=OLD.author_id;
END;
CREATE TRIGGER visible_content_reclassify AFTER UPDATE OF author_id,source ON visible_content_index
WHEN OLD.author_id IS NOT NEW.author_id OR OLD.source IS NOT NEW.source
BEGIN
 UPDATE visible_content_totals SET n=n-1
 WHERE content_type=OLD.content_type AND source=OLD.source;
 UPDATE visible_contributor_totals SET
 posts=posts-(OLD.content_type='topic'), replies=replies-(OLD.content_type='comment')
 WHERE OLD.source='user' AND author_id=OLD.author_id;
 INSERT INTO visible_content_totals(content_type,source,n)
 VALUES(NEW.content_type,NEW.source,1)
 ON CONFLICT(content_type,source) DO UPDATE SET n=n+1;
 INSERT INTO visible_contributor_totals(author_id,posts,replies)
 SELECT NEW.author_id,(NEW.content_type='topic'),(NEW.content_type='comment')
 WHERE NEW.source='user'
 ON CONFLICT(author_id) DO UPDATE SET
 posts=posts+excluded.posts,replies=replies+excluded.replies;
END;

-- Insert and later re-dating of provenance are both automatically accounted for.
-- This includes bulk imports and collector backfills that write D1 directly.
CREATE TRIGGER origin_daily_add AFTER INSERT ON content_origins BEGIN
 INSERT INTO content_origin_day_totals(day_utc,content_type,source,n)
 VALUES(COALESCE(date(NEW.entered_at,'unixepoch'),''),NEW.content_type,NEW.source,1)
 ON CONFLICT(day_utc,content_type,source) DO UPDATE SET n=n+1;
 INSERT INTO visible_content_index(content_type,content_id,author_id,source)
 SELECT 'topic',t.id,t.author_id,NEW.source FROM topics t
 WHERE NEW.content_type='topic' AND t.id=NEW.content_id AND t.status='published'
 UNION ALL
 SELECT 'comment',c.id,c.author_id,NEW.source FROM comments c
 JOIN topics t ON t.id=c.topic_id
 WHERE NEW.content_type='comment' AND c.id=NEW.content_id
 AND c.status='published' AND t.status IN ('published','deleted');
END;
CREATE TRIGGER origin_daily_remove AFTER DELETE ON content_origins BEGIN
 DELETE FROM visible_content_index WHERE content_type=OLD.content_type AND content_id=OLD.content_id;
 UPDATE content_origin_day_totals SET n=n-1
 WHERE day_utc=COALESCE(date(OLD.entered_at,'unixepoch'),'')
 AND content_type=OLD.content_type AND source=OLD.source;
END;
CREATE TRIGGER origin_daily_change AFTER UPDATE OF content_type,content_id,source,entered_at ON content_origins
WHEN OLD.content_type IS NOT NEW.content_type OR OLD.content_id IS NOT NEW.content_id
 OR OLD.source IS NOT NEW.source OR OLD.entered_at IS NOT NEW.entered_at
BEGIN
 UPDATE content_origin_day_totals SET n=n-1
 WHERE day_utc=COALESCE(date(OLD.entered_at,'unixepoch'),'')
 AND content_type=OLD.content_type AND source=OLD.source;
 INSERT INTO content_origin_day_totals(day_utc,content_type,source,n)
 VALUES(COALESCE(date(NEW.entered_at,'unixepoch'),''),NEW.content_type,NEW.source,1)
 ON CONFLICT(day_utc,content_type,source) DO UPDATE SET n=n+1;
 DELETE FROM visible_content_index WHERE content_type=OLD.content_type AND content_id=OLD.content_id;
 INSERT INTO visible_content_index(content_type,content_id,author_id,source)
 SELECT 'topic',t.id,t.author_id,NEW.source FROM topics t
 WHERE NEW.content_type='topic' AND t.id=NEW.content_id AND t.status='published'
 UNION ALL
 SELECT 'comment',c.id,c.author_id,NEW.source FROM comments c
 JOIN topics t ON t.id=c.topic_id
 WHERE NEW.content_type='comment' AND c.id=NEW.content_id
 AND c.status='published' AND t.status IN ('published','deleted');
END;

CREATE TRIGGER visible_topic_status AFTER UPDATE OF status ON topics
WHEN OLD.status IS NOT NEW.status
BEGIN
 DELETE FROM visible_content_index WHERE content_type='topic' AND content_id=NEW.id;
 INSERT INTO visible_content_index(content_type,content_id,author_id,source)
 SELECT 'topic',NEW.id,NEW.author_id,o.source FROM content_origins o
 WHERE NEW.status='published' AND o.content_type='topic' AND o.content_id=NEW.id;
 -- Replies remain public when a parent is marked deleted, but not when hidden.
 DELETE FROM visible_content_index WHERE content_type='comment'
 AND ((OLD.status IN ('published','deleted')) <> (NEW.status IN ('published','deleted')))
 AND content_id IN (SELECT id FROM comments WHERE topic_id=NEW.id);
 INSERT INTO visible_content_index(content_type,content_id,author_id,source)
 SELECT 'comment',c.id,c.author_id,o.source FROM comments c
 JOIN content_origins o ON o.content_type='comment' AND o.content_id=c.id
 WHERE ((OLD.status IN ('published','deleted')) <> (NEW.status IN ('published','deleted')))
 AND NEW.status IN ('published','deleted') AND c.topic_id=NEW.id AND c.status='published';
END;
CREATE TRIGGER visible_topic_author AFTER UPDATE OF author_id ON topics
WHEN OLD.author_id IS NOT NEW.author_id BEGIN
 UPDATE visible_content_index SET author_id=NEW.author_id
 WHERE content_type='topic' AND content_id=NEW.id;
END;
CREATE TRIGGER visible_topic_delete AFTER DELETE ON topics BEGIN
 DELETE FROM visible_content_index WHERE content_type='topic' AND content_id=OLD.id;
 DELETE FROM visible_content_index WHERE content_type='comment'
 AND content_id IN (SELECT id FROM comments WHERE topic_id=OLD.id);
END;
CREATE TRIGGER visible_comment_change AFTER UPDATE OF status,author_id,topic_id ON comments
WHEN OLD.status IS NOT NEW.status OR OLD.author_id IS NOT NEW.author_id
 OR OLD.topic_id IS NOT NEW.topic_id
BEGIN
 DELETE FROM visible_content_index WHERE content_type='comment' AND content_id=NEW.id;
 INSERT INTO visible_content_index(content_type,content_id,author_id,source)
 SELECT 'comment',NEW.id,NEW.author_id,o.source FROM content_origins o
 JOIN topics t ON t.id=NEW.topic_id
 WHERE NEW.status='published' AND t.status IN ('published','deleted')
 AND o.content_type='comment' AND o.content_id=NEW.id;
END;
CREATE TRIGGER visible_comment_delete AFTER DELETE ON comments BEGIN
 DELETE FROM visible_content_index WHERE content_type='comment' AND content_id=OLD.id;
END;
