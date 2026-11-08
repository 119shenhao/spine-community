# Spine Community

A multilingual peer community for neck and lower-back experiences. This branch implements the v1 development application. **Use fictional test data only; public launch is not approved.**

## Development

Requires Node 22.13+ (Cloudflare Builds uses `.node-version`).

```sh
npm ci
npm run dev
```

The development launcher applies **local-only** D1 migrations and starts Wrangler. It never contacts a remote database. Open the URL printed by Wrangler. `npm run verify` runs TypeScript checks and the full in-memory SQLite/Worker integration suite.

## Preview

Branch: `feature/v1-community-build-20261106`

https://feature-v1-community-build-20261106-spine-community.119shenhao.workers.dev/

Cloudflare's existing `npx wrangler preview` command runs `scripts/prepare-build.mjs`: checks/tests, then migrations **only** when `WORKERS_CI=1` and the exact development branch matches. The dedicated migration config pins the preview UUID and cross-checks its binding. An unknown legacy schema or missing D1 credentials stops preparation; it never falls back to production or overwrites tables. Check the actual build and `/api/health` before calling the preview ready.

Manual preview migration, after reviewing scripts and confirming the test DB ID:

```sh
npm run db:preview
```

## Runtime setup

No secret or real user data is committed. Preview credentials must be configured separately through Cloudflare Preview settings:

- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`: Google web OAuth client; register the exact preview origin + `/api/auth/callback` as an allowed callback. Until configured, browsing works and sign-in explains the missing setup.
- `ADMIN_GOOGLE_SUB`: immutable Google subject of the owner, set out of band. Never use a client-supplied role or email to assign ownership.
- `ANALYTICS_SALT`: random preview-only secret. Without it traffic collection stays off, and the management screen says so.
- Optional translation adapter: `TRANSLATOR_KEY`, `TRANSLATOR_REGION`, runtime `TRANSLATION_ENABLED=true`, and site setting `translation_enabled=true` are all required. Default off. Do not activate before provider/privacy approval. Hard daily/monthly character reservations precede requests; failures show the original.

Only Google login is implemented. There is **no preview login bypass**. Tests insert fictional users directly into isolated test databases.

## Database versions

Reviewed implementation migrations are in `migrations/v1/`. The obsolete initial migration was moved to `docs/archive/0001-initial-legacy.sql` and is excluded from all active migration configs. Production `main`, deployment, D1 writes and data copying are not part of this task.

[Implementation status and limitations](../docs/implementation-v1-2026-11-06.md) · [Canonical requirements](../docs/开发需求/项目需求总览.md) · [Development/release policy](../docs/development-release-workflow.md)
