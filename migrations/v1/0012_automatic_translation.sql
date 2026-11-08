-- Existing content versions remain the cache identity. Legacy labels are
-- hints until independently detected or explicitly confirmed by the author.
ALTER TABLE topics ADD COLUMN source_lang_mode TEXT NOT NULL DEFAULT 'legacy' CHECK(source_lang_mode IN ('legacy','auto','manual'));
ALTER TABLE comments ADD COLUMN source_lang_mode TEXT NOT NULL DEFAULT 'legacy' CHECK(source_lang_mode IN ('legacy','auto','manual'));

ALTER TABLE topic_translations ADD COLUMN source_language TEXT NOT NULL DEFAULT 'und';
ALTER TABLE topic_translations ADD COLUMN product_id TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE topic_translations ADD COLUMN engine_type TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE topic_translations ADD COLUMN model_id TEXT;
ALTER TABLE topic_translations ADD COLUMN model_version TEXT;
ALTER TABLE topic_translations ADD COLUMN projection_token TEXT;
ALTER TABLE topic_translations ADD COLUMN projection_key TEXT;
-- A progress teaser can be translated independently of a full reply.
DROP TRIGGER comment_cache_update;
ALTER TABLE comment_translations RENAME TO previous_comment_translations;
CREATE TABLE comment_translations (
  comment_id TEXT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  locale TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'full' CHECK(scope IN ('full','preview')),
  source_version INTEGER NOT NULL,
  body_text TEXT NOT NULL,
  provider TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  source_language TEXT NOT NULL DEFAULT 'und',
  product_id TEXT NOT NULL DEFAULT 'unknown',
  engine_type TEXT NOT NULL DEFAULT 'unknown',
  model_id TEXT,
  model_version TEXT,
  projection_token TEXT,
  projection_key TEXT,
  PRIMARY KEY(comment_id,locale,scope)
);
INSERT INTO comment_translations(comment_id,locale,source_version,body_text,provider,created_at)
  SELECT comment_id,locale,source_version,body_text,provider,created_at FROM previous_comment_translations;
DROP TABLE previous_comment_translations;
CREATE TRIGGER comment_cache_update AFTER UPDATE OF body,status,content_version,source_lang,source_lang_mode,topic_id ON comments BEGIN
  DELETE FROM comment_translations WHERE comment_id=NEW.id;
END;

ALTER TABLE translation_jobs ADD COLUMN lease_token TEXT;
ALTER TABLE translation_budget ADD COLUMN provider_blocked_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE translation_budget ADD COLUMN cooldown_until INTEGER NOT NULL DEFAULT 0;
ALTER TABLE translation_budget ADD COLUMN reservation_chars INTEGER NOT NULL DEFAULT 0;
ALTER TABLE translation_usage_daily ADD COLUMN metered_characters INTEGER NOT NULL DEFAULT 0 CHECK(metered_characters>=0);

-- Updating the budget and counting the reservation must be atomic, including
-- timeouts or failures with unknown billable usage.
CREATE TRIGGER translation_budget_record AFTER UPDATE OF reservation_chars ON translation_budget
WHEN NEW.reservation_chars>0 BEGIN
  INSERT INTO translation_usage_daily(provider,day_utc,characters,requests)
  VALUES('azure',NEW.day_utc,NEW.reservation_chars,1)
  ON CONFLICT(provider,day_utc) DO UPDATE SET characters=characters+excluded.characters,requests=requests+1;
END;

CREATE TRIGGER translation_topic_language_update AFTER UPDATE OF source_lang,source_lang_mode ON topics
WHEN OLD.source_lang IS NOT NEW.source_lang OR OLD.source_lang_mode IS NOT NEW.source_lang_mode BEGIN
  DELETE FROM topic_translations WHERE topic_id=NEW.id;
END;
CREATE TRIGGER translation_topic_revoke AFTER UPDATE OF status ON topics
WHEN OLD.status IN ('published','deleted') AND NEW.status NOT IN ('published','deleted') BEGIN
  DELETE FROM comment_translations WHERE comment_id IN (SELECT id FROM comments WHERE topic_id=NEW.id);
  DELETE FROM translation_jobs WHERE content_type='comment' AND content_id IN (SELECT id FROM comments WHERE topic_id=NEW.id);
END;
CREATE TRIGGER translation_topic_lease_revoke AFTER UPDATE OF title,body,status,source_lang,source_lang_mode,content_version ON topics
WHEN OLD.status IS NOT NEW.status OR OLD.title IS NOT NEW.title OR OLD.body IS NOT NEW.body
  OR OLD.source_lang IS NOT NEW.source_lang OR OLD.source_lang_mode IS NOT NEW.source_lang_mode
  OR OLD.content_version<>NEW.content_version BEGIN
  DELETE FROM translation_jobs WHERE content_type='topic' AND content_id=NEW.id;
END;
CREATE TRIGGER translation_comment_lease_revoke AFTER UPDATE OF body,status,source_lang,source_lang_mode,content_version,topic_id ON comments
WHEN OLD.status IS NOT NEW.status OR OLD.body IS NOT NEW.body OR OLD.topic_id IS NOT NEW.topic_id
  OR OLD.source_lang IS NOT NEW.source_lang OR OLD.source_lang_mode IS NOT NEW.source_lang_mode
  OR OLD.content_version<>NEW.content_version BEGIN
  DELETE FROM translation_jobs WHERE content_type='comment' AND content_id=NEW.id;
END;

-- Coalesce enrichment requests even when the same page is being written.
ALTER TABLE public_projection_demand ADD COLUMN refresh_translations INTEGER NOT NULL DEFAULT 0 CHECK(refresh_translations IN (0,1));
