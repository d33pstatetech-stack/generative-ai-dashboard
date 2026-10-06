# Prompt Atlas enhancer injection — rollback plan

Owns the guide injection in `/api/enhance` for all four apps. Read this
before changing anything in `buildEnhancerSystemPrompt` or
`getPromptGuideBlock`.

## What is deployed

| Component | Commit | Worker version |
|---|---|---|
| Dashboard (`/api/guides`, resolver) | `44dc2f2` | `8b458a5a` |
| MuAPI (injection) | `4e16d00` | `16f45eb5` |
| Replicate (injection) | `f90c324` | `cf7dd3bb` |
| WaveSpeed (injection) | `dbd4a6e` | `741c7456` |
| D1 migration + seed | `44dc2f2` | — |

## Blast radius

The injection adds text to a system prompt. It cannot corrupt data, and it
cannot affect generation: it only changes what the *enhancer LLM* is told
before it rewrites a prompt. Worst realistic failure is a degraded or
oddly-formatted enhanced prompt.

## Fastest backout — kill switch, no deploy

`GUIDE_INJECTION` is a Worker var. Set it to `0` and redeploy, or better,
use the runtime toggle below. The helper returns `null` immediately, the
system prompt falls through to `MODEL_PRESETS`, and behaviour returns to
the pre-Atlas state exactly.

```powershell
# each app
npx wrangler secret put GUIDE_INJECTION   # value: 0
```

Check it took effect:

```powershell
npx wrangler deployments list | Select-Object -First 5
```

## Full revert — one command per app

Reverts to the last commit without this feature. No D1 change needed,
because the tables are inert once the code stops reading them.

```powershell
cd <app>
git revert --no-edit 4e16d00   # muapi
git revert --no-edit f90c324   # replicate
git revert --no-edit dbd4a6e   # wavespeed
cd client; npm run build; cd ..
npx wrangler deploy
```

Dashboard is optional to revert — `/api/guides` is read-only and nothing
in the apps depends on it being present.

## Roll forward instead

If the fix is small, prefer reverting the *change* on top of the feature
commit. That keeps the guide plumbing and lands a correction:

```powershell
cd <app>; git revert --no-edit <bad-commit>; cd client; npm run build; cd ..; npx wrangler deploy
```

## D1 rollback

Only needed if `prompt_guides` itself must go. The apps tolerate the table
being absent — every query is wrapped and returns `null` on error — so
this is cosmetic.

```powershell
cd "Generative AI Dashboard"
npx wrangler d1 execute genai-history --remote --command "DROP TABLE IF EXISTS prompt_guides"
npx wrangler d1 execute genai-history --remote --command "DROP TABLE IF EXISTS guide_import_meta"
```

Restore afterwards from `scripts/seed-prompt-guides.sql`.

## Verify a backout actually worked

The endpoint needs an authenticated session; unauthenticated `curl` gets a
302 from Cloudflare Access, which is expected and is not a failure signal.

```powershell
npx wrangler deployments list | Select-Object -First 5   # new version active
cd client; npx tsc --noEmit                              # 0 errors
```

Then in the browser: enhance a prompt on a model that has a guide
(`flux-dev`) and confirm the output is still sane. `git log --oneline -1`
should no longer show the injection commit.

## Pre-deploy checklist

- `npm run build` in `client/`
- `npx tsc --noEmit` — 0 errors
- resolver audit passes: no model resolves to a `guide_key` absent from
  `prompt_guides` (see `scripts/audit-guide-mapping.mjs`)
- unguided models still hit `MODEL_PRESETS`

## Known-good state

Last verified: all four Workers deployed, `prompt_guides` holds 38 rows,
resolver audit reports 0 broken lookups across 1846 models.