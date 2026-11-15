# Phase 0 evidence

## YouTube / YouTube Music spike — PASSED (2026-11-14)

- One-time OAuth consent as the dedicated SetReady account (Testing mode,
  scope `youtube.force-ssl`); refresh token stored in local D1.
- `POST /api/youtube/spike` created playlist `PLG-Fu0Y4cI6E`
  ("SetReady spike test") and added one matched track:
  "Creeping Death (Remastered)" (video `X8OeBZQn3_w`, official audio).
  Cost: ~100 quota units + 1 `search.list`.
- Channel ownership verified via API: `channels.list?mine=true` returns
  SetReady `UCcZ0C1GpQHVQMY9dMOmeizw` (@setlistready).
- Finding: while the playlist was `private`, it did not appear in the
  owner's YouTube Music Library grid. After `playlists.update` to
  `public` (50 units) and re-listing confirmed `privacyStatus=public`,
  the owner confirmed visibility at
  https://music.youtube.com/playlist?list=PLG-Fu0Y4cI6E and the channel
  page https://music.youtube.com/@SetListReady.
- Conclusion: canonical playlists are created `public` by default
  (`createPlaylist` in src/lib/youtube.ts). YouTube Data API remains the
  supported route; there is no separate YouTube Music API.

## Spotify spike — PASSED (2026-11-15)

- App owner took one month of Premium. The original (pre-Premium)
  refresh token stayed blocked with the same 403 a day later; a fresh
  OAuth consent after Premium activation succeeded (`/me` returned the
  SetReady account) and `POST /api/spotify/spike` created public
  playlist `5RgcNnIQAGnRQJcdktOlt8` with "Creeping Death (Remastered)".
  Lesson: re-consent after a subscription-status change.
- Earlier diagnosis (2026-11-14):

- Developer app created (Development mode), Web API selected, dedicated
  account allowlisted under User Management, publisher OAuth consent
  completed and refresh token stored in production D1.
- First API call fails: `POST /me/playlists` -> HTTP 403
  "Active premium subscription required for the owner of the app."
  Spotify's Feb 2026 Dev Mode changes require the **app owner** (not the
  playlist publisher/user) to hold Premium; Extended Quota Mode apps are
  exempt. Token exchange and client credentials are verified good
  (fake-code probe returns `invalid_grant`, not `invalid_client`).
- Decision (2026-11-14): buy one month of Premium on the app-owner
  account to complete all Spotify testing (spike, matching, full
  canonical publish), then cancel. After cancellation the Dev Mode app
  stops calling the API until resubscribed/Extended Quota; playlists
  already created on the publisher account remain ordinary playlists.
  Recreate/own under an already-Premium account, Extended Quota
  approval, or parking Spotify YouTube-first remain later options.

## Still open in Phase 0
- Competitor teardown + track-matching benchmark corpus.
- Name availability (store/domain/trademark) for "SetReady".
