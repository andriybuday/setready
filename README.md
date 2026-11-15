# SetReady

Hear tonight's show before doors.

SetReady turns an upcoming concert into a ready-to-save playlist: it finds the
lineup, predicts the setlist from recent shows on setlist.fm, and publishes a
canonical playlist per show/tour to Spotify and YouTube (Music) under the
SetReady accounts. Fans open a link and tap Save — no account creation per
user to get value. An agent (MCP) surface exposes the same engine
conversationally.

Status: greenfield. The previous Streamlit prototype lives archived in
`~/Projects/setlistmaker/` until this project reaches parity.

## Planned shape

- TypeScript end to end.
- Cloudflare Workers (API, scheduled jobs, share pages) + D1 (canonical DB).
- Destination-agnostic engine: lineage from setlist.fm + Ticketmaster,
  predicted/last-show/tour-essentials tracklists, deterministic track
  matching with caching, publishers for Spotify / YouTube / Apple Music and
  plain-text export.

## Account setup (owner only)

See [docs/accounts.md](docs/accounts.md). Secrets never go in git; they live in
local env files and Cloudflare secrets.
