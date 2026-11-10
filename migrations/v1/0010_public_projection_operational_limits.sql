-- Keep transient failures under backoff, and leave exhausted tasks visible
-- until an owner retries them or a higher-priority withdrawal arrives.
DROP TRIGGER public_projection_invalidate_write;
CREATE TRIGGER public_projection_invalidate_write INSTEAD OF INSERT ON public_projection_invalidate
BEGIN
  INSERT INTO public_projection(scope,target,priority,due_at)
  VALUES(NEW.scope,NEW.target,NEW.priority,unixepoch()+CASE WHEN NEW.priority=0 THEN 120 ELSE 0 END)
  ON CONFLICT(scope,target) DO UPDATE SET
    version=version+1, next_object=1, updated_at=unixepoch(),
    state=CASE WHEN state='dead' AND excluded.priority<=priority THEN 'dead' ELSE 'pending' END,
    priority=CASE WHEN state IN ('pending','dead') THEN max(priority,excluded.priority) ELSE excluded.priority END,
    due_at=CASE WHEN state IN ('pending','dead') AND attempts>0 AND excluded.priority<=priority THEN due_at
      WHEN state='pending' THEN min(due_at,excluded.due_at) ELSE excluded.due_at END,
    attempts=CASE WHEN state IN ('pending','dead') AND excluded.priority<=priority THEN attempts ELSE 0 END;
END;

-- Repeated progress reads are independent of the number of checked objects.
ALTER TABLE public_projection_scan ADD COLUMN checked_count INTEGER NOT NULL DEFAULT 0;
UPDATE public_projection_scan SET checked_count=(
  SELECT count(*) FROM public_projection_scan_item
  WHERE scan_id=public_projection_scan.id AND expected_version IS NOT NULL AND result IS NOT NULL
);
CREATE TABLE public_projection_scan_count (
  scan_id TEXT NOT NULL REFERENCES public_projection_scan(id) ON DELETE CASCADE,
  result TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY(scan_id,result)
);
INSERT INTO public_projection_scan_count(scan_id,result,count)
SELECT scan_id,result,count(*) FROM public_projection_scan_item WHERE result IS NOT NULL GROUP BY scan_id,result;

CREATE TRIGGER public_projection_scan_count_result AFTER UPDATE OF result ON public_projection_scan_item
WHEN OLD.result IS NOT NEW.result
BEGIN
  UPDATE public_projection_scan SET checked_count=checked_count+1
  WHERE id=NEW.scan_id AND OLD.result IS NULL AND NEW.result IS NOT NULL AND NEW.expected_version IS NOT NULL;
  UPDATE public_projection_scan_count SET count=count-1 WHERE scan_id=OLD.scan_id AND result=OLD.result;
  INSERT INTO public_projection_scan_count
  SELECT NEW.scan_id,NEW.result,1 WHERE NEW.result IS NOT NULL
  ON CONFLICT(scan_id,result) DO UPDATE SET count=count+1;
END;
CREATE INDEX public_projection_scan_exceptions ON public_projection_scan_item(scan_id,object_key)
  WHERE result IS NOT NULL AND result NOT IN ('ok','ignored');
CREATE INDEX public_projection_scan_targets ON public_projection_scan_item(scan_id,scope,target);
