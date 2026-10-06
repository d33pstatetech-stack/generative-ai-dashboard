-- Prompt Atlas guides (Phase 1) — shared genai-history DB.
--
-- Seeded by Generative AI Dashboard/scripts/extract-prompt-atlas.mjs from
-- client/public/prompt-atlas.html (single self-contained file; the script
-- parses the embedded GUIDES/MANIFEST JSON with no dependencies).
--
-- Read by GET /api/guides/* in all four workers, and injected into the
-- /api/enhance system prompt in the three apps. Workers tolerate absent
-- tables (pre-migration) by returning empty guides and injecting nothing.

CREATE TABLE IF NOT EXISTS prompt_guides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guide_key TEXT NOT NULL UNIQUE,       -- MANIFEST/GUIDES key, e.g. image/flux/0
  group_id TEXT NOT NULL,               -- image|video|components
  model_family TEXT NOT NULL,           -- flux|sdxl|wan|seedance|kling|veo|...
  model_label TEXT NOT NULL,            -- FLUX
  version_label TEXT NOT NULL,          -- 1-dev|2.5|2.1|Raw|Turbo|...
  version_match TEXT NOT NULL,          -- lowercase substring that selects this version
  tab_index INTEGER NOT NULL DEFAULT 0, -- ordinal within the family (2.6 -> 3)
  modality TEXT NOT NULL,               -- image|video|components
  title TEXT NOT NULL,
  source_file TEXT NOT NULL DEFAULT '',
  pairs INTEGER NOT NULL DEFAULT 0,     -- good-vs-bad count from the guide
  principle_md TEXT NOT NULL DEFAULT '',  -- Core Prompting Principle, markdown
  syntax_json TEXT NOT NULL DEFAULT '[]', -- [{syntax, supported, notes}]
  length_json TEXT NOT NULL DEFAULT '[]', -- [{length, effect}]
  structure_md TEXT NOT NULL DEFAULT '',   -- Prompt Structure scaffold
  include_json TEXT NOT NULL DEFAULT '[]', -- [{include, examples}]
  avoid_json TEXT NOT NULL DEFAULT '[]',   -- [{instead, write}]
  settings_json TEXT NOT NULL DEFAULT '[]',-- [{param, value}]
  mistakes_json TEXT NOT NULL DEFAULT '[]',-- [{title, detail}]
  enhancer_md TEXT NOT NULL DEFAULT '',    -- condensed block for the system prompt
  summary_md TEXT NOT NULL DEFAULT '',      -- Overview + Technical Details
  sources_json TEXT NOT NULL DEFAULT '[]',  -- [{url, note}] provenance, blanks were unverified
  content_hash TEXT NOT NULL DEFAULT '',    -- sha256 of source_file body, for change detection
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_guides_family ON prompt_guides(model_family);
CREATE INDEX IF NOT EXISTS idx_guides_group ON prompt_guides(group_id);
CREATE INDEX IF NOT EXISTS idx_guides_modality ON prompt_guides(modality);

-- Which enhancer template version a guide supersedes. The apps' hardcoded
-- MODEL_PRESETS is video-only and leaves every image model on ''; guides
-- cover image families, so guide rows win when present.
CREATE TABLE IF NOT EXISTS guide_import_meta (
  id INTEGER PRIMARY KEY CHECK(id=1),
  source_file TEXT NOT NULL DEFAULT '',
  source_bytes INTEGER NOT NULL DEFAULT 0,
  compiled_at TEXT NOT NULL DEFAULT '',
  guide_count INTEGER NOT NULL DEFAULT 0,
  content_hash TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);