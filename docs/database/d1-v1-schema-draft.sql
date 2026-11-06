-- Spine Community / Cloudflare D1 v1 schema DRAFT.
-- NOT a migration. Do not run against production or overwrite migrations/0001_initial.sql.
-- Design record: docs/database/d1-v1-design.md
-- All timestamps are UTC Unix seconds. All IDs are opaque server-generated TEXT.
-- Version 2026-11-06; technical review and isolated D1 validation required.

PRAGMA foreign_keys = ON;

-- Accounts, Google identity, sessions and roles
CREATE TABLE users (
 id TEXT PRIMARY KEY,
 nickname TEXT NOT NULL CHECK (length(nickname) BETWEEN 1 AND 80),
 preferred_locale TEXT NOT NULL DEFAULT 'en',
 public_region TEXT,
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','banned','deleted')),
 created_at INTEGER NOT NULL DEFAULT (unixepoch()),
 updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE auth_identities (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 provider TEXT NOT NULL,
 provider_subject TEXT NOT NULL,
 created_at INTEGER NOT NULL DEFAULT (unixepoch()),
 UNIQUE(provider,provider_subject)
);
CREATE INDEX idx_auth_identities_user ON auth_identities(user_id);

CREATE TABLE user_sessions (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 token_hash TEXT NOT NULL UNIQUE,
 expires_at INTEGER NOT NULL,
 revoked_at INTEGER,
 created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_sessions_user_expire ON user_sessions(user_id,expires_at);

CREATE TABLE user_roles (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 role TEXT NOT NULL CHECK(role IN ('admin','moderator')),
 granted_by TEXT REFERENCES users(id) ON DELETE SET NULL,
 granted_at INTEGER NOT NULL DEFAULT (unixepoch()),
 PRIMARY KEY(user_id,role)
);

CREATE TABLE user_sanctions (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 sanction_type TEXT NOT NULL CHECK(sanction_type IN ('mute','ban')),
 starts_at INTEGER NOT NULL DEFAULT (unixepoch()),
 ends_at INTEGER,
 lifted_at INTEGER,
 actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 reason TEXT NOT NULL,
 created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_sanctions_user_active ON user_sanctions(user_id,ends_at,lifted_at);

CREATE TABLE privacy_requests (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 request_type TEXT NOT NULL CHECK(request_type IN ('account_delete','personal_data_delete','data_export')),
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','processing','resolved','rejected')),
 requested_at INTEGER NOT NULL DEFAULT (unixepoch()),
 resolved_at INTEGER,
 handled_by TEXT REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_privacy_requests_status ON privacy_requests(status,requested_at);

-- Extensible taxonomy
CREATE TABLE taxonomy_terms (
 id TEXT PRIMARY KEY,
 term_type TEXT NOT NULL CHECK(term_type IN ('category','region','symptom','treatment')),
 slug TEXT NOT NULL,
 is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
 sort_order INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL DEFAULT (unixepoch()),
 UNIQUE(term_type,slug)
);

CREATE TABLE taxonomy_labels (
 term_id TEXT NOT NULL REFERENCES taxonomy_terms(id) ON DELETE CASCADE,
 locale TEXT NOT NULL,
 label TEXT NOT NULL,
 PRIMARY KEY(term_id,locale)
);

CREATE TABLE taxonomy_aliases (
 id TEXT PRIMARY KEY,
 term_id TEXT NOT NULL REFERENCES taxonomy_terms(id) ON DELETE CASCADE,
 locale TEXT NOT NULL,
 alias TEXT NOT NULL,
 normalized_alias TEXT NOT NULL,
 UNIQUE(term_id,locale,normalized_alias)
);
CREATE INDEX idx_taxonomy_aliases_lookup ON taxonomy_aliases(locale,normalized_alias);

-- Content: source text is the authoritative original; deleted rows become empty placeholders
CREATE TABLE topics (
 id TEXT PRIMARY KEY,
 author_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 title TEXT,
 body TEXT,
 source_lang TEXT NOT NULL DEFAULT 'und',
 content_version INTEGER NOT NULL DEFAULT 1 CHECK(content_version>0),
 status TEXT NOT NULL DEFAULT 'pending_review' CHECK(status IN ('published','pending_review','blocked','hidden','deleted')),
 symptom_duration_days INTEGER CHECK(symptom_duration_days IS NULL OR symptom_duration_days>=0),
 reply_count INTEGER NOT NULL DEFAULT 0 CHECK(reply_count>=0),
 like_count INTEGER NOT NULL DEFAULT 0 CHECK(like_count>=0),
 created_at INTEGER NOT NULL DEFAULT (unixepoch()),
 updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
 deleted_at INTEGER,
 CHECK(
  (status='deleted' AND title IS NULL AND body IS NULL)
  OR
  (status<>'deleted' AND title IS NOT NULL AND body IS NOT NULL AND length(title)>0 AND length(body)>0)
 )
);
CREATE INDEX idx_topics_public_new ON topics(status,created_at DESC,id);
CREATE INDEX idx_topics_author_new ON topics(author_id,created_at DESC,id);

CREATE TABLE topic_terms (
 topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
 term_id TEXT NOT NULL REFERENCES taxonomy_terms(id) ON DELETE RESTRICT,
 PRIMARY KEY(topic_id,term_id)
);
CREATE INDEX idx_topic_terms_term ON topic_terms(term_id,topic_id);

CREATE TABLE comments (
 id TEXT PRIMARY KEY,
 topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE RESTRICT,
 author_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 parent_comment_id TEXT,
 kind TEXT NOT NULL DEFAULT 'regular' CHECK(kind IN ('regular','progress')),
 progress_seq INTEGER CHECK(progress_seq IS NULL OR progress_seq>0),
 body TEXT,
 source_lang TEXT NOT NULL DEFAULT 'und',
 content_version INTEGER NOT NULL DEFAULT 1 CHECK(content_version>0),
 status TEXT NOT NULL DEFAULT 'pending_review' CHECK(status IN ('published','pending_review','blocked','hidden','deleted')),
 like_count INTEGER NOT NULL DEFAULT 0 CHECK(like_count>=0),
 created_at INTEGER NOT NULL DEFAULT (unixepoch()),
 updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
 deleted_at INTEGER,
 UNIQUE(topic_id,id),
 FOREIGN KEY(topic_id,parent_comment_id) REFERENCES comments(topic_id,id) ON DELETE RESTRICT,
 CHECK(
  (kind='regular' AND progress_seq IS NULL)
  OR
  (kind='progress' AND progress_seq IS NOT NULL AND parent_comment_id IS NULL)
 ),
 CHECK(
  (status='deleted' AND body IS NULL)
  OR
  (status<>'deleted' AND body IS NOT NULL AND length(body)>0)
 )
);
CREATE INDEX idx_comments_topic_new ON comments(topic_id,status,created_at,id);
CREATE INDEX idx_comments_parent ON comments(parent_comment_id,created_at);
CREATE INDEX idx_comments_author ON comments(author_id,created_at DESC);
CREATE INDEX idx_comments_progress ON comments(topic_id,kind,progress_seq);
CREATE UNIQUE INDEX ux_comments_progress_seq ON comments(topic_id,progress_seq) WHERE progress_seq IS NOT NULL;

-- Separate target FKs ensure one like/account/content, and simplify deleting a like
CREATE TABLE topic_likes (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
 created_at INTEGER NOT NULL DEFAULT (unixepoch()),
 PRIMARY KEY(user_id,topic_id)
);
CREATE INDEX idx_topic_likes_topic ON topic_likes(topic_id);

CREATE TABLE comment_likes (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 comment_id TEXT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
 created_at INTEGER NOT NULL DEFAULT (unixepoch()),
 PRIMARY KEY(user_id,comment_id)
);
CREATE INDEX idx_comment_likes_comment ON comment_likes(comment_id);

CREATE TABLE bookmarks (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
 created_at INTEGER NOT NULL DEFAULT (unixepoch()),
 PRIMARY KEY(user_id,topic_id)
);
CREATE INDEX idx_bookmarks_user_new ON bookmarks(user_id,created_at DESC);

CREATE TABLE topic_follows (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
 created_at INTEGER NOT NULL DEFAULT (unixepoch()),
 PRIMARY KEY(user_id,topic_id)
);
CREATE INDEX idx_topic_follows_user_new ON topic_follows(user_id,created_at DESC);
CREATE INDEX idx_topic_follows_topic ON topic_follows(topic_id);

CREATE TABLE notifications (
 id TEXT PRIMARY KEY,
 recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
 event_type TEXT NOT NULL CHECK(event_type IN ('topic_reply','comment_reply','topic_like','comment_like','progress_update')),
 topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE RESTRICT,
 comment_id TEXT REFERENCES comments(id) ON DELETE RESTRICT,
 event_key TEXT NOT NULL,
 read_at INTEGER,
 created_at INTEGER NOT NULL DEFAULT (unixepoch()),
 UNIQUE(recipient_id,event_key)
);
CREATE INDEX idx_notifications_unread ON notifications(recipient_id,read_at,created_at DESC);

-- Translation cache, valid only when source_version matches the source content_version
CREATE TABLE topic_translations (
 topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
 locale TEXT NOT NULL,
 source_version INTEGER NOT NULL,
 title_text TEXT NOT NULL,
 body_text TEXT NOT NULL,
 provider TEXT NOT NULL,
 created_at INTEGER NOT NULL DEFAULT (unixepoch()),
 PRIMARY KEY(topic_id,locale)
);

CREATE TABLE comment_translations (
 comment_id TEXT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
 locale TEXT NOT NULL,
 source_version INTEGER NOT NULL,
 body_text TEXT NOT NULL,
 provider TEXT NOT NULL,
 created_at INTEGER NOT NULL DEFAULT (unixepoch()),
 PRIMARY KEY(comment_id,locale)
);

CREATE TABLE translation_usage_daily (
 provider TEXT NOT NULL,
 day_utc TEXT NOT NULL,
 characters INTEGER NOT NULL DEFAULT 0 CHECK(characters>=0),
 requests INTEGER NOT NULL DEFAULT 0 CHECK(requests>=0),
 PRIMARY KEY(provider,day_utc)
);

-- Reports, appeals and moderation audit
CREATE TABLE reports (
 id TEXT PRIMARY KEY,
 reporter_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 topic_id TEXT REFERENCES topics(id) ON DELETE RESTRICT,
 comment_id TEXT REFERENCES comments(id) ON DELETE RESTRICT,
 reason TEXT NOT NULL,
 detail TEXT,
 priority INTEGER NOT NULL DEFAULT 0,
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','reviewing','resolved','rejected')),
 created_at INTEGER NOT NULL DEFAULT (unixepoch()),
 updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
 CHECK((topic_id IS NOT NULL AND comment_id IS NULL) OR (topic_id IS NULL AND comment_id IS NOT NULL))
);
CREATE UNIQUE INDEX ux_active_report_topic ON reports(reporter_id,topic_id)
 WHERE topic_id IS NOT NULL AND status IN ('open','reviewing');
CREATE UNIQUE INDEX ux_active_report_comment ON reports(reporter_id,comment_id)
 WHERE comment_id IS NOT NULL AND status IN ('open','reviewing');
CREATE INDEX idx_reports_queue ON reports(status,priority DESC,created_at);

CREATE TABLE appeals (
 id TEXT PRIMARY KEY,
 appellant_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 topic_id TEXT REFERENCES topics(id) ON DELETE RESTRICT,
 comment_id TEXT REFERENCES comments(id) ON DELETE RESTRICT,
 sanction_id TEXT REFERENCES user_sanctions(id) ON DELETE RESTRICT,
 reason TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','reviewing','resolved','rejected')),
 created_at INTEGER NOT NULL DEFAULT (unixepoch()),
 updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
 CHECK(
  (CASE WHEN topic_id IS NOT NULL THEN 1 ELSE 0 END) +
  (CASE WHEN comment_id IS NOT NULL THEN 1 ELSE 0 END) +
  (CASE WHEN sanction_id IS NOT NULL THEN 1 ELSE 0 END) = 1
 )
);
CREATE INDEX idx_appeals_queue ON appeals(status,created_at);

CREATE TABLE moderation_actions (
 id TEXT PRIMARY KEY,
 actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 target_type TEXT NOT NULL CHECK(target_type IN ('topic','comment','user','role','report','appeal')),
 target_id TEXT NOT NULL,
 action TEXT NOT NULL,
 reason TEXT NOT NULL,
 created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_moderation_actions_new ON moderation_actions(created_at DESC);
CREATE INDEX idx_moderation_actions_target ON moderation_actions(target_type,target_id,created_at);

-- Aggregated metrics: not raw IP or per-view analytics logs
CREATE TABLE daily_community_metrics (
 day_utc TEXT PRIMARY KEY,
 new_users INTEGER NOT NULL DEFAULT 0 CHECK(new_users>=0),
 new_topics INTEGER NOT NULL DEFAULT 0 CHECK(new_topics>=0),
 new_comments INTEGER NOT NULL DEFAULT 0 CHECK(new_comments>=0),
 new_reports INTEGER NOT NULL DEFAULT 0 CHECK(new_reports>=0)
);

CREATE TABLE daily_traffic_metrics (
 day_utc TEXT PRIMARY KEY,
 uv_estimate INTEGER NOT NULL DEFAULT 0 CHECK(uv_estimate>=0),
 pv INTEGER NOT NULL DEFAULT 0 CHECK(pv>=0),
 peak_active_5m_estimate INTEGER NOT NULL DEFAULT 0 CHECK(peak_active_5m_estimate>=0),
 peak_hour_utc INTEGER CHECK(peak_hour_utc BETWEEN 0 AND 23),
 peak_hour_pv INTEGER NOT NULL DEFAULT 0 CHECK(peak_hour_pv>=0)
);

CREATE TABLE hourly_traffic_metrics (
 hour_start_utc INTEGER PRIMARY KEY,
 pv INTEGER NOT NULL DEFAULT 0 CHECK(pv>=0)
);

CREATE TABLE traffic_5min_metrics (
 bucket_start_utc INTEGER PRIMARY KEY,
 pv INTEGER NOT NULL DEFAULT 0 CHECK(pv>=0),
 active_visitors_estimate INTEGER NOT NULL DEFAULT 0 CHECK(active_visitors_estimate>=0)
);

-- Intentionally NOT included:
-- independent recovery journal, file/image storage, paid translation accounts,
-- raw pageview user IDs/IPs, email-password credential table, committed FTS strategy.
-- Enforce author-only progress updates, rights, status visibility and quota in trusted Worker.
