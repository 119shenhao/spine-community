-- An invalidation and the D1 write that caused it always commit together.
-- One row per topic plus one for the standard latest feed. Index 1 is also
-- the detail/first reply page. last_object reserves keys before R2 writes.
CREATE TABLE public_projection (
  scope TEXT NOT NULL CHECK(scope IN ('topic','feed')),
  target TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  published_version INTEGER NOT NULL DEFAULT 0,
  next_object INTEGER NOT NULL DEFAULT 1,
  last_object INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','done','dead')),
  priority INTEGER NOT NULL DEFAULT 1,
  attempts INTEGER NOT NULL DEFAULT 0,
  due_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  lease TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  PRIMARY KEY(scope,target)
);
CREATE INDEX public_projection_due ON public_projection(state,priority DESC,due_at,updated_at,scope,target);
CREATE VIEW public_projection_invalidate AS
SELECT scope,target,priority FROM public_projection WHERE 0;
CREATE TRIGGER public_projection_invalidate_write INSTEAD OF INSERT ON public_projection_invalidate
BEGIN
  INSERT INTO public_projection(scope,target,priority,due_at)
  VALUES(NEW.scope,NEW.target,NEW.priority,unixepoch()+CASE WHEN NEW.priority=0 THEN 120 ELSE 0 END)
  ON CONFLICT(scope,target) DO UPDATE SET
    version=version+1, next_object=1, state='pending', updated_at=unixepoch(),
    priority=CASE WHEN state='pending' THEN max(priority,excluded.priority) ELSE excluded.priority END,
    due_at=CASE WHEN state='pending' AND attempts>0 AND excluded.priority<=priority THEN due_at
      WHEN state='pending' THEN min(due_at,excluded.due_at) ELSE excluded.due_at END,
    attempts=CASE WHEN state='pending' AND excluded.priority<=priority THEN attempts ELSE 0 END;
END;

INSERT INTO public_projection(scope,target) VALUES('feed','latest');
INSERT INTO public_projection(scope,target)
SELECT 'topic',id FROM topics WHERE status IN ('published','deleted');

CREATE TRIGGER public_projection_topic_insert AFTER INSERT ON topics
WHEN NEW.status IN ('published','deleted')
BEGIN
  INSERT INTO public_projection_invalidate SELECT 'topic',NEW.id,1 WHERE 1;
  INSERT INTO public_projection_invalidate SELECT 'feed','latest',1 WHERE NEW.status='published';
END;

CREATE TRIGGER public_projection_topic_update AFTER UPDATE OF title,body,source_lang,status,content_version,author_id,created_at ON topics
WHEN (OLD.status IN ('published','deleted') OR NEW.status IN ('published','deleted')) AND (OLD.title IS NOT NEW.title OR OLD.body IS NOT NEW.body OR OLD.source_lang IS NOT NEW.source_lang OR OLD.status IS NOT NEW.status OR OLD.content_version IS NOT NEW.content_version OR OLD.author_id IS NOT NEW.author_id OR OLD.created_at IS NOT NEW.created_at)
BEGIN
  INSERT INTO public_projection_invalidate SELECT 'topic',NEW.id,CASE WHEN OLD.status='published' AND (NEW.status<>'published' OR OLD.body IS NOT NEW.body) THEN 2 ELSE 1 END WHERE 1;
  INSERT INTO public_projection_invalidate SELECT 'feed','latest',CASE WHEN OLD.status='published' AND (NEW.status<>'published' OR OLD.body IS NOT NEW.body) THEN 2 ELSE 1 END WHERE OLD.status='published' OR NEW.status='published';
END;

CREATE TRIGGER public_projection_topic_delete AFTER DELETE ON topics
WHEN OLD.status IN ('published','deleted')
BEGIN
  INSERT INTO public_projection_invalidate SELECT 'topic',OLD.id,2 WHERE 1;
  INSERT INTO public_projection_invalidate SELECT 'feed','latest',2 WHERE OLD.status='published';
END;

CREATE TRIGGER public_projection_topic_reply_count AFTER UPDATE OF reply_count ON topics
WHEN NEW.status='published' AND NEW.reply_count<>OLD.reply_count
BEGIN
  INSERT INTO public_projection_invalidate SELECT 'feed','latest',CASE WHEN NEW.reply_count<OLD.reply_count THEN 2 ELSE 1 END WHERE 1;
END;

CREATE TRIGGER public_projection_topic_likes AFTER UPDATE OF like_count ON topics
WHEN NEW.status='published' AND OLD.like_count<>NEW.like_count
BEGIN
  INSERT INTO public_projection_invalidate SELECT 'topic',NEW.id,0 WHERE 1;
  INSERT INTO public_projection_invalidate SELECT 'feed','latest',0 WHERE 1;
END;

CREATE TRIGGER public_projection_comment_insert AFTER INSERT ON comments
WHEN NEW.status IN ('published','deleted') AND EXISTS(SELECT 1 FROM topics WHERE id=NEW.topic_id AND status IN ('published','deleted'))
BEGIN
  INSERT INTO public_projection_invalidate SELECT 'topic',NEW.topic_id,1 WHERE 1;
END;

