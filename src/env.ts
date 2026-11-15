export interface Env {
  DB: D1Database;
  /** Operator token for mutating endpoints (secret). Fails closed if unset. */
  ADMIN_TOKEN?: string;
  /** setlist.fm API key (secret). */
  SETLISTFM_API_KEY: string;
  /** Ticketmaster Discovery Consumer Key (secret). Optional feature. */
  TICKETMASTER_API_KEY?: string;
  /** Google Cloud project id for the YouTube Data API. Not a secret. */
  GOOGLE_CLOUD_PROJECT?: string;
  /** Google OAuth Web application client credentials (secrets). */
  GOOGLE_OAUTH_CLIENT_ID?: string;
  GOOGLE_OAUTH_CLIENT_SECRET?: string;
  /** Spotify app credentials (client secret is a secret). */
  SPOTIFY_CLIENT_ID?: string;
  SPOTIFY_CLIENT_SECRET?: string;
}
