# Account setup checklist

Only the project owner can create these accounts. Create dedicated SetReady
accounts — do not use personal accounts as the owners of canonical playlists.
Enable two-factor authentication on every account.

## Create now

- [x] Cloudflare (free): https://dash.cloudflare.com/sign-up
      (deployed: https://setready.setready.workers.dev)
- [ ] Dedicated SetReady Spotify account: https://www.spotify.com/signup
- [ ] Spotify developer app: https://developer.spotify.com/dashboard
      (App "SetReady" created, Development mode, both redirect URIs set:
      http://127.0.0.1:8787/oauth/spotify/callback
      https://setready.setready.workers.dev/oauth/spotify/callback
      Client ID + Secret stored in .dev.vars and Cloudflare secrets.
      Remaining: select Web API under APIs used if empty; add the
      dedicated Spotify account under User Management.)
- [x] Dedicated SetReady Google account: https://accounts.google.com/signup
- [x] YouTube channel on that account: "SetReady" (@SetListReady),
      https://www.youtube.com/channel/UCcZ0C1GpQHVQMY9dMOmeizw
      (required before the API can create playlists; the same channel is
      the publisher identity in YouTube Music)
- [x] Google Cloud project (free): https://console.cloud.google.com/
      Project: `setready-514803` (owned by the dedicated account;
      the earlier `setready-514802` under the personal account is unused)
- [x] Enable YouTube Data API v3 in `setready-514803`:
      https://console.cloud.google.com/apis/library/youtube.googleapis.com?project=setready-514803
- [x] OAuth consent screen + OAuth client in `setready-514803`:
      Branding: https://console.cloud.google.com/auth/branding?project=setready-514803
      Audience: https://console.cloud.google.com/auth/audience?project=setready-514803
      (External; Testing; dedicated + personal accounts are test users)
      Scopes: https://console.cloud.google.com/auth/scopes?project=setready-514803
      (https://www.googleapis.com/auth/youtube.force-ssl added)
      Clients: https://console.cloud.google.com/auth/clients?project=setready-514803
      (Web application "SetReady Worker" created; Client ID/Secret stored
      in .dev.vars only. Redirect URIs include local
      http://127.0.0.1:8787/oauth/youtube/callback and production
      https://setready.setready.workers.dev/oauth/youtube/callback)

## Reuse from the setlistmaker prototype if still available

- [x] setlist.fm API key: https://www.setlist.fm/settings/api
      (stored locally in `.dev.vars`, verified working; update its app
      description from SetlistMaker/Gemini wording to SetReady when convenient)
- [x] Ticketmaster API key (optional): https://developer.ticketmaster.com/
      (only the Consumer Key is used, as the Discovery API `apikey`;
      stored locally in `.dev.vars`, verified working)

## Later phases only

- Custom domain (development starts on the free workers.dev address)
- Apple Music (MusicKit) credentials
- App store developer accounts, Spotify extended-quota review, and Google
  OAuth verification / YouTube quota extension for public launch

Secrets are stored in local env files and Cloudflare secrets — never in git
or chat.
