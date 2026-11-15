-- Publisher OAuth refresh tokens for the SetReady-owned accounts.
-- Local/spike storage so the one-time consent flow has somewhere to land;
-- production should move these into Cloudflare secrets (or encrypt at rest)
-- before any public deploy.
CREATE TABLE oauth_credentials (
  service TEXT PRIMARY KEY CHECK (service IN ('spotify', 'youtube', 'apple')),
  refresh_token TEXT NOT NULL,
  scope TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
