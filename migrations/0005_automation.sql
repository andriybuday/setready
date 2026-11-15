-- Automation bookkeeping: avoid republishing unchanged tracklists.
ALTER TABLE tours ADD COLUMN last_published_hash TEXT;
ALTER TABLE tours ADD COLUMN last_refreshed_at TEXT;
