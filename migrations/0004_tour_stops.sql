-- Lightweight tour itinerary imported from Ticketmaster. Separate from
-- built `shows` (which carry full setlists): a stop only needs its date,
-- place, band set, and whether that band set was confirmed by the
-- listing or inferred from surrounding confirmed stops.
CREATE TABLE tour_stops (
  id INTEGER PRIMARY KEY,
  tour_id INTEGER NOT NULL REFERENCES tours(id) ON DELETE CASCADE,
  event_date TEXT NOT NULL,
  venue TEXT,
  city TEXT,
  region TEXT,
  country TEXT,
  ticketmaster_event_id TEXT,
  lineup_json TEXT NOT NULL DEFAULT '[]',
  confidence TEXT NOT NULL DEFAULT 'confirmed'
    CHECK (confidence IN ('confirmed', 'inferred')),
  source TEXT NOT NULL DEFAULT 'ticketmaster',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tour_id, event_date, city)
);
CREATE INDEX idx_tour_stops_tour_date ON tour_stops(tour_id, event_date);
