# Quota and verification applications (owner actions)

These are external reviews only the account owner can submit. Product
health can be checked any time at `GET /api/admin/health` with the
operator token (publisher identity per service + match-cache counts).

## Spotify — Extended Quota Mode

Dashboard: https://developer.spotify.com/dashboard (open the SetReady
app, request extension from its settings/status area).

Why: Development Mode requires the app owner to hold Premium and caps
allowlisted users. Extended Quota Mode apps are exempt from the Feb
2026 Dev Mode restrictions.

Application points:
- SetReady creates one public canonical playlist per tour/lineup for
  concertgoers, from community setlists (setlist.fm).
- Endpoints: search, create playlist, add/replace items, current user.
- No playback, no user-data harvesting; the authorized account is our
  own publisher account. Users only save public playlists.
- Track matches are cached server-side and shared across shows.

Until extended quota is granted, keep owner Premium active; after any
subscription change, redo the publisher OAuth consent once.

## YouTube — OAuth verification and quota extension

Branding/verification:
https://console.cloud.google.com/auth/branding?project=setready-514803

Quota: default is 10,000 units/day. One 39-song publish costs about
- create playlist 50
- 39 item inserts x 50 = 1,950
- one search.list call per uncached song (separate 100/day bucket)
Cache hits and in-place updates avoid repeat searches; a no-change
republish only spends the 50-unit description update.

Application points:
- One canonical playlist per tour/lineup, updated in place; no per-user
  playlist spam.
- Shared server-side match cache across all shows.
- Requested increase should be sized from expected tours/month, with
  the per-playlist math above.
