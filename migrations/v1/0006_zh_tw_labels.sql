-- Traditional Chinese labels for the existing categories and filters; data-only, additive.
-- Preserve any administrator-defined zh-TW labels on repeated migrations.
INSERT OR IGNORE INTO taxonomy_labels(term_id,locale,label) VALUES('neck','zh-TW','頸部與頸椎');
INSERT OR IGNORE INTO taxonomy_labels(term_id,locale,label) VALUES('lower-back','zh-TW','腰部與腰椎');
INSERT OR IGNORE INTO taxonomy_labels(term_id,locale,label) VALUES('sciatica','zh-TW','坐骨神經痛');
INSERT OR IGNORE INTO taxonomy_labels(term_id,locale,label) VALUES('numbness','zh-TW','麻木與刺痛');
INSERT OR IGNORE INTO taxonomy_labels(term_id,locale,label) VALUES('sitting','zh-TW','久坐疼痛');
INSERT OR IGNORE INTO taxonomy_labels(term_id,locale,label) VALUES('morning-stiffness','zh-TW','早晨僵硬');
INSERT OR IGNORE INTO taxonomy_labels(term_id,locale,label) VALUES('arm-pain','zh-TW','手臂疼痛');
INSERT OR IGNORE INTO taxonomy_labels(term_id,locale,label) VALUES('physical-therapy','zh-TW','物理治療與復健訓練');
INSERT OR IGNORE INTO taxonomy_labels(term_id,locale,label) VALUES('surgery','zh-TW','手術');
INSERT OR IGNORE INTO taxonomy_labels(term_id,locale,label) VALUES('medication','zh-TW','藥物治療');
INSERT OR IGNORE INTO taxonomy_labels(term_id,locale,label) VALUES('patient-story','zh-TW','個人經歷');
