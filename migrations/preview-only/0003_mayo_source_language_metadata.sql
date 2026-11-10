-- Additive preview-only migration: original-language metadata for Mayo long-thread staging.
-- Existing source_lang columns in 0002 were constrained to 'en'; they are kept
-- as legacy internal placeholders to avoid rebuilding tables with pending leases.
-- Public topics/comments MUST use the new fields, never the legacy placeholders.
-- Existing staged rows stay valid: en hints from legacy stages and und for
-- older replies whose language had not been independently checked.
ALTER TABLE collector_mayo_stage ADD COLUMN source_hint_lang TEXT NOT NULL DEFAULT 'en'
 CHECK(source_hint_lang='und' OR (length(source_hint_lang) BETWEEN 2 AND 25));
ALTER TABLE collector_mayo_comments ADD COLUMN detected_lang TEXT NOT NULL DEFAULT 'und'
 CHECK(detected_lang='und' OR (length(detected_lang) BETWEEN 2 AND 25));
