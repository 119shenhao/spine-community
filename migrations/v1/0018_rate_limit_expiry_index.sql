-- Expiration cleanup must use a narrow range scan, not the whole rate_limits table.
CREATE INDEX IF NOT EXISTS idx_rate_limits_expires ON rate_limits(expires_at);
