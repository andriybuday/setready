ALTER TABLE tour_candidates ADD COLUMN is_followed INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_candidates_priority ON tour_candidates(status, is_followed DESC, is_heavy_metal DESC, first_date, score DESC);
