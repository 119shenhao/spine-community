-- Apply only to local/preview during development. Never run against production without approval.
ALTER TABLE users ADD COLUMN is_system INTEGER NOT NULL DEFAULT 0 CHECK(is_system IN (0,1));
INSERT INTO users(id,nickname,preferred_locale,is_system)
VALUES('system-unknown-import','未知用户','zh-CN',1);

-- System authors have no identity, session or administrative role, even if a code path tries to add one.
CREATE TRIGGER system_identity_insert BEFORE INSERT ON auth_identities
WHEN (SELECT is_system FROM users WHERE id=NEW.user_id)=1
BEGIN SELECT RAISE(ABORT,'system_account_cannot_login'); END;
CREATE TRIGGER system_identity_update BEFORE UPDATE OF user_id ON auth_identities
WHEN (SELECT is_system FROM users WHERE id=NEW.user_id)=1
BEGIN SELECT RAISE(ABORT,'system_account_cannot_login'); END;
CREATE TRIGGER system_session_insert BEFORE INSERT ON user_sessions
WHEN (SELECT is_system FROM users WHERE id=NEW.user_id)=1
BEGIN SELECT RAISE(ABORT,'system_account_cannot_login'); END;
CREATE TRIGGER system_session_update BEFORE UPDATE OF user_id ON user_sessions
WHEN (SELECT is_system FROM users WHERE id=NEW.user_id)=1
BEGIN SELECT RAISE(ABORT,'system_account_cannot_login'); END;
CREATE TRIGGER system_role_insert BEFORE INSERT ON user_roles
WHEN (SELECT is_system FROM users WHERE id=NEW.user_id)=1
BEGIN SELECT RAISE(ABORT,'system_account_cannot_be_admin'); END;
CREATE TRIGGER system_role_update BEFORE UPDATE OF user_id ON user_roles
WHEN (SELECT is_system FROM users WHERE id=NEW.user_id)=1
BEGIN SELECT RAISE(ABORT,'system_account_cannot_be_admin'); END;

-- Only request hashes and returned IDs/statuses; no external author/source identifiers or copied bodies.
CREATE TABLE import_batches (
 request_hash TEXT PRIMARY KEY,
 result_json TEXT NOT NULL,
 created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
