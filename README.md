# SetReady

**Hear the show before doors.**

<img width="593" height="271" alt="image" src="https://github.com/user-attachments/assets/6d052820-bf3e-4624-9ab2-6755a37008c8" />


SetReady turns real concert setlists into public playlists you can save before a gig and relive after it. It discovers upcoming tours, works out what every band has been playing, publishes one canonical playlist per tour and lineup to Spotify and YouTube Music, keeps that playlist current, and later swaps in the exact setlist played at each show.

**Live app:** [setready.setready.workers.dev](https://setready.setready.workers.dev)
**Example tour:** [Crown in the Grave World Tour](https://setready.setready.workers.dev/tours/crown-in-the-grave-world-tour-2026-ghs3zn)
**Listen:** [Spotify](https://open.spotify.com/playlist/0edsgHmpWADc9EzXbcjY12) · [YouTube Music](https://music.youtube.com/playlist?list=PLfXmug4Czgck)

SetReady grew out of [SetlistMaker](https://github.com/andriybuday/setlistmaker), a small Streamlit prototype that generated a Gemini prompt for creating a YouTube Music playlist. SetReady removes that manual step and publishes playlists directly.

## Why canonical playlists?

If thousands of people are going to the same concert, they should not each have to research the support bands and build the same playlist.

SetReady creates the playlist once under its own publisher accounts. Fans only need to open the link and save it in Spotify or YouTube Music. Because there is one canonical playlist, it can also be corrected and updated centrally: everyone who saved it receives the new tracklist automatically.

A tour is identified by its tour name and exact band set. A support-band rotation is treated as a different tour, so a playlist never claims to cover stops played by a different lineup.

## What it does

- Discovers upcoming music events and groups repeat dates into prospective tours.
- Resolves each concert's lineup and converts Ticketmaster billing order into actual playing order: opener first, headliner last.
- Builds setlists in three modes:
  - **Predicted** — statistics from each band's last five shows, including song frequency and average position.
  - **Last show** — the complete most recent setlist.
  - **Actual** — the exact setlist played on a specific date, once fans have posted it.
- Preserves important setlist detail such as covers, original artists, tape intros, encores, and source-show links.
- Lets the operator review bands and songs, exclude tracks, inspect current Spotify and YouTube matches, and manually fix a bad match.
- Matches songs through a shared cache. A song is searched once and reused across tours, which is essential for staying within API limits.
- Publishes playlists under the SetReady accounts, then updates those same playlists in place instead of creating duplicates.
- Tracks published tours, freezes a show on concert day, and attempts to replace the prediction with the actual setlist during the following week.
- Exposes the same build, tour-import, publishing, and status operations through an MCP endpoint for agents.

Playlist tracks always play in concert order. Playlist titles use billing order — headliner first — because that is how people search for shows. Titles include every band and, when space allows, the tour name, followed by the shared suffix `Setlist Playlist · SetReady`.

## How a playlist is made

1. Ticketmaster supplies an upcoming event, venue, date, tour name, and attractions.
2. SetReady stores the stop and groups compatible dates into a tour candidate.
3. Candidates are checked for setlist evidence. The headliner needs recent setlists, and support bands need usable history.
4. setlist.fm supplies recent shows for every band.
5. The prediction engine selects likely songs using frequency, set length, and average position.
6. Songs are matched to official or otherwise suitable recordings on Spotify and YouTube. Live recordings, medleys, karaoke versions, tributes, and duplicate videos are penalized.
7. One public playlist is created per service and updated in place as the tour evolves.
8. After a show, SetReady looks for the real setlist and replaces the prediction when it becomes available.

Descriptions are generated from the actual tour data. YouTube playlists list every covered stop. Spotify receives a compact version because Spotify limits playlist descriptions to 300 characters.

## Automation

SetReady is designed to operate with very little infrastructure and very little daily attention.

| UTC schedule | Job |
|---|---|
| 06:30 daily | Discover upcoming Ticketmaster events and store tour candidates |
| Hourly | Qualify at most two candidates against setlist evidence |
| 07:10 and 08:10 | Publish one qualifying tour in the post-midnight-Pacific quota windows |
| 12:15 daily | Refresh predictions, freeze today's shows, and look for actual setlists |
| Monday 13:00 | Refresh titles and descriptions for up to ten published tours |

YouTube usage is recorded in a Pacific-date quota ledger. Automated publishing has a daily YouTube search budget of 80 searches. Before publishing, SetReady estimates how many songs still need searching; if the tour does not fit, it stays queued for the next reset instead of failing. Spotify publishing is independent, so it can continue when YouTube quota is exhausted.

The operator interface is protected by a shared `ADMIN_TOKEN`. Public show and tour pages are read-only. Anything that builds data, spends API quota, or writes to a publisher account requires the operator token.

## Architecture

SetReady is TypeScript end to end and runs almost entirely on Cloudflare:

- **Cloudflare Workers** — web pages, JSON APIs, scheduled jobs, and the MCP endpoint.
- **Cloudflare D1** — the canonical database for artists, tours, stops, shows, songs, track matches, candidates, published playlists, and quota usage.
- **Ticketmaster Discovery API** — concerts, venues, dates, tour names, and lineups.
- **setlist.fm API** — historical and current concert setlists.
- **Spotify Web API** — track search and public playlist publishing.
- **YouTube Data API v3** — video search and playlist publishing. These playlists also appear in YouTube Music, which has no separate official public API.

The D1 database is the source of truth. Streaming playlists are published replicas that can be repaired or regenerated from it.

Important modules:

- `src/lib/pipeline.ts` — discovery, candidate grouping, qualification, and publishing.
- `src/lib/automation.ts` — daily tracking and weekly description synchronization.
- `src/lib/predict.ts` — predicted-setlist calculation.
- `src/lib/publish.ts` — YouTube matching and in-place playlist reconciliation.
- `src/lib/publishSpotify.ts` — Spotify matching and in-place playlist reconciliation.
- `src/lib/quota.ts` — Pacific-date YouTube quota accounting.
- `src/lib/mcp.ts` — agent-facing MCP tools.
- `src/ui.ts` — the small server-rendered web interface.

## Try it

Open the [live SetReady app](https://setready.setready.workers.dev), choose a headliner and date, and either let Ticketmaster resolve the lineup or enter bands manually in playing order. After the setlists are fetched, review the songs and publish the tour playlist to Spotify or YouTube Music.

Publishing and other mutations require the project operator token. Fans do not need a SetReady account; they simply save the resulting public playlist in their normal streaming app.

## Local development

Requirements: Node.js and npm.

```sh
npm install
npm run db:migrate:local
npm run dev
```

The local app runs at `http://localhost:8787`. Check it with:

```sh
curl http://localhost:8787/health
```

Local configuration belongs in `.dev.vars`, which is ignored by Git. Use `.env.example` for variable names. Never commit API keys, OAuth secrets, refresh tokens, or the admin token.

Quality gates:

```sh
npm run typecheck
npm test
```

## Deployment

The production Worker and D1 database are already configured in `wrangler.jsonc`.

```sh
npm run db:migrate:remote
npm run deploy
```

Production secrets are stored with Wrangler:

```sh
npx wrangler secret put SETLISTFM_API_KEY
npx wrangler secret put TICKETMASTER_API_KEY
npx wrangler secret put ADMIN_TOKEN
```

Spotify and Google OAuth credentials use the corresponding names in `.env.example`. Publisher accounts complete OAuth once through `/oauth/spotify/start` or `/oauth/youtube/start`; their refresh tokens are stored in D1.

See [docs/development.md](docs/development.md) for Cloudflare setup, custom domains, automation, and MCP details. Account-specific setup is recorded in [docs/accounts.md](docs/accounts.md).

## Useful endpoints

- `GET /health` — Worker, configuration, and database status.
- `GET /api/setlist?artist={name}&date={YYYY-MM-DD}` — most recent setlist before a date.
- `GET /api/lineup?artist={name}&date={YYYY-MM-DD}` — Ticketmaster lineup in playing order.
- `POST /api/shows/build` — build and store a show. Operator token required.
- `GET /shows/{slug}` — review page for one dated concert.
- `GET /tours/{slug}` — public tour page with stops and playlist links.
- `POST /api/tours/{slug}/publish/youtube` — create or update the YouTube Music playlist.
- `POST /api/tours/{slug}/publish/spotify` — create or update the Spotify playlist.
- `POST /mcp` — MCP tools for building shows, importing stops, publishing tours, and reading tour status. Tool calls require the operator token.

## Limitations

SetReady can only be as good as its sources:

- Ticketmaster has strong coverage in many North American, European, and Australasian markets, but it is not a complete global concert database.
- Some Ticketmaster listings omit support bands or use inconsistent attraction data. SetReady records uncertain stops as inferred, and manual band entry remains available.
- setlist.fm is fan-maintained. Very small, new, improvisational, classical, jazz, and DJ acts may have little usable setlist history.
- Covers and similarly named songs can still match the wrong recording. The shared cache allows a manual correction to improve future playlists.
- YouTube Search quota is the main publishing bottleneck. The quota extension process is documented in [docs/quota-applications.md](docs/quota-applications.md).
- Spotify Development Mode currently requires the app owner to maintain Premium unless Extended Quota Mode is approved.
- Setlists change. A SetReady playlist is a strong preview, not a guarantee of exactly what will be played.

## Project status

SetReady is a working personal project deployed on Cloudflare's free tier. The core flow — discovery, prediction, matching, publishing, and tracking — is operational for both Spotify and YouTube Music. The remaining work is mainly broader quota approval, richer public pages, and continued improvement in tour grouping and match confidence.

Setlists and song data belong to their respective communities and rights holders. SetReady is not affiliated with Ticketmaster, setlist.fm, Spotify, YouTube, Google, or the artists featured in its playlists.
