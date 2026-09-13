# Generative AI Dashboard

Hub for your generative AI projects: prompt-generator links, hybrid balance
dashboard (muapi / wavespeed / runpod live, replicate / modal manual),
inpainting mask painter, depth-lite tool, and R2 storage browser.

**Live demo:** `https://generative-ai-dashboard.<your-subdomain>.workers.dev`
(protect with Cloudflare Access — see below).

## Quick start

```bash
npm install
cp .dev.vars.example .dev.vars
# fill .dev.vars locally (never commit it)

# 1. D1 + R2 (one time)
npm run d1:create
# → paste database_id into wrangler.toml
npm run setup:local
npm run r2:create

# 2. Dev (localhost bypasses Access check, like siblings)
npm run dev

# 3. Deploy
npm run setup:remote
wrangler secret put MUAPI_API_KEY
wrangler secret put REPLICATE_API_TOKEN
wrangler secret put WAVESPEED_API_KEY
wrangler secret put RUNPOD_API_KEY
npm run deploy
```

> Token scopes: `wrangler login` (browser OAuth) is simplest. If you use
> `CLOUDFLARE_API_TOKEN` instead, it needs Workers Scripts (write), D1
> (write), R2 (write), and Account Settings (read). A token with only
> basic access fails `d1 create` / `r2 bucket create` with API error 10000.

## Access lock (required)

Same pattern as `muapi-prompt-generator` / `replicate-prompt-orchestrator`:

1. Zero Trust → Access → Add application → Self-hosted →
   `generative-ai-dashboard.<subdomain>.workers.dev/*` (or your custom domain).
2. Policy: Allow + `Emails: <you>` (OTP works, no IdP needed).
3. Worker also enforces `Cf-Access-Jwt-Assertion` on `/api/*`
   (`src/worker.js: isAccessAuthenticated`). Localhost bypasses for dev.

## API

| Method | Path | Notes |
|---|---|---|
| GET | `/api/health` | bindings check |
| GET | `/api/links` | project + billing links (URLs via vars) |
| GET | `/api/balance` | all providers |
| GET | `/api/balance/:provider` | `muapi\|wavespeed\|runpod\|replicate\|modal`, `?refresh=1` to skip cache |
| PUT | `/api/balance/:provider` | `{value, note}` manual (replicate/modal) |
| GET | `/api/storage/list` | R2 list |
| POST | `/api/storage/upload?key=` | raw bytes, 100MB Worker cap |
| GET | `/api/storage/download?key=` | file bytes |

Replicate has no public balance API and Modal has no simple balance API —
both are manual-first with token-presence checks. RunPod shows 30d spend +
pod/endpoint counts (`GET /v2/billing?lastN=30`).

## Security

- `.env` / `.dev.vars` are gitignored. Only `.dev.vars.example` (names, no values) is committed.
- Secrets go via `wrangler secret put`, never in `wrangler.toml`/`public/`.
- If a key was ever pasted in chat or committed, rotate it.
- Oracle VPS SSH key lives in `~/.ssh/` (0600), never in this repo.
