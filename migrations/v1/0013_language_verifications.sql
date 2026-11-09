-- Language evidence is version-scoped: an old classification must never be
-- reused after the original was edited. A separate table preserves the original
-- language hints and avoids invalidating existing translation leases.
CREATE TABLE content_language_verifications (
 content_type TEXT NOT NULL CHECK(content_type IN ('topic','comment')),
 content_id TEXT NOT NULL,
 content_version INTEGER NOT NULL CHECK(content_version>=1),
 language TEXT NOT NULL,
 method TEXT NOT NULL CHECK(method IN ('tinyld-heavy','azure-auto','admin-manual')),
 score REAL CHECK(score IS NULL OR (score>=0 AND score<=1)),
 verified_at INTEGER NOT NULL DEFAULT (unixepoch()),
 PRIMARY KEY(content_type,content_id,content_version)
);
CREATE INDEX idx_content_language_verifications_lookup ON content_language_verifications(language,method);

-- The public R2 original carries the effective source language. Any newly
-- verified source triggers the existing on-demand CDN invalidation system.
CREATE TRIGGER language_verification_topic_publish AFTER INSERT ON content_language_verifications
WHEN NEW.content_type='topic' AND EXISTS(
 SELECT 1 FROM topics WHERE id=NEW.content_id AND content_version=NEW.content_version AND status='published'
) BEGIN
 INSERT INTO public_projection_invalidate SELECT 'topic',NEW.content_id,1 WHERE 1;
 INSERT INTO public_projection_invalidate SELECT 'feed','latest',1 WHERE 1;
END;
CREATE TRIGGER language_verification_comment_publish AFTER INSERT ON content_language_verifications
WHEN NEW.content_type='comment' AND EXISTS(
 SELECT 1 FROM comments WHERE id=NEW.content_id AND content_version=NEW.content_version AND status='published'
) BEGIN
 INSERT INTO public_projection_invalidate
 SELECT 'topic',topic_id,1 FROM comments WHERE id=NEW.content_id;
END;
-- Ensure deleted user content does not leave unnecessary inference metadata.
CREATE TRIGGER language_verification_topic_delete AFTER DELETE ON topics BEGIN
 DELETE FROM content_language_verifications WHERE content_type='topic' AND content_id=OLD.id;
END;
CREATE TRIGGER language_verification_comment_delete AFTER DELETE ON comments BEGIN
 DELETE FROM content_language_verifications WHERE content_type='comment' AND content_id=OLD.id;
END;

-- Remove stale evidence whenever the underlying version changes or is deleted.
CREATE TRIGGER language_verification_topic_version AFTER UPDATE OF content_version,status ON topics
WHEN OLD.content_version<>NEW.content_version OR NEW.status='deleted' BEGIN
 DELETE FROM content_language_verifications WHERE content_type='topic' AND content_id=NEW.id
  AND (content_version<>NEW.content_version OR NEW.status='deleted');
END;
CREATE TRIGGER language_verification_comment_version AFTER UPDATE OF content_version,status ON comments
WHEN OLD.content_version<>NEW.content_version OR NEW.status='deleted' BEGIN
 DELETE FROM content_language_verifications WHERE content_type='comment' AND content_id=NEW.id
  AND (content_version<>NEW.content_version OR NEW.status='deleted');
END;
