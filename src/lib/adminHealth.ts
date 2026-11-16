import { getQuotaState } from "./quota";
import * as spotify from "./spotify";
import * as youtube from "./youtube";

type ServiceHealth =
  | { ok: true; identity: string; detail?: string }
  | { ok: false; error: string };

async function token(db: D1Database, service: string): Promise<string | null> {
  const row = await db
    .prepare(
      "SELECT refresh_token, updated_at FROM oauth_credentials WHERE service = ?",
    )
    .bind(service)
    .first<{ refresh_token: string; updated_at: string }>();
  return row?.refresh_token ?? null;
}

export async function adminHealth(
  db: D1Database,
  creds: {
    googleClientId?: string;
    googleClientSecret?: string;
    spotifyClientId?: string;
    spotifyClientSecret?: string;
  },
) {
  const services: Record<string, ServiceHealth> = {};

  try {
    const refresh = await token(db, "youtube");
    if (!refresh || !creds.googleClientId || !creds.googleClientSecret) throw new Error("not connected");
    const access = await youtube.accessTokenFromRefresh(
      refresh, creds.googleClientId, creds.googleClientSecret,
    );
    const channel = await youtube.getMyChannel(access);
    services.youtube = channel
      ? { ok: true, identity: `${channel.title} (${channel.id})` }
      : { ok: false, error: "no channel for token" };
  } catch (err) {
    services.youtube = { ok: false, error: err instanceof Error ? err.message.slice(0, 220) : String(err) };
  }

  try {
    const refresh = await token(db, "spotify");
    if (!refresh || !creds.spotifyClientId || !creds.spotifyClientSecret) throw new Error("not connected");
    const { accessToken, refreshToken: rotated } = await spotify.accessTokenFromRefresh(
      refresh, creds.spotifyClientId, creds.spotifyClientSecret,
    );
    if (rotated) {
      await db.prepare(
        "UPDATE oauth_credentials SET refresh_token = ?, updated_at = datetime('now') WHERE service = 'spotify'",
      ).bind(rotated).run();
    }
    const me = await spotify.getMe(accessToken);
    services.spotify = {
      ok: true,
      identity: `${me.displayName} (${me.id})`,
      detail: `publisher product: ${me.product || "unknown"}; app-owner Premium is enforced separately by Spotify`,
    };
  } catch (err) {
    services.spotify = { ok: false, error: err instanceof Error ? err.message.slice(0, 220) : String(err) };
  }

  const { results: matchCounts } = await db
    .prepare(
      "SELECT service, status, COUNT(*) AS n FROM track_matches GROUP BY service, status ORDER BY service, status",
    )
    .all();
  const { results: tokenAges } = await db
    .prepare("SELECT service, updated_at FROM oauth_credentials ORDER BY service")
    .all();

  return { services, youtubeQuota: await getQuotaState(db), trackMatches: matchCounts, credentialUpdatedAt: tokenAges };
}
