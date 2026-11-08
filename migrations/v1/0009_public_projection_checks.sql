CREATE TABLE public_projection_scan (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  environment TEXT NOT NULL,
  target TEXT,
  batch_size INTEGER NOT NULL,
  include_orphans INTEGER NOT NULL,
  deep INTEGER NOT NULL,
  phase TEXT NOT NULL DEFAULT 'listing',
  paused INTEGER NOT NULL DEFAULT 0,
  prefix_index INTEGER NOT NULL DEFAULT 0,
  cursor TEXT,
  expected_count INTEGER NOT NULL DEFAULT 0,
  listed_count INTEGER NOT NULL DEFAULT 0,
  lease TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  error TEXT
);
CREATE UNIQUE INDEX public_projection_scan_active ON public_projection_scan(environment)
  WHERE phase IN ('listing','comparing');
CREATE TABLE public_projection_scan_item (
  scan_id TEXT NOT NULL REFERENCES public_projection_scan(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL,
  scope TEXT NOT NULL,
  target TEXT NOT NULL,
  object_index INTEGER NOT NULL,
  expected_version INTEGER,
  expected_hash TEXT,
  r2_version INTEGER,
  r2_hash TEXT,
  result TEXT,
  repair_version INTEGER,
  PRIMARY KEY(scan_id,object_key)
);
CREATE INDEX public_projection_scan_results ON public_projection_scan_item(scan_id,result,object_key);
