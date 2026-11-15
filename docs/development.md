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
