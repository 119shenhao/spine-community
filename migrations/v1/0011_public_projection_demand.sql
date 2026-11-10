-- One row per specifically requested page. Legacy reserved ranges remain in
-- public_projection.last_object so that any already published key is scrubbed.
CREATE TABLE public_projection_demand (
  scope TEXT NOT NULL,
  target TEXT NOT NULL,
  object_index INTEGER NOT NULL CHECK(object_index>=1),
  reserved INTEGER NOT NULL DEFAULT 0 CHECK(reserved IN (0,1)),
  pending INTEGER NOT NULL DEFAULT 1 CHECK(pending IN (0,1)),
  attempts INTEGER NOT NULL DEFAULT 0,
  due_at INTEGER NOT NULL DEFAULT (unixepoch()),
  last_error TEXT,
  PRIMARY KEY(scope,target,object_index),
  FOREIGN KEY(scope,target) REFERENCES public_projection(scope,target) ON DELETE CASCADE
);
CREATE INDEX public_projection_demand_due
ON public_projection_demand(due_at,scope,target,object_index) WHERE pending=1;
CREATE INDEX public_projection_demand_reserved
ON public_projection_demand(scope,target,object_index) WHERE reserved=1;

-- A title edit can remove personal information just like a body edit.
DROP TRIGGER public_projection_topic_update;
CREATE TRIGGER public_projection_topic_update AFTER UPDATE OF title,body,source_lang,status,content_version,author_id,created_at ON topics
WHEN (OLD.status IN ('published','deleted') OR NEW.status IN ('published','deleted'))
  AND (OLD.title IS NOT NEW.title OR OLD.body IS NOT NEW.body OR OLD.source_lang IS NOT NEW.source_lang
    OR OLD.status IS NOT NEW.status OR OLD.content_version IS NOT NEW.content_version
    OR OLD.author_id IS NOT NEW.author_id OR OLD.created_at IS NOT NEW.created_at)
BEGIN
  INSERT INTO public_projection_invalidate SELECT 'topic',NEW.id,
    CASE WHEN OLD.status='published' AND (NEW.status<>'published' OR OLD.body IS NOT NEW.body OR OLD.title IS NOT NEW.title)
      THEN 2 ELSE 1 END;
  INSERT INTO public_projection_invalidate SELECT 'feed','latest',
    CASE WHEN OLD.status='published' AND (NEW.status<>'published' OR OLD.body IS NOT NEW.body OR OLD.title IS NOT NEW.title)
      THEN 2 ELSE 1 END WHERE OLD.status='published' OR NEW.status='published';
END;
