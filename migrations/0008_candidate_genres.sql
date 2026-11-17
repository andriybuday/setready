ALTER TABLE tour_candidates ADD COLUMN genres_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE tour_candidates ADD COLUMN is_heavy_metal INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_candidates_metal_status ON tour_candidates(is_heavy_metal DESC, status, score DESC);
