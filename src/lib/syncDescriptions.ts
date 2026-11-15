import { playlistDescription } from "./publish";
import { spotifyDescription } from "./publishSpotify";
import * as spotify from "./spotify";
import { listTourStops } from "./tours";
import * as youtube from "./youtube";

async function refreshToken(db: D1Database, service: string): Promise<string> {
  const row = await db
    .prepare("SELECT refresh_token FROM oauth_credentials WHERE service = ?")
    .bind(service)
    .first<{ refresh_token: string }>();
  if (!row) throw new Error(`${service} publisher not connected`);
  return row.refresh_token;
}

/**
 * Re-apply generated title/description to a tour's already-published
 * playlists (e.g. after importing more stops), without recreating them.
 */
export async function syncTourDescriptions(
  db: D1Database,
  tourSlug: string,
  creds: {
    googleClientId: string;
    googleClientSecret: string;
    spotifyClientId: string;
    spotifyClientSecret: string;
  },
): Promise<{ updated: string[]; stops: number }> {
  const tour = await db
    .prepare("SELECT id, title, tour_name FROM tours WHERE slug = ?")
    .bind(tourSlug)
    .first<{ id: number; title: string; tour_name: string }>();
  if (!tour) throw new Error(`tour not found: ${tourSlug}`);

  const { results: bandRows } = await db
    .prepare(
      `SELECT a.name FROM tour_artists ta JOIN artists a ON a.id = ta.artist_id
        WHERE ta.tour_id = ? ORDER BY ta.position`,
    )
    .bind(tour.id)
    .all<{ name: string }>();
  const bands = bandRows.map((b) => b.name);
  const stops = await listTourStops(db, tour.id);

  const { results: published } = await db
    .prepare(
      `SELECT DISTINCT service, external_playlist_id FROM published_playlists
        WHERE tour_id = ?`,
    )
    .bind(tour.id)
    .all<{ service: string; external_playlist_id: string }>();

  const updated: string[] = [];
  for (const p of published) {
    if (p.service === "youtube") {
      const access = await youtube.accessTokenFromRefresh(
        await refreshToken(db, "youtube"),
        creds.googleClientId,
        creds.googleClientSecret,
      );
      await youtube.updatePlaylist(
        access,
        p.external_playlist_id,
        tour.title,
        playlistDescription({ tourName: tour.tour_name, bandsInPlayingOrder: bands, stops }),
      );
      updated.push("youtube");
    } else if (p.service === "spotify") {
      const { accessToken, refreshToken: rotated } = await spotify.accessTokenFromRefresh(
        await refreshToken(db, "spotify"),
        creds.spotifyClientId,
        creds.spotifyClientSecret,
      );
      if (rotated) {
        await db
          .prepare(
            "UPDATE oauth_credentials SET refresh_token = ?, updated_at = datetime('now') WHERE service = 'spotify'",
          )
          .bind(rotated)
          .run();
      }
      await spotify.changePlaylistDetails(accessToken, p.external_playlist_id, {
        name: tour.title,
        description: spotifyDescription({
          tourName: tour.tour_name,
          bandsInPlayingOrder: bands,
          stops,
        }),
      });
      updated.push("spotify");
    }
  }
  return { updated, stops: stops.length };
}
