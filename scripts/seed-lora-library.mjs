// Seed generator for the central LoRA library (Phase A).
//
// Reads the three apps' curated seed data + verification records and emits
// deterministic INSERT SQL for the shared genai-history DB tables created by
// migrations/0002_central_lora_library.sql:
//
//   node scripts/seed-lora-library.mjs [--out <path>]
//
// Inputs (live branches, read-only — this script never writes to them):
//   ../..//<app>/client/src/loras-data.js      CURATED_LORAS + OWN_LORAS + NSFW_LORAS + VERIFIED_LORA_RUNS
//   ../../replicate-prompt-orchestrator/client/src/lib/loraFormats.ts  CONFIRMED_LORA_RUNS
//   (loraFormats.ts is byte-identical across the three apps; replicate's copy is parsed)
//
// Union + dedupe:
//   library key  = (id || file_url)          — mirrors the D1 dedupe key owner/repo from the header comments
//   duplicates across apps resolve first-seen-wins in fixed app order
//     [replicate, muapi, wavespeed] x [CURATED, OWN, NSFW]; any field-level
//     drift is reported on stderr (none expected — files are identical outside VERIFIED_LORA_RUNS)
//   per-app file_url overrides (file_url_muapi/_replicate/_wavespeed) are preserved
//     when present; no current entry sets them, so all seed to NULL.
//   group_name uses the same AZNTEN_RE rule as loras-data.js: nsfw flag wins,
//     then /aznten|asian[- ]ten|d33pstate/i on "name id", else misc.
//
// Verifications union:
//   VERIFIED_LORA_RUNS rows carry {lora, model, job, when}; the app column is
//     inferred from the model id prefix (wavespeed-ai/* -> wavespeed, muapi ids
//     -> muapi, d33pstatetech-stack/*|qwen/*|wan-video/* -> replicate), falling
//     back to the source file's app. Shared rows dedupe to one triple.
//   CONFIRMED_LORA_RUNS rows carry {model, apps[], loras[]} with no job/date
//     (job_id/ran_at seed to NULL). Full-URL loras normalize to the canonical
//     library id via file_url match; ids with no library row (e.g. civitai:*
//     shorthand) are kept verbatim and reported as dangling.
//   VERIFIED job info wins on triple collisions.
//
// Output: literal INSERT OR REPLACE statements (single-quote doubling), sorted
// by id for determinism — directly applicable via `wrangler d1 execute --file`.
// Literal (not ?-placeholder) form is required because D1 file execution takes
// raw SQL; values are escaped deterministically. Summary counts go to stdout
// as JSON; the SQL goes to scripts/seed-lora-library.sql by default.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = dirname(dirname(here)); // ".../New OpenCode Project"

const APPS = ['replicate-prompt-orchestrator', 'muapi-prompt-generator', 'wavespeed-prompt-generator'];
const APP_SHORT = { 'replicate-prompt-orchestrator': 'replicate', 'muapi-prompt-generator': 'muapi', 'wavespeed-prompt-generator': 'wavespeed' };

// Same rule as loras-data.js — keep in sync by hand (deliberately duplicated, like the clients do).
const AZNTEN_RE = /aznten|asian[- ]ten|d33pstate/i;

// Same family buckets as lora-compat.js loraFamily().
function baseFamily(baseModel) {
  const b = String(baseModel || '');
  if (/flux/i.test(b)) return 'FLUX.1';
  if (/qwen/i.test(b)) return 'Qwen-Image';
  if (/krea/i.test(b)) return 'Krea';
  if (/wan[-\s_]?2\.1/i.test(b)) return 'Wan 2.1';
  if (/wan[-\s_]?2\.2/i.test(b)) return 'Wan 2.2';
  if (/wan/i.test(b)) return 'Wan (other)';
  return 'Other / unstamped';
}

