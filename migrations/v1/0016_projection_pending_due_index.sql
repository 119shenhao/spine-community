-- Keep on-demand public projection queue polling inexpensive when no task is due.
-- The existing priority-first index is retained for selecting ready work;
-- this partial due-time index specifically accelerates idle-queue probes.
CREATE INDEX IF NOT EXISTS idx_public_projection_pending_due
ON public_projection(due_at,lease_until) WHERE state='pending';
