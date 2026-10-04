-- Central LoRA library (Phase A) — shared genai-history DB.
-- Seeded by Generative AI Dashboard/scripts/seed-lora-library.mjs from the
-- three apps' client/src/loras-data.js + lib/loraFormats.ts CONFIRMED blocks.
-- Read by GET /api/loras/library + /api/loras/verifications in all four workers.
-- Workers tolerate absent tables (pre-migration) by returning empty lists.

CREATE TABLE IF NOT EXISTS lora_library (
  id TEXT PRIMARY KEY,                    -- canonical owner/repo or full URL
  name TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'hf',     -- hf|civitai|direct|custom
  repo TEXT NOT NULL DEFAULT '',
  repo_url TEXT NOT NULL DEFAULT '',
  file TEXT NOT NULL DEFAULT '',
  file_url TEXT NOT NULL DEFAULT '',
  file_url_muapi TEXT,                    -- nullable per-app overrides (NULL = use file_url)
  file_url_replicate TEXT,
  file_url_wavespeed TEXT,
  base_model TEXT NOT NULL DEFAULT '',
  base_family TEXT NOT NULL DEFAULT '',
  pipeline TEXT NOT NULL DEFAULT 'text-to-image',
  triggers_json TEXT NOT NULL DEFAULT '[]',
  nsfw INTEGER NOT NULL DEFAULT 0,
  group_name TEXT NOT NULL DEFAULT 'misc', -- aznten|misc|nsfw (seed-computed via AZNTEN_RE + nsfw flag)
  note TEXT NOT NULL DEFAULT '',
  suggested_target TEXT NOT NULL DEFAULT '',
  muapi_model TEXT NOT NULL DEFAULT '',
  replicate_model TEXT NOT NULL DEFAULT '',
  wavespeed_model TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_lora_library_group ON lora_library(group_name);
CREATE INDEX IF NOT EXISTS idx_lora_library_family ON lora_library(base_family);
CREATE INDEX IF NOT EXISTS idx_lora_library_nsfw ON lora_library(nsfw);

CREATE TABLE IF NOT EXISTS lora_verifications (
  lora_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  app TEXT NOT NULL,                      -- muapi|replicate|wavespeed|dashboard
  job_id TEXT,                            -- NULL for CONFIRMED pairs without a recorded job
  ran_at TEXT,                            -- NULL for CONFIRMED pairs without a recorded date
  PRIMARY KEY (lora_id, model_id, app)
);
CREATE INDEX IF NOT EXISTS idx_lora_verifications_lora ON lora_verifications(lora_id);
CREATE INDEX IF NOT EXISTS idx_lora_verifications_model ON lora_verifications(model_id);
