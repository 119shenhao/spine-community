-- One-time targeted cleanup of exactly one successfully verified E2E test topic.
-- Executes only on preview D1 via the guarded Cloudflare build (no production access).
-- Do not use a wildcard or delete any ordinary user content.
DELETE FROM collect_sources
 WHERE topic_id='99e0bb7d-8936-44d6-8d92-e5b5ce59dbd2' AND ((site='reddit' AND source_id='1vfpqgs') OR (site='e2e' AND source_id='ci-42331899579-1'));
UPDATE comments SET parent_comment_id=NULL
 WHERE topic_id='99e0bb7d-8936-44d6-8d92-e5b5ce59dbd2'
 AND EXISTS (SELECT 1 FROM topics WHERE id='99e0bb7d-8936-44d6-8d92-e5b5ce59dbd2' AND author_id='system-unknown-import' AND title='[E2E TEST 42331899579-1] Public back-pain thread collection pipeline');
DELETE FROM comments
 WHERE topic_id='99e0bb7d-8936-44d6-8d92-e5b5ce59dbd2' AND author_id='system-unknown-import'
 AND EXISTS (SELECT 1 FROM topics WHERE id='99e0bb7d-8936-44d6-8d92-e5b5ce59dbd2' AND author_id='system-unknown-import' AND title='[E2E TEST 42331899579-1] Public back-pain thread collection pipeline');
DELETE FROM topics_search WHERE topic_id='99e0bb7d-8936-44d6-8d92-e5b5ce59dbd2'
 AND EXISTS (SELECT 1 FROM topics WHERE id='99e0bb7d-8936-44d6-8d92-e5b5ce59dbd2' AND author_id='system-unknown-import' AND title='[E2E TEST 42331899579-1] Public back-pain thread collection pipeline');
DELETE FROM topics
 WHERE id='99e0bb7d-8936-44d6-8d92-e5b5ce59dbd2' AND author_id='system-unknown-import' AND title='[E2E TEST 42331899579-1] Public back-pain thread collection pipeline';
-- changes() is 1 only if the precisely matched test topic was deleted just above.
UPDATE daily_community_metrics
 SET new_topics=MAX(0,new_topics-(CASE WHEN changes()=1 THEN 1 ELSE 0 END)),
     new_comments=MAX(0,new_comments-(CASE WHEN changes()=1 THEN 3 ELSE 0 END))
 WHERE day_utc='2026-11-07';
