-- Preview-only collector queue. NEVER add this file to migrations/v1 (production migrations).
CREATE TABLE IF NOT EXISTS collector_candidates (
 site TEXT NOT NULL, source_id TEXT NOT NULL, url TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','completed','rejected','retry')),
 reason TEXT, attempts INTEGER NOT NULL DEFAULT 0,
 retry_at INTEGER NOT NULL DEFAULT 0, lease_until INTEGER NOT NULL DEFAULT 0,
 updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
 PRIMARY KEY(site,source_id)
);
CREATE INDEX IF NOT EXISTS idx_collector_candidates_pick ON collector_candidates(site,status,retry_at,updated_at);
CREATE TABLE IF NOT EXISTS collector_source_state (
 site TEXT PRIMARY KEY, scan_cursor TEXT, last_scan_at INTEGER,
 updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
