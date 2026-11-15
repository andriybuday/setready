-- SetReady canonical schema.
-- The database is the source of truth; playlists on Spotify/YouTube are
-- published replicas that can be regenerated from these tables.

CREATE TABLE artists (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL UNIQUE,
  setlistfm_mbid TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One upcoming (or past) concert event. `status` moves predicted -> frozen
-- at showtime; an "actual" show can then be recorded from the real setlist.
CREATE TABLE shows (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  headliner_artist_id INTEGER NOT NULL REFERENCES artists(id),
  venue TEXT,
  city TEXT,
  country TEXT,
  -- YYYY-MM-DD
  event_date TEXT NOT NULL,
  tour_name TEXT,
  ticketmaster_event_id TEXT,
  status TEXT NOT NULL DEFAULT 'predicted'
    CHECK (status IN ('predicted', 'frozen', 'actual')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_shows_event_date ON shows(event_date);

-- Lineup for a show: support acts first, headliner last (position order),
-- matching the ordering convention of the setlistmaker prototype.
CREATE TABLE show_artists (
  show_id INTEGER NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
  artist_id INTEGER NOT NULL REFERENCES artists(id),
  position INTEGER NOT NULL,
  is_headliner INTEGER NOT NULL DEFAULT 0,
  -- Provenance: which past show the predicted songs came from.
  source_mode TEXT NOT NULL DEFAULT 'last_show'
    CHECK (source_mode IN ('last_show', 'predicted', 'tour_essentials', 'actual')),
  source_setlist_id TEXT,
  source_setlist_date TEXT,
  source_setlist_url TEXT,
  PRIMARY KEY (show_id, artist_id)
);

-- Ordered setlist for one artist at one show.
CREATE TABLE songs (
  id INTEGER PRIMARY KEY,
  show_id INTEGER NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
  artist_id INTEGER NOT NULL REFERENCES artists(id),
  position INTEGER NOT NULL,
  title TEXT NOT NULL,
  normalized_title TEXT NOT NULL,
  -- Cover attribution from setlist.fm, when the song is a cover.
  original_artist TEXT,
  is_tape INTEGER NOT NULL DEFAULT 0,
  -- 0..1 likelihood in predicted mode; NULL for last_show/actual lists.
  probability REAL,
  included INTEGER NOT NULL DEFAULT 1,
  UNIQUE (show_id, artist_id, position)
);
CREATE INDEX idx_songs_show ON songs(show_id, position);

-- Shared cache of song -> streaming-track matches. This is what makes the
-- YouTube quota survivable: a song is searched once, ever, per service.
CREATE TABLE track_matches (
  id INTEGER PRIMARY KEY,
  service TEXT NOT NULL CHECK (service IN ('spotify', 'youtube', 'apple')),
  artist_normalized TEXT NOT NULL,
  title_normalized TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'matched'
    CHECK (status IN ('matched', 'unmatched')),
  -- NULL when status = 'unmatched' (negative cache: do not re-search).
  service_track_id TEXT,
  service_track_uri TEXT,
  matched_title TEXT,
  matched_artist TEXT,
  confidence REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (service, artist_normalized, title_normalized)
);

-- Playlists published under the SetReady-owned accounts.
CREATE TABLE published_playlists (
  id INTEGER PRIMARY KEY,
  show_id INTEGER NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
  service TEXT NOT NULL CHECK (service IN ('spotify', 'youtube', 'apple')),
  external_playlist_id TEXT NOT NULL,
  external_url TEXT NOT NULL,
  title TEXT NOT NULL,
  published_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (show_id, service)
);
