-- Rename the existing non-login import/collector system author without touching posts or identities.
-- A new migration is required because 0003_import.sql was already applied to D1 databases.
UPDATE users SET nickname='Anonymous'
WHERE id='system-unknown-import' AND is_system=1 AND nickname='未知用户';
