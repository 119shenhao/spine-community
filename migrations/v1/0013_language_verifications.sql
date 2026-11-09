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
