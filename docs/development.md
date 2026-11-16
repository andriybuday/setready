# Development

## Local (no Cloudflare account needed)

```sh
npm install
npm run db:migrate:local   # applies migrations/ to a local D1 (SQLite)
npm run dev                # http://localhost:8787
curl http://localhost:8787/health
```

Local secrets live in `.dev.vars` (git-ignored); see `.env.example` for the
variable names. `npm run typecheck` and `npm test` are the local gates.

## Cloudflare (one-time, owner)

1. `npx wrangler login`
2. `npx wrangler d1 create setready`, then paste the returned `database_id`
   into `wrangler.jsonc` (replacing the all-zero placeholder).
3. `npm run db:migrate:remote`
4. `npx wrangler secret put SETLISTFM_API_KEY` (and
   `TICKETMASTER_API_KEY` if used). Never commit secret values.
5. `npm run deploy`

The Worker starts on a free `workers.dev` address; a custom domain is a
later, optional step.

## Custom domain (owner purchase required)

1. Buy/register the domain (e.g. via Cloudflare Registrar) and add it as
   a zone in the same Cloudflare account.
2. Workers & Pages -> setready -> Settings -> Domains & Routes ->
   Custom Domain, e.g. `app.example.com`.
3. Update OAuth redirect URIs to the new host in Google
   (https://console.cloud.google.com/auth/clients?project=setready-514803)
   and Spotify (https://developer.spotify.com/dashboard), keeping the
   `127.0.0.1` local entries.

## Automation and agents

- Optimized cron (UTC): 06:30 discovery, hourly qualification
  (max 2), 07:10/08:10 combined post-Pacific-reset publish window
  (quota-ledger enforced, automated YouTube search budget 80/day),
  12:15 tracking refresh/freeze/actual/republish-if-changed, and
  Monday 13:00 description sync for published tours (max 10).
  Manual trigger: `POST /api/admin/run-automation` (operator token).
- Health: `GET /api/admin/health` (operator token).
- MCP (stateless JSON-RPC): `POST /mcp`; `tools/list` is open,
  `tools/call` requires the `x-admin-token` header.