CREATE TRIGGER public_projection_comment_update AFTER UPDATE OF body,source_lang,status,content_version,author_id,parent_comment_id,kind,progress_seq,created_at,topic_id ON comments
WHEN (OLD.status IN ('published','deleted') OR NEW.status IN ('published','deleted')) AND (OLD.body IS NOT NEW.body OR OLD.source_lang IS NOT NEW.source_lang OR OLD.status IS NOT NEW.status OR OLD.content_version IS NOT NEW.content_version OR OLD.author_id IS NOT NEW.author_id OR OLD.parent_comment_id IS NOT NEW.parent_comment_id OR OLD.kind IS NOT NEW.kind OR OLD.progress_seq IS NOT NEW.progress_seq OR OLD.created_at IS NOT NEW.created_at OR OLD.topic_id IS NOT NEW.topic_id)
BEGIN
  INSERT INTO public_projection_invalidate SELECT 'topic',NEW.topic_id,CASE WHEN OLD.status='published' AND (NEW.status<>'published' OR OLD.body IS NOT NEW.body) THEN 2 ELSE 1 END WHERE EXISTS(SELECT 1 FROM topics WHERE id=NEW.topic_id AND status IN ('published','deleted'));
  INSERT INTO public_projection_invalidate SELECT 'topic',OLD.topic_id,2 WHERE OLD.topic_id<>NEW.topic_id AND EXISTS(SELECT 1 FROM topics WHERE id=OLD.topic_id AND status IN ('published','deleted'));
END;

CREATE TRIGGER public_projection_comment_delete AFTER DELETE ON comments
WHEN OLD.status IN ('published','deleted') AND EXISTS(SELECT 1 FROM topics WHERE id=OLD.topic_id AND status IN ('published','deleted'))
BEGIN
  INSERT INTO public_projection_invalidate SELECT 'topic',OLD.topic_id,2 WHERE 1;
END;

CREATE TRIGGER public_projection_comment_likes AFTER UPDATE OF like_count ON comments
WHEN NEW.status='published' AND OLD.like_count<>NEW.like_count AND EXISTS(SELECT 1 FROM topics WHERE id=NEW.topic_id AND status IN ('published','deleted'))
BEGIN
  INSERT INTO public_projection_invalidate SELECT 'topic',NEW.topic_id,0 WHERE 1;
END;

CREATE TRIGGER public_projection_terms_insert AFTER INSERT ON topic_terms
WHEN EXISTS(SELECT 1 FROM topics WHERE id=NEW.topic_id AND status='published')
BEGIN
  INSERT INTO public_projection_invalidate SELECT 'topic',NEW.topic_id,1 WHERE 1;
  INSERT INTO public_projection_invalidate SELECT 'feed','latest',1 WHERE 1;
END;

CREATE TRIGGER public_projection_terms_delete AFTER DELETE ON topic_terms
WHEN EXISTS(SELECT 1 FROM topics WHERE id=OLD.topic_id AND status='published')
BEGIN
  INSERT INTO public_projection_invalidate SELECT 'topic',OLD.topic_id,1 WHERE 1;
  INSERT INTO public_projection_invalidate SELECT 'feed','latest',1 WHERE 1;
END;

CREATE TRIGGER public_projection_terms_update AFTER UPDATE OF topic_id,term_id ON topic_terms
WHEN OLD.topic_id IS NOT NEW.topic_id OR OLD.term_id IS NOT NEW.term_id
BEGIN
  INSERT INTO public_projection_invalidate SELECT 'topic',OLD.topic_id,1 WHERE EXISTS(SELECT 1 FROM topics WHERE id=OLD.topic_id AND status='published');
  INSERT INTO public_projection_invalidate SELECT 'topic',NEW.topic_id,1 WHERE EXISTS(SELECT 1 FROM topics WHERE id=NEW.topic_id AND status='published');
  INSERT INTO public_projection_invalidate SELECT 'feed','latest',1 WHERE EXISTS(SELECT 1 FROM topics WHERE id IN (OLD.topic_id,NEW.topic_id) AND status='published');
END;

CREATE TRIGGER public_projection_profile AFTER UPDATE OF nickname,public_region ON users
WHEN OLD.nickname IS NOT NEW.nickname OR OLD.public_region IS NOT NEW.public_region
BEGIN
  INSERT INTO public_projection_invalidate
  SELECT 'topic',id,2 FROM topics WHERE author_id=NEW.id AND status='published'
  UNION
  SELECT 'topic',c.topic_id,2 FROM comments c JOIN topics t ON t.id=c.topic_id
  WHERE OLD.nickname IS NOT NEW.nickname AND c.author_id=NEW.id AND c.status='published' AND t.status IN ('published','deleted');
  INSERT INTO public_projection_invalidate SELECT 'feed','latest',2 WHERE EXISTS(SELECT 1 FROM topics WHERE author_id=NEW.id AND status='published');
END;

CREATE TRIGGER public_projection_taxonomy_type AFTER UPDATE OF term_type ON taxonomy_terms
WHEN OLD.term_type IS NOT NEW.term_type
BEGIN
  INSERT INTO public_projection_invalidate
  SELECT 'topic',t.id,1 FROM topic_terms tt JOIN topics t ON t.id=tt.topic_id
  WHERE tt.term_id=NEW.id AND t.status='published';
  INSERT INTO public_projection_invalidate SELECT 'feed','latest',1
  WHERE EXISTS(SELECT 1 FROM topic_terms tt JOIN topics t ON t.id=tt.topic_id
    WHERE tt.term_id=NEW.id AND t.status='published');
END;
