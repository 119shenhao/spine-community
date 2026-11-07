-- Treat an account's posting language as automatic until the user selects one.
-- Before this version, new accounts implicitly stored en; a manually selected English
-- value cannot be distinguished from that default and will now follow the UI.
ALTER TABLE users ADD COLUMN preferred_locale_mode TEXT NOT NULL DEFAULT 'auto'
 CHECK (preferred_locale_mode IN ('auto','manual'));
-- Preserve previously chosen non-English languages when upgrading existing accounts.
UPDATE users SET preferred_locale_mode='manual' WHERE preferred_locale<>'en';
