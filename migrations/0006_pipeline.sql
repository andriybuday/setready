-- Auto-discovery pipeline candidates: one row per prospective tour
-- (headliner + band set), moving discovered -> qualified/rejected ->
-- built -> published.
CREATE TABLE tour_candidates (
  id INTEGER PRIMARY KEY,
  candidate_key TEXT NOT NULL UNIQUE,
  headliner TEXT NOT NULL,
  tour_name TEXT NOT NULL DEFAULT '',
  bands_json TEXT NOT NULL DEFAULT '[]',
  first_date TEXT NOT NULL,
  last_date TEXT NOT NULL,
  events_count INTEGER NOT NULL DEFAULT 0,
  countries_count INTEGER NOT NULL DEFAULT 0,
  score INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'discovered'
    CHECK (status IN ('discovered', 'qualified', 'rejected', 'built', 'published', 'failed')),
  reason TEXT,
  tour_id INTEGER REFERENCES tours(id),
  show_slug TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_candidates_status_score ON tour_candidates(status, score DESC);
