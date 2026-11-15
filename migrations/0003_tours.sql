-- Tour-level canonical playlists. A tour is one named tour with one
-- specific lineup (band set in playing order); different support
-- rotations/legs are different tours via lineup_fingerprint.
-- Dated shows link to a tour and supply its stop list.

CREATE TABLE tours (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  tour_name TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  headliner_artist_id INTEGER NOT NULL REFERENCES artists(id),
  lineup_fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tour_name, lineup_fingerprint)
);

CREATE TABLE tour_artists (
  tour_id INTEGER NOT NULL REFERENCES tours(id) ON DELETE CASCADE,
  artist_id INTEGER NOT NULL REFERENCES artists(id),
  position INTEGER NOT NULL,
  is_headliner INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tour_id, artist_id)
);

ALTER TABLE shows ADD COLUMN tour_id INTEGER REFERENCES tours(id);
CREATE INDEX idx_shows_tour ON shows(tour_id, event_date);

ALTER TABLE published_playlists ADD COLUMN tour_id INTEGER REFERENCES tours(id);
CREATE UNIQUE INDEX idx_published_tour_service
  ON published_playlists(tour_id, service) WHERE tour_id IS NOT NULL;
