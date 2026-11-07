-- One-time purge of CONTENT ONLY from the isolated spine-community-db-preview D1.
-- Do not execute this on the production DB. The build script verifies branch and DB ID.
-- Keep users (including Unknown User), identities, settings, taxonomy, and traffic data.
DELETE FROM notifications;
DELETE FROM reports;
DELETE FROM appeals WHERE topic_id IS NOT NULL OR comment_id IS NOT NULL;
DELETE FROM comment_likes;
DELETE FROM topic_likes;
DELETE FROM bookmarks;
DELETE FROM topic_follows;
DELETE FROM comment_translations;
DELETE FROM topic_translations;
DELETE FROM translation_jobs WHERE content_type IN ('topic','comment');
DELETE FROM topic_terms;
-- Break self-referential FK on replies before deleting comments.
UPDATE comments SET parent_comment_id=NULL WHERE parent_comment_id IS NOT NULL;
DELETE FROM comments;
DELETE FROM topics;
DELETE FROM topics_search;
DELETE FROM import_batches;
DELETE FROM moderation_actions WHERE target_type IN ('topic','comment');
UPDATE daily_community_metrics SET new_topics=0,new_comments=0,new_reports=0;
-- Idempotence: future builds will skip purging when marker is present.
INSERT OR IGNORE INTO settings(key,value) VALUES('preview_discussions_cleared_20261107','done');
