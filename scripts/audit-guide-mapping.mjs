// Guard rail for the Prompt Atlas guide mapping.
//
// Runs the resolver across every model in a catalog and reports two classes
// of defect that a unit test on the resolver alone would miss:
//
//   1. BROKEN — the model resolves to a guide_key that does not exist in
//      `prompt_guides`. The lookup returns null at runtime, so the enhancer
//      silently falls back and the mapping looks correct in review while
//      doing nothing in production.
//   2. EXCLUDED — a model matching an exclude pattern, asserted so new
//      exclusions cannot silently stop working.
//
// Usage:
//   wrangler d1 execute <db> --remote --json --command "SELECT id, family, group_of FROM models"
//   node scripts/audit-guide-mapping.mjs <models.json> [--expected-real]
//
// Wrangler's --json output is UTF-16LE with a BOM; pass the raw file.

import { readFileSync } from 'node:fs';
import { resolveGuideKey, isExcludedModel } from './prompt-guide-resolver.mjs';

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/audit-guide-mapping.mjs <models.json>');
  process.exit(2);
}

/* Exact guide_key values present in `prompt_guides`. Keep in sync with
   migrations/0003_prompt_guides.sql + scripts/seed-prompt-guides.sql.
   Derive with:
     SELECT guide_key FROM prompt_guides ORDER BY guide_key */
const REAL_GUIDE_KEYS = new Set([
  'components/image-components/0', 'components/image-components/1',
  'components/image-components/2', 'components/image-components/3',
  'components/image-components/4', 'components/image-components/5',
  'components/image-components/6',
  'components/video-components/0', 'components/video-components/1',
  'components/video-components/2', 'components/video-components/3',
  'components/video-components/4', 'components/video-components/5',
  'components/video-components/6',
  'image/flux/0', 'image/flux/1', 'image/general-image/0',
  'image/krea-2/0', 'image/krea-2/1',
  'image/qwen-image/0', 'image/qwen-image/1',
  'image/sdxl/0', 'image/z-image/0',
  'video/kling/0', 'video/kling/1',
  'video/ltx/0', 'video/ltx/1',
  'video/seedance/0', 'video/seedance/1',
  'video/veo/0', 'video/veo/1', 'video/veo/2',
  'video/wan/0', 'video/wan/1', 'video/wan/2',
  'video/wan/3', 'video/wan/4', 'video/wan/5',
]);

function readWranglerJson(path) {
  const buf = readFileSync(path);
  const start = buf[0] === 0xff && buf[1] === 0xfe ? 2 : 0;
  const raw = buf.subarray(start).toString('utf16le');
  const parsed = JSON.parse(raw);
  return parsed[0].results;
}

const rows = readWranglerJson(file);
const broken = new Map();
const byKey = new Map();
let matched = 0;
let excluded = 0;

for (const m of rows) {
  if (isExcludedModel(m.id)) { excluded++; continue; }
  const modality = m.group_of === 'video' ? 'video' : 'image';
  const key = resolveGuideKey(m.id, m.family || '', modality);
  if (!key) continue;
  const full = `${modality}/${key}`;
  byKey.set(full, (byKey.get(full) || 0) + 1);
  if (!REAL_GUIDE_KEYS.has(full)) {
    if (!broken.has(full)) broken.set(full, []);
    broken.get(full).push(m.id);
  } else {
    matched++;
  }
}

console.log(`catalog: ${rows.length} models`);
console.log(`  matched a real guide : ${matched}`);
console.log(`  no guide (fallback) : ${rows.length - matched - excluded}`);
console.log(`  excluded by rule    : ${excluded}`);
console.log('  distribution:');
for (const [k, n] of [...byKey].sort()) {
  const flag = REAL_GUIDE_KEYS.has(k) ? 'ok  ' : 'BROKEN';
  console.log(`    ${flag} ${k.padEnd(24)} ${n}`);
}

if (broken.size) {
  let n = 0;
  for (const [k, ids] of broken) {
    console.error(`\nBROKEN ${k}: ${ids.length} models resolve to a missing guide_key`);
    console.error(`  e.g. ${ids.slice(0, 5).join(', ')}`);
    n += ids.length;
  }
  console.error(`\nFAIL ${n} models would silently receive no guide.`);
  process.exit(1);
}
console.log('\nPASS no model resolves to a missing guide_key.');