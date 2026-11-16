-- Daily YouTube API usage ledger, keyed by Pacific calendar date
-- (YouTube quotas reset at midnight Pacific).
CREATE TABLE youtube_quota_ledger (
  pacific_date TEXT PRIMARY KEY,
  search_used INTEGER NOT NULL DEFAULT 0,
  units_used INTEGER NOT NULL DEFAULT 0,
  tours_published INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
