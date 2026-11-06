# Spine Community

An English-language, peer-to-peer community focused on lived experiences with cervical and lumbar spine conditions.

> **Status:** Initial, read-only scaffold. NOT ready for public registration, posting, or medical-data collection.

## Stack

- GitHub private repo (`main`)
- Cloudflare Workers with static assets in `public/`
- Cloudflare D1 (migration prepared; binding pending)
- R2 integration reserved, **uploads and reads disabled by default**
- No separate Cloudflare Pages project is required

## Local setup

```bash
npm install
npm run dev
```

Visit the Wrangler local URL. The starter home page does not require a database. The `/api/health` endpoint reports whether a D1 binding is attached. `/api/topics` requires D1 and migrations.

## Deploy

1. In Cloudflare Workers Builds, select the GitHub repo and `main` branch.
2. Set build command **empty** and deploy command `npx wrangler deploy`. Disable preview deployments for now.
3. **Before connecting D1**, add a D1 binding in `wrangler.jsonc` using the real **database_id** from Cloudflare:

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "spine-community-db",
    "database_id": "REAL-DATABASE-UUID",
    "migrations_dir": "migrations"
  }
]
```

4. Apply migrations: `npx wrangler d1 migrations apply DB --remote`, reviewing the SQL before running against production. Ensure Cloudflare build credentials have appropriate D1 access. Initial site can deploy without D1 until this is configured.

**Never** commit Cloudflare API tokens, secret keys, or patient records.

## Release restrictions

- No actual user accounts, posting, or file upload yet.
- `POST /api/uploads` and `GET /api/uploads/*` are explicitly forbidden (fail-closed).
- Demo cards are informational navigation, not fabricated patient testimonials.
- Launch gate: moderation, account verification, privacy controls, content reporting, backups, abuse protections, and consent text must be implemented and tested.

See [docs/requirements.md](docs/requirements.md) for planned scope and phased rollout.
