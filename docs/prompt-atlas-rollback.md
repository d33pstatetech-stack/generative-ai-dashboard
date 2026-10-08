# Prompt Atlas enhancer injection — rollback plan

Owns the guide injection in `/api/enhance` for the three generator apps, and
the D1-backed `/api/guides` read endpoint on the Dashboard. Read this before
changing anything in `buildEnhancerSystemPrompt` or `getPromptGuideBlock`.

## What is deployed

The commit below is the **guide-injection tip** — the last commit that touched
the injection — not necessarily the repo tip. The three generator repos have
each taken unrelated commits since (catalogue work, LoRA matching, UI fixes).
That is fine: nothing after the injection touches `src/prompt-guides.mjs`,
`src/worker.js`'s enhancer path, or the `GUIDE_INJECTION` var, so a revert of
the injection commits still applies cleanly — except in Replicate, see
[Full revert](#full-revert).

| App | Injection tip | Deployed version | Repo HEAD at last check |
|---|---|---|---|
| Dashboard (`/api/guides`, resolver — **no injection**) | `2239e3c` | `39817105` | `2239e3c` (same) |
| MuAPI | `5592781` | `88ae79c6` | `76b770d` (ahead: LoRA matching, UI) |
| Replicate | `51226eb` | `960c761b` | `250e331` (ahead: catalogue, LoRA matching, UI) |
| WaveSpeed | `3e31779` | `9711a90e` | `d372eac` (ahead: catalogue, LoRA matching, UI) |
| D1 migration + seed | `44dc2f2` (Dashboard) | — | — |

`5592781` / `51226eb` / `3e31779` are the `guide is not defined` fixes and are
part of the known-good state. Do **not** revert them while keeping the feature.

### Commit lineage per app

Three commits per app, oldest first. Revert order is the reverse.

| App | 1. Inject | 2. Tighten (+ kill switch) | 3. Fix (`guide is not defined`) |
|---|---|---|---|
| MuAPI | `4e16d00` | `e1160a8` | `5592781` |
| Replicate | `f90c324` | `f53e493` | `51226eb` |
| WaveSpeed | `dbd4a6e` | `5e61c83` | `3e31779` |
| Dashboard | `44dc2f2` (D1 + `/api/guides`) | `2239e3c` (audit + modality-aware) | — |

## Blast radius

The injection adds text to a system prompt. It cannot corrupt data, and it
cannot affect generation: it only changes what the *enhancer LLM* is told
before it rewrites a prompt. Worst realistic failure is a degraded or
oddly-formatted enhanced prompt.

The one bug worth remembering: the pre-`5592781` build threw
`guide is not defined` on **every** enhance in the three generator apps. It
passed `node --check` because that validates syntax, not undefined
identifiers. `scripts/test-enhancer-prompt.mjs` exists to catch that class of
error and asserts the guide path and the `MODEL_PRESETS` fallback path are
mutually exclusive — run it after any change to `buildEnhancerSystemPrompt`:

```powershell
cd <app>; node scripts/test-enhancer-prompt.mjs
```

## Fastest backout — kill switch

`GUIDE_INJECTION` is a **Worker variable**, declared in `[vars]` in each
app's `wrangler.toml`:

```toml
[vars]
GUIDE_INJECTION = "1"
```

**This is a var, not a secret.** `npx wrangler secret put GUIDE_INJECTION`
is the wrong mechanism — it would write a value into the secret store where
nothing reads it, leave the var at `"1"`, and change nothing at all. Edit
`wrangler.toml` instead:

```powershell
# each of: muapi-prompt-generator, replicate-prompt-orchestrator,
#          wavespeed-prompt-generator  — NOT the Dashboard
# 1. set GUIDE_INJECTION = "0" in wrangler.toml
# 2. deploy
npx wrangler deploy
```

The change takes effect **only after a deploy** — it is not a runtime toggle.
The Dashboard has no kill switch and needs none: it does not inject anything
(its `src/worker.js` has no `GUIDE_INJECTION` and no
`buildEnhancerSystemPrompt`); it only serves `/api/guides`.

With the var at `"0"`, `getPromptGuideBlock` returns `null` immediately
(`env.GUIDE_INJECTION === '0' || env.GUIDE_INJECTION === 'false'`), the system
prompt falls through to `MODEL_PRESETS`, and behaviour returns to the
pre-Atlas state exactly. This is the preferred backout: one line, no code
conflict, instantly reversible by setting it back to `"1"` and redeploying.

## Full revert — one command per app

Reverts to the last commit without this feature. No D1 change needed, because
the tables are inert once the code stops reading them.

**Dashboard — clean from HEAD:**

```powershell
cd "Generative AI Dashboard"
git revert --no-edit 2239e3c
git revert --no-edit 44dc2f2
cd client; npm run build; cd ..
npx wrangler deploy
```

**MuAPI — clean from HEAD:**

```powershell
cd muapi-prompt-generator
git revert --no-edit 5592781
git revert --no-edit e1160a8
git revert --no-edit 4e16d00
cd client; npm run build; cd ..
npx wrangler deploy
```

**WaveSpeed — clean from HEAD:**

```powershell
cd wavespeed-prompt-generator
git revert --no-edit 3e31779
git revert --no-edit 5e61c83
git revert --no-edit dbd4a6e
cd client; npm run build; cd ..
npx wrangler deploy
```

**Replicate — `f90c324` conflicts, expect to resolve by hand:**

```powershell
cd replicate-prompt-orchestrator
git revert --no-edit 51226eb      # clean
git revert --no-edit f53e493      # clean
git revert --no-edit f90c324      # CONFLICT in src/worker.js
```

`fb01c20` ("Replace the 16-model hand list with Replicate's real catalogue")
rewrote the `/api/models` handler in `src/worker.js` after the injection
landed, and that is the same region `f90c324` had reflowed. Reverting all
three reverts is only clean if you also undo `fb01c20`, which you almost
certainly do not want. Two workable options:

1. **Kill switch only** (recommended). Leave the code in place, set
   `GUIDE_INJECTION = "0"`, deploy. Same runtime result, zero conflict.
2. **Revert the two clean commits and hand-resolve.** After the conflict,
   in `src/worker.js` keep `fb01c20`'s D1-backed `/api/models` block and drop
   only the guide-injection lines from `f90c324` — the
   `buildEnhancerSystemPrompt` guide block, the `getPromptGuideBlock`
   helper, and the `ctx.guideBlock` plumbing. Then `git add src/worker.js &&
   git revert --continue`, and remove `GUIDE_INJECTION` from `wrangler.toml`
   if you want the code path fully gone.

Dashboard is optional to revert regardless: `/api/guides` is read-only and
nothing in the apps depends on it being present.

## Roll forward instead

If the fix is small, prefer reverting the *change* on top of the feature
commit. That keeps the guide plumbing and lands a correction:

```powershell
cd <app>; git revert --no-edit <bad-commit>; cd client; npm run build; cd ..; npx wrangler deploy
```

Remember the guide-injection tip is three commits per app, not one — see the
[lineage table](#commit-lineage-per-app).

## D1 rollback

Only needed if `prompt_guides` itself must go. The apps tolerate the table
being absent — every query is wrapped and returns `null` on error — so this is
cosmetic.

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
cd client; npm run build                                # client still builds
cd <app>; node scripts/test-enhancer-prompt.mjs          # if the test still exists
```

Then in the browser: enhance a prompt on a model that has a guide
(`flux-dev`) and confirm the output is still sane. With the kill switch at
`"0"` the injected "Model-specific conventions" block must be **absent** from
the enhanced result. After a full revert, `git log --oneline -1` no longer
shows an injection commit.

## Pre-deploy checklist

- `npm run build` in `client/`
- resolver audit passes: no model resolves to a `guide_key` absent from
  `prompt_guides` (see `scripts/audit-guide-mapping.mjs`)
- unguided models still hit `MODEL_PRESETS`
- `node scripts/test-enhancer-prompt.mjs` (three generator apps) — the guard
  against the `guide is not defined` regression

Note: `npx tsc --noEmit` is **not** a gate for the Dashboard — its `client/`
is plain JS/JSX with no `typescript` dependency and no `tsconfig.json`, so
`npx tsc` fails on the placeholder shim rather than on any type error. The
three generator apps are TypeScript and do use it.

## Resolver and provenance (verified current)

- `scripts/prompt-guide-resolver.mjs` (Dashboard) is the single place a model
  id becomes a `guide_key`. Exports `isExcludedModel`, `resolveGuideFamily`,
  `resolveGuideKey`, `guideForModel`. `resolveGuideKey` returns `null` rather
  than guessing — a wrong guide would assert syntax the model does not
  support — so callers fall through to `MODEL_PRESETS`. It is
  modality-aware as of `2239e3c`.
- `scripts/audit-guide-mapping.mjs` (Dashboard) walks every catalogue model
  and asserts a `guide_key` is either absent or present in `prompt_guides`.
- `atlas:<guide_key>` provenance is written by the three generator apps when
  an enhancement is stored: the `enhancements` row's source is
  `'atlas:' + guide_key` when a guide was injected, and `'v0-preset'` when the
  `MODEL_PRESETS` fallback was used. That single field is how you tell, after
  the fact, which path produced any given enhancement — check it before
  blaming the kill switch for a regression.

## Known-good state

Last verified: all four Workers deployed; `prompt_guides` holds **38** rows
(D1 `genai-history`, confirmed by SELECT), `guide_import_meta` holds 1 row;
resolver audit reports 0 broken lookups. Deployed versions as tabled above.

**Needs a second look:** the deployed-version column is a point-in-time
record. Three repos have taken commits since those deploys, so before relying
on this table during an incident, confirm what is actually live with
`npx wrangler deployments list` per app rather than assuming the listed
version is still current.