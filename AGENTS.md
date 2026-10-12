# AGENTS.md

Notes for working on this repository inside the Base44 sandbox.

## What actually runs

The runnable app is **`artifacts/bit2block`** — a single Express server (`server/index.ts`)
that mounts the JSON API under `/api` and serves the React client (`client/`) through
**Vite middleware** in development. One process, one origin, host port **3000**
(`PORT=3000`). `/api/ws` (WebSocket) and `/api/healthz` live on the same server.

The other workspace packages are not needed to run the app:

- `artifacts/api-server` — scaffold API (`/api/healthz` only) served on `/internal-api`; the
  client never calls it (all calls are same-origin `/api`).
- `artifacts/mockup-sandbox` — UI sandbox.
- `artifacts/bit2block/src/**` — leftover scaffold; the real client is `artifacts/bit2block/client/src`.

## Running it

```bash
docker compose -f docker-compose.base44.yml up -d --build   # first boot
docker compose -f docker-compose.base44.yml logs -f web
curl -s localhost:3000/api/healthz                          # {"ok":true,...}
```

Services: `db` (postgres:16-alpine, volume `bit2block-pgdata`), `migrate` (one-shot schema
push, exits 0), `web` (Node 22 + pnpm 10, bind-mounted checkout, tsx watch + Vite HMR).

## Required environment

| Variable | Notes |
| --- | --- |
| `DATABASE_URL` | Postgres. Local compose service; set inline in compose (`postgres://bit2block:bit2block_dev_password@db:5432/bit2block`). |
| `SESSION_SECRET` | **Required at boot** — `server/auth.ts` refuses to start without it. Delivered as a Base44 secret (`/run/base44/app.env`). A non-secret boot fallback sits in `.env.base44-defaults`, which is loaded *before* the managed env file so dashboard values always win. |
| `NODE_ENV` | Must be `development` in the sandbox: production turns on `secure` session cookies and TLS for Postgres (`server/db.ts`), which breaks over the preview proxy. |

`server/db.ts` and `server/auth.ts` throw at startup when `DATABASE_URL` / `SESSION_SECRET`
are missing, so a boot failure with "… is required" means the env wiring, not the app.

No third-party credentials are needed. The only external call is CoinGecko's keyless public
price API (`server/storage.ts`, cached 30s).

## Database schema

`artifacts/bit2block/shared/schema.ts` is the **source of truth**.

Do **not** use `drizzle-kit migrate`: `migrations/meta/_journal.json` only journals
`0000_needy_hammerhead`, while `0001`–`0006` sit unjournaled in the folder. The compose
`migrate` service runs `drizzle-kit push --force`, which diffs the schema against Postgres
and also creates the `session` table that `connect-pg-simple` needs (it is in the schema but
in no migration file).

`docker-compose.base44.yml` owns the DB lifecycle; there is no seed step. A fresh database is
empty by design: the **first registered user becomes the primary admin** (`isAdmin: true`) and
receives the 0.10 free starter hash power (`DatabaseStorage.createUser`). Everyone else is a
regular account until that first user grants roles.

## Auth model (non-obvious)

Username + generated B2B access key (`/api/register`, `/api/login`), session stored in the
Postgres `session` table. `req.isAuthenticated()` is a hand-rolled polyfill, not Passport.
Registering issues an access key that is only shown once.

**Second factor = TOTP 2FA only.** The legacy 6-digit "security PIN" was removed
(`/api/change-pin`, `/api/verify-pin`, and every PIN check in withdrawals/transfers/2FA
disable are gone; `users.security_pin` still exists in the schema but is unused, and
`serializeUserForClient` no longer emits `securityPin`). Withdrawals require a TOTP code
only when the user has 2FA enabled. The Account page (`/account`) is a profile + security
page — the purchase-gated referral code/slot tabs that used to live there are gone, and the
referral code, team list and commission details are on `/referral`.

## Verifying a change

1. `curl -s localhost:3000/api/healthz` → `{"ok":true,"database":"connected"}`.
2. Home route `/` renders the "B2B MINING" hero after a ~3s boot animation
   (`LoadingScreen`), then routes via wouter.
3. `/api/user` returns **401** when signed out — that is correct, not a failure.
4. Client edits hot-reload through Vite; server edits restart via `tsx watch`. If a restart
   is needed by hand: `docker compose -f docker-compose.base44.yml restart web`.

## Sandbox gotchas

- `BASE44_PREVIEW_MODE` is passed through to `web` as a bare compose entry. No code currently
  gates on it — Vite already sets `allowedHosts: true`, so the preview host/origin needs no
  allowlist change. Keep any future sandbox-only override gated on the value `"1"`.
- `pnpm install --frozen-lockfile` runs at container start in both `migrate` and `web`
  (sequentially, via `service_completed_successfully`) so the mounted source and lockfile stay
  authoritative. Do not delete the `bit2block-pgdata` volume to refresh dependencies.
- `server/backup.ts` writes daily JSON backups to `backups/` under the package dir (already
  contains a committed sample).