function deriveSource(e) {
  const id = String(e.id || '');
  const repoUrl = String(e.repo_url || '');
  if (/^civitai:/i.test(id) || /civitai\.com/i.test(repoUrl)) return 'civitai';
  if (/huggingface\.co/i.test(repoUrl) || /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(id)) return 'hf';
  if (/^https?:\/\//i.test(String(e.file_url || ''))) return 'direct';
  return 'custom';
}

function triggersOf(e) {
  if (Array.isArray(e.triggers)) return e.triggers.map(String).filter((s) => s.trim()).slice(0, 12);
  const ip = String(e.instance_prompt || '').trim();
  return ip ? [ip] : [];
}

// Model id -> app for VERIFIED rows (which carry no app field).
function inferApp(model, fallback) {
  const m = String(model || '');
  if (/^wavespeed-ai\//.test(m)) return 'wavespeed';
  if (/^(krea-v2-turbo-lora|qwen-image-text-to-image-2512-lora|flux-1-dev-style-lora-inference|flux-schnell|qwen-image-text-to-image|wan2\.1-|qwen-image-2)/.test(m)) return 'muapi';
  if (/^(d33pstatetech-stack\/|qwen\/|wan-video\/)/.test(m)) return 'replicate';
  return fallback;
}

// Parse CONFIRMED_LORA_RUNS from the TS source (no TS toolchain needed).
function parseConfirmed(tsText) {
  const blocks = [];
  const blockRe = /\{\s*model:\s*'([^']+)'\s*,\s*apps:\s*\[([^\]]*)\]\s*,\s*loras:\s*\[([^\]]*)\]/g;
  let m;
  while ((m = blockRe.exec(tsText))) {
    const str = (s) => [...s.matchAll(/'([^']+)'/g)].map((x) => x[1]);
    blocks.push({ model: m[1], apps: str(m[2]), loras: str(m[3]) });
  }
  return blocks;
}

const sqlLit = (v) => {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  return `'${String(v).replace(/'/g, "''")}'`;
};

async function main() {
  const outIdx = process.argv.indexOf('--out');
  const outPath = outIdx >= 0 && process.argv[outIdx + 1]
    ? resolve(process.argv[outIdx + 1])
    : join(here, 'seed-lora-library.sql');

  // --- Load the three apps' seed data -------------------------------------
  const perApp = {};
  for (const app of APPS) {
    const p = join(projectRoot, app, 'client', 'src', 'loras-data.js');
    const mod = await import(pathToFileURL(p).href);
    perApp[app] = {
      CURATED: mod.CURATED_LORAS || [],
      OWN: mod.OWN_LORAS || [],
      NSFW: mod.NSFW_LORAS || [],
      VERIFIED: mod.VERIFIED_LORA_RUNS || [],
    };
  }

  // --- Confirm loraFormats.ts is still identical across apps; parse once ---
  const fmtTexts = {};
  for (const app of APPS) {
    fmtTexts[app] = readFileSync(join(projectRoot, app, 'client', 'src', 'lib', 'loraFormats.ts'), 'utf8');
  }
  const hashes = Object.fromEntries(
    Object.entries(fmtTexts).map(([k, v]) => [k, createHash('sha256').update(v).digest('hex').slice(0, 12)]),
  );
  const fmtDrift = new Set(Object.values(hashes)).size !== 1;
  if (fmtDrift) console.error(`WARN: loraFormats.ts differs across apps: ${JSON.stringify(hashes)}`);
  const confirmed = parseConfirmed(fmtTexts['replicate-prompt-orchestrator']);

  // --- Union library entries ----------------------------------------------
  // key = id || file_url (spec: repo||file_url; entry.id IS the repo for hf rows)
  const lib = new Map(); // key -> { entry, from: {app, list}, nsfw }
  const driftNotes = [];
  const LISTS = [['CURATED', false], ['OWN', false], ['NSFW', true]];
  for (const app of APPS) {
    for (const [listName, nsfw] of LISTS) {
      for (const e of perApp[app][listName === 'CURATED' ? 'CURATED' : listName]) {
        const key = `${e.id || ''}||${e.file_url || ''}`;
        if (!lib.has(key)) {
          lib.set(key, { entry: e, from: { app, list: listName }, nsfw });
        } else {
          const prev = lib.get(key);
          prev.nsfw = prev.nsfw || nsfw;
          for (const f of ['name', 'repo_url', 'file', 'file_url', 'base_model', 'pipeline']) {
            if (String(prev.entry[f] || '') !== String(e[f] || '')) {
              driftNotes.push(`${key} field ${f}: ${prev.from.app} keeps precedence over ${app}`);
              break;
            }
          }
        }
      }
    }
  }
  if (driftNotes.length) console.error(`WARN: library drift:\n${driftNotes.join('\n')}`);

  const rows = [...lib.values()].map(({ entry: e, nsfw }) => {
    const name = String(e.name || e.id || '');
    const id = String(e.id || e.file_url || '');
    const group = nsfw ? 'nsfw' : AZNTEN_RE.test(`${name} ${id}`) ? 'aznten' : 'misc';
    return {
      id,
      name,
      source: deriveSource(e),
      repo: String(e.id || ''),
      repo_url: String(e.repo_url || ''),
      file: String(e.file || ''),
      file_url: String(e.file_url || ''),
      file_url_muapi: e.file_url_muapi || null,
      file_url_replicate: e.file_url_replicate || null,
      file_url_wavespeed: e.file_url_wavespeed || null,
      base_model: String(e.base_model || ''),
      base_family: baseFamily(e.base_model),
      pipeline: e.pipeline === 'video-generation' ? 'video-generation' : 'text-to-image',
      triggers_json: JSON.stringify(triggersOf(e)),
      nsfw: nsfw ? 1 : 0,
      group_name: group,
      note: String(e.note || ''),
      suggested_target: String(e.suggested_target || ''),
      muapi_model: String(e.muapi_model || ''),
      replicate_model: String(e.replicate_model || ''),
      wavespeed_model: String(e.wavespeed_model || ''),
    };
  }).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const fileUrlToId = new Map(rows.filter((r) => r.file_url).map((r) => [r.file_url, r.id]));
  const libIds = new Set(rows.map((r) => r.id));
  const overridesPreserved =
    rows.filter((r) => r.file_url_muapi || r.file_url_replicate || r.file_url_wavespeed).length;

  // --- Union verifications -------------------------------------------------
  // key = lora_id || model_id || app; VERIFIED job info wins over CONFIRMED NULLs.
  const ver = new Map();
  let verifiedRaw = 0;
  for (const app of APPS) {
    for (const v of perApp[app].VERIFIED) {
      verifiedRaw += 1;
      const loraId = String(v.lora || '');
      const modelId = String(v.model || '');
      const a = inferApp(modelId, APP_SHORT[app]);
      const key = `${loraId}||${modelId}||${a}`;
      const prev = ver.get(key);
      const jobId = v.job ? String(v.job) : null;
      const ranAt = v.when ? String(v.when) : null;
      if (!prev || (!prev.job_id && jobId)) ver.set(key, { lora_id: loraId, model_id: modelId, app: a, job_id: jobId, ran_at: ranAt });
    }
  }
  let confirmedRaw = 0;
  let confirmedNormalized = 0;
  for (const b of confirmed) {
    for (const a of b.apps) {
      for (const raw of b.loras) {
        confirmedRaw += 1;
        const loraId = fileUrlToId.get(raw) || raw;
        if (loraId !== raw) confirmedNormalized += 1;
        const key = `${loraId}||${b.model}||${a}`;
        if (!ver.has(key)) ver.set(key, { lora_id: loraId, model_id: b.model, app: a, job_id: null, ran_at: null });
      }
    }
  }
  const verRows = [...ver.values()].sort((a, b) =>
    (a.lora_id < b.lora_id ? -1 : a.lora_id > b.lora_id ? 1 : 0) ||
    (a.model_id < b.model_id ? -1 : a.model_id > b.model_id ? 1 : 0) ||
    (a.app < b.app ? -1 : a.app > b.app ? 1 : 0));
  const dangling = verRows.filter((v) => !libIds.has(v.lora_id)).length;

  // --- Emit SQL -------------------------------------------------------------
  const libCols = ['id', 'name', 'source', 'repo', 'repo_url', 'file', 'file_url', 'file_url_muapi', 'file_url_replicate', 'file_url_wavespeed', 'base_model', 'base_family', 'pipeline', 'triggers_json', 'nsfw', 'group_name', 'note', 'suggested_target', 'muapi_model', 'replicate_model', 'wavespeed_model'];
  const lines = [
    '-- Generated by scripts/seed-lora-library.mjs — do not hand-edit. Re-run the script.',
    `-- source files: ${APPS.map((a) => `${a}/client/src/loras-data.js`).join(', ')} + replicate loraFormats.ts CONFIRMED_LORA_RUNS`,
    `-- loraFormats.ts sha12: ${JSON.stringify(hashes)}${fmtDrift ? ' (DRIFT — see stderr)' : ''}`,
    `-- NOTE: no BEGIN/COMMIT wrapper — remote D1 --file execution rejects it.`,
  ];
  for (const r of rows) {
    lines.push(`INSERT OR REPLACE INTO lora_library (${libCols.join(', ')}) VALUES (${libCols.map((c) => sqlLit(r[c])).join(', ')});`);
  }
  for (const v of verRows) {
    lines.push(`INSERT OR REPLACE INTO lora_verifications (lora_id, model_id, app, job_id, ran_at) VALUES (${sqlLit(v.lora_id)}, ${sqlLit(v.model_id)}, ${sqlLit(v.app)}, ${sqlLit(v.job_id)}, ${sqlLit(v.ran_at)});`);
  }
  writeFileSync(outPath, lines.join('\n') + '\n');

  const byGroup = {};
  const bySource = {};
  for (const r of rows) {
    byGroup[r.group_name] = (byGroup[r.group_name] || 0) + 1;
    bySource[r.source] = (bySource[r.source] || 0) + 1;
  }
  console.log(JSON.stringify({
    entries: rows.length, byGroup, bySource,
    overridesPreserved,
    verifications: {
      verifiedRaw, confirmedRaw, confirmedNormalized, dangling, total: verRows.length,
    },
    loraFormatsDrift: fmtDrift,
    libraryDriftNotes: driftNotes.length,
    output: outPath,
  }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
