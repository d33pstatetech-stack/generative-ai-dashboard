// Prompt Atlas extractor (Phase 1).
//
// Reads client/public/prompt-atlas.html — a single self-contained file whose
// `<script>` block defines `MANIFEST` and `GUIDES` as JSON object literals —
// and emits deterministic INSERT SQL for the shared genai-history tables in
// migrations/0003_prompt_guides.sql.
//
//   node scripts/extract-prompt-atlas.mjs [--html <path>] [--out <path>] [--dry]
//
// Parsing is dependency-free: the two constants are extracted by brace
// balancing and JSON.parse'd. No HTML parser — the guide bodies are a fixed
// shape (h2 sections, tables, pre blocks) that is stripped with targeted
// regexes.
//
// The important output is `enhancer_md`: a condensed, per-model block injected
// into the /api/enhance system prompt. It replaces the apps' hardcoded
// MODEL_PRESETS, which covers 4 video families and leaves every image model
// on the empty `default` string. It is deliberately built from *extracted*
// fields only — never invented — so nothing reaches the LLM that is not
// traceable to a cell in the source guide.
//
// Output: literal INSERT OR REPLACE statements (single-quote doubling),
// sorted by guide_key for determinism — directly applicable via
// `wrangler d1 execute --file`. Counts go to stdout as JSON.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');

/* ---------------------------------------------------------------- args */

function arg(name, dflt) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}
const HTML_PATH = resolve(arg('--html', join(REPO, 'client', 'public', 'prompt-atlas.html')));
const OUT_PATH = resolve(arg('--out', join(HERE, 'seed-prompt-guides.sql')));
const DRY = process.argv.includes('--dry');

/* -------------------------------------------------- extract the literals */

/** Read a `const NAME = {...};` literal out of a script body by brace balancing. */
function readJsonConst(src, name) {
  const marker = `const ${name} = `;
  const start = src.indexOf(marker);
  if (start === -1) throw new Error(`${name} not found in source`);
  const open = src.indexOf('{', start + marker.length - 1);
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return JSON.parse(src.slice(open, i + 1));
    }
  }
  throw new Error(`unbalanced braces in ${name}`);
}

const src = readFileSync(HTML_PATH, 'utf8');
const MANIFEST = readJsonConst(src, 'MANIFEST');
const GUIDES = readJsonConst(src, 'GUIDES');

/* ------------------------------------------------------- tiny HTML utils */

const ENTITIES = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"',
  '&#39;': "'", '&apos;': "'", '&nbsp;': ' ', '&mdash;': '—',
  '&ndash;': '–', '&hellip;': '…', '&rsquo;': '’', '&lsquo;': '‘',
  '&ldquo;': '“', '&rdquo;': '”', '&times;': '×', '&rarr;': '→',
  '&larr;': '←', '&middot;': '·', '&bull;': '•', '&ge;': '≥',
  '&le;': '≤', '&check;': '✓', '&cross;': '✗',
};

function decode(s) {
  return String(s)
    .replace(/&(?:[a-zA-Z]+|#\d+);/g, (m) => {
      if (ENTITIES[m]) return ENTITIES[m];
      const num = /^&#(\d+);$/.exec(m);
      return num ? String.fromCharCode(Number(num[1])) : m;
    });
}

const stripTags = (s) =>
  decode(
    String(s)
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/(p|div|tr|li|h\d)>/gi, ' ')
      .replace(/<[^>]+>/g, '')
  ).replace(/\s+/g, ' ').trim();

/** Split a guide body into `{ title, html }` per <h2>, dropping the hr separators. */
function sections(html) {
  const out = [];
  const re = /<h2>([\s\S]*?)<\/h2>/gi;
  const marks = [];
  let m;
  while ((m = re.exec(html))) marks.push({ title: stripTags(m[1]), at: m.index, end: re.lastIndex });
  // leading block before the first h2 is the Model/Developer/Type header
  if (marks.length) {
    const pre = html.slice(0, marks[0].at);
    if (pre.trim()) out.push({ title: '_header', html: pre });
  }
  marks.forEach((mk, i) => {
    const stop = i + 1 < marks.length ? marks[i + 1].at : html.length;
    out.push({ title: mk.title, html: html.slice(mk.end, stop) });
  });
  return out;
}

/** Parse every <table> in a section into { head, rows }. */
function tables(html) {
  const out = [];
  const re = /<table>([\s\S]*?)<\/table>/gi;
  let m;
  while ((m = re.exec(html))) {
    const body = m[1];
    const rows = [];
    // `\b[^>]*` so rows/cells carrying attributes still match.
    const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    let tr;
    let head = [];
    while ((tr = trRe.exec(body))) {
      const cells = [];
      const tdRe = /<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi;
      let td;
      while ((td = tdRe.exec(tr[1]))) cells.push(stripTags(td[1]));
      if (!cells.length) continue;
      // The first <tr> holding any <th> is the header; a table whose first
      // row is all <td> has no header, so don't let it consume a data row.
      const isHeaderRow = /<th\b/i.test(tr[1]);
      if (isHeaderRow && !head.length) head = cells;
      else rows.push(cells);
    }
    if (rows.length) out.push({ head, rows });
  }
  return out;
}

/** Text of every <pre> block — the code scaffolds and worked examples. */
function pres(html) {
  const out = [];
  const re = /<pre[^>]*>([\s\S]*?)<\/pre>/gi;
  let m;
  while ((m = re.exec(html))) {
    const t = decode(m[1].replace(/<[^>]+>/g, '')).replace(/^\n+|\n+$/g, '');
    if (t.trim()) out.push(t);
  }
  return out;
}

const firstTable = (secs, title) => {
  const s = secs.find((x) => x.title === title);
  return s ? tables(s.html) : [];
};
const sec = (secs, title) => secs.find((x) => x.title === title) || { title, html: '' };

/* ---------------------------------------------------- field normalising */

// "Yes (community)" -> "yes", "Not supported" -> "no", "Unknown" -> "unknown".
function normalizeSupport(v) {
  const s = stripTags(v).toLowerCase();
  if (!s) return 'unknown';
  if (s.startsWith('unknown') || s === 'n/a') return 'unknown';
  if (s.startsWith('no') || s.startsWith('not supported') || s.includes('not supported')) return 'no';
  if (s.startsWith('yes') || s.startsWith('supported') || s.startsWith('supported (')) return 'yes';
  if (s.includes('partial')) return 'partial';
  if (s.includes('not documented')) return 'unknown';
  return s;
}

const num = (v) => {
  const t = stripTags(v).replace(/[^0-9.]/g, '');
  const f = parseFloat(t);
  return Number.isFinite(f) ? f : null;
};

/* --------------------------------------------------- per-guide extraction */

/**
 * Build the condensed block that gets injected into the enhancer system
 * prompt. Every line traces to a parsed cell — this is the piece that fixes
 * image models having no conventions at all.
 */
function buildEnhancerBlock(g, modelLabel, versionLabel, modality) {
  const L = [];
  const syntax = g.syntax;
  const supported = syntax.filter((s) => s.supported === 'yes').map((s) => s.syntax);
  const unsupported = syntax.filter((s) => s.supported === 'no').map((s) => s.syntax);
  const partial = syntax.filter((s) => s.supported === 'partial').map((s) => s.syntax);

  L.push(`Target model: ${modelLabel} ${versionLabel} (${modality}).`);

  // Field names must match the row object built in extractGuide(): the row
  // stores the principle under `principle_md` (it is a *_md column).
  const principle = g.principle_md || g.principle || '';
  if (principle) {
    // First two sentences carry prose-vs-tags and structure; the rest is detail.
    // Guard against abbrevs ("T5-XXL encoder was trained on prose, so grammar")
    // — require the terminator to be followed by a space+capital or the end.
    // Sentence-splitting is unsafe here: model names are dense with periods
    // ("FLUX.1's", "Kling 3.0", "T5-XXL", "e.g.") and every attempt to
    // reassemble fragments mangles them. These paragraphs are already tight,
    // so pass the whole thing and cap it.
    L.push(`How to prompt it: ${principle.length > 420 ? `${principle.slice(0, 420).trim()}…` : principle}`);
  }

  const ideal = g.length.find((r) => /^ideal$/i.test(r.length));
  const tooShort = g.length.find((r) => /too short/i.test(r.length));
  const tooLong = g.length.find((r) => /too long/i.test(r.length));
  if (ideal || tooShort || tooLong) {
    const bits = [];
    if (tooShort) bits.push(`too short: ${tooShort.effect}`);
    if (ideal) bits.push(`ideal: ${ideal.effect}`);
    if (tooLong) bits.push(`too long: ${tooLong.effect}`);
    L.push(`Prompt length — ${bits.join(' | ')}`);
  }

  if (syntax.length) {
    const bits = [];
    if (supported.length) bits.push(`supported: ${supported.join(', ')}`);
    if (partial.length) bits.push(`partial: ${partial.join(', ')}`);
    if (unsupported.length) bits.push(`NOT supported: ${unsupported.join(', ')}`);
    if (bits.length) L.push(`Syntax — ${bits.join(' | ')}`);
  }

  const neg = syntax.find((s) => /negative/i.test(s.syntax));
  if (neg) L.push(`Negative prompt: ${neg.supported.toUpperCase()} — ${neg.notes || ''}`.trim());

  if (g.structure) L.push(`Structure to follow: ${g.structure}`);
  if (g.include.length) L.push(`Include: ${g.include.slice(0, 6).map((r) => r.include).join('; ')}`);
  if (g.avoid.length) L.push(`Avoid: ${g.avoid.slice(0, 6).map((r) => r.instead).join('; ')}`);
  if (g.settings.length) {
    L.push(
      `Recommended settings: ${g.settings.slice(0, 6).map((r) => `${r.param} ${r.value}`).join('; ')}`
    );
  }
  if (g.mistakes.length) {
    L.push(`Common mistakes: ${g.mistakes.slice(0, 5).map((r) => r.title).join('; ')}`);
  }
  return L.join('\n');
}

function extractGuide(guideKey, guide, manifestEntry, group) {
  const [, modelId, tabIdxStr] = guideKey.split('/');
  const tabIndex = parseInt(tabIdxStr, 10) || 0;
  const model = manifestEntry.models.find((m) => m.id === modelId);
  if (!model) throw new Error(`no manifest entry for ${guideKey}`);
  const tab = model.tabs[tabIndex];
  if (!tab) throw new Error(`no tab ${tabIndex} for ${guideKey}`);

  const body = guide.html || '';
  const secs = sections(body);

  // Core Prompting Principle — first non-empty paragraph. Guide bodies use
  // either "Core Prompting Principle" or "Core Principle" (cross-family page).
  // Components pages have no principle section at all, which is fine: they are
  // option tables and never feed the enhancer block.
  const prSec = sec(secs, 'Core Prompting Principle').html
    ? sec(secs, 'Core Prompting Principle')
    : sec(secs, 'Core Principle');
  const prParas = (prSec.html.match(/<p>([\s\S]*?)<\/p>/gi) || [])
    .map((p) => stripTags(p))
    .filter((p) => p && !/^[\s❌✅]*\s*(DON'?T|DO)\b/i.test(p));
  const principle = prParas[0] || '';

  // Prompt Syntax
  const syntaxT = firstTable(secs, 'Prompt Syntax')[0];
  const syntax = syntaxT
    ? syntaxT.rows
        .filter((r) => r.length >= 2 && r[0] && !/^\s*$/i.test(r[0]))
        .map((r) => ({
          syntax: r[0],
          supported: normalizeSupport(r[1]),
          notes: r[2] || '',
        }))
    : [];

  // Ideal Prompt Length
  const lenT = firstTable(secs, 'Ideal Prompt Length')[0];
  const length = lenT
    ? lenT.rows
        .filter((r) => r.length >= 2 && r[0])
        .map((r) => ({ length: r[0], effect: r[1] || '' }))
    : [];

  // Prompt Structure — the pre block is the scaffold; keep the first one.
  const stSec = sec(secs, 'Prompt Structure');
  const stPres = pres(stSec.html);
  const structure = stPres.length ? stPres[0].replace(/\s*\n\s*/g, ' → ').slice(0, 600) : '';

  // What to Include / Avoid (two-column "Instead of… Write…")
  const incT = firstTable(secs, 'What to Include')[0];
  const include = incT
    ? incT.rows.filter((r) => r.length >= 2 && r[0]).map((r) => ({ include: r[0], examples: r[1] || '' }))
    : [];
  const avT = firstTable(secs, 'What to Avoid')[0];
  const avoid = avT
    ? avT.rows.filter((r) => r.length >= 2 && r[0]).map((r) => ({ instead: r[0], write: r[1] || '' }))
    : [];

  // Recommended Settings
  const setT = firstTable(secs, 'Recommended Settings')[0];
  const settings = setT
    ? setT.rows
        .filter((r) => r.length >= 2 && r[0])
        .map((r) => ({ param: r[0].replace(/\*+/g, ''), value: r[1] || '' }))
    : [];

  // Common Mistakes — <li> with a leading <strong>
  const misSec = sec(secs, 'Common Mistakes to Avoid');
  const mistakes = [];
  const liRe = /<li>([\s\S]*?)<\/li>/gi;
  let li;
  while ((li = liRe.exec(misSec.html))) {
    const inner = li[1];
    const strong = /<strong>([\s\S]*?)<\/strong>/i.exec(inner);
    if (!strong) continue;
    mistakes.push({
      title: stripTags(strong[1]),
      detail: stripTags(inner.replace(strong[0], '')),
    });
  }

  // Sources
  const srcSec = sec(secs, 'Sources');
  const sources = [];
  const aRe = /<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let a;
  while ((a = aRe.exec(srcSec.html))) sources.push({ url: a[1], note: stripTags(a[2]) });
  const liRe2 = /<li>([\s\S]*?)<\/li>/gi;
  while ((li = liRe2.exec(srcSec.html))) {
    const u = /https?:\/\/[^\s<)]+/.exec(stripTags(li[1]));
    if (u) sources.push({ url: u[0], note: stripTags(li[1]).slice(0, 300) });
  }

  const modality = group.id === 'components' ? 'components' : group.id;
  const versionMatch = (tab.label || '').toLowerCase();

  const row = {
    guide_key: guideKey,
    group_id: group.id,
    model_family: model.id,
    model_label: model.label,
    version_label: tab.label || '',
    version_match: versionMatch,
    tab_index: tabIndex,
    modality,
    title: guide.title || '',
    source_file: guide.file || tab.file || '',
    pairs: guide.pairs || 0,
    principle_md: principle,
    syntax,
    length,
    structure_md: structure,
    include,
    avoid,
    settings,
    mistakes,
    summary_md: stripTags(sec(secs, 'Overview').html).slice(0, 4000),
    sources,
    content_hash: createHash('sha256').update(String(guide.html || '')).digest('hex').slice(0, 32),
  };
  row.enhancer_md = buildEnhancerBlock(row, model.label, tab.label || '', modality);
  return row;
}

/* ------------------------------------------------------------- extraction */

const rows = [];
const warnings = [];
for (const group of MANIFEST.groups) {
  for (const model of group.models) {
    model.tabs.forEach((tab, i) => {
      const key = `${group.id}/${model.id}/${i}`;
      const guide = GUIDES[key];
      if (!guide) {
        warnings.push(`missing guide: ${key}`);
        return;
      }
      try {
        rows.push(extractGuide(key, guide, group, { id: group.id }));
      } catch (e) {
        warnings.push(`failed ${key}: ${e.message}`);
      }
    });
  }
}
rows.sort((a, b) => (a.guide_key < b.guide_key ? -1 : a.guide_key > b.guide_key ? 1 : 0));

/* ------------------------------------------------------------ SQL emission */

const q = (v) => {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? '1' : '0';
  return `'${String(v).replace(/'/g, "''")}'`;
};
const j = (v) => q(JSON.stringify(v));

const COLS = [
  'guide_key', 'group_id', 'model_family', 'model_label', 'version_label',
  'version_match', 'tab_index', 'modality', 'title', 'source_file', 'pairs',
  'principle_md', 'syntax_json', 'length_json', 'structure_md', 'include_json',
  'avoid_json', 'settings_json', 'mistakes_json', 'enhancer_md', 'summary_md',
  'sources_json', 'content_hash',
];

const stmts = [
  '-- Prompt Atlas guides — GENERATED by scripts/extract-prompt-atlas.mjs. Do not edit.',
  `-- source: client/public/prompt-atlas.html (${src.length} bytes)`,
  `-- guides: ${rows.length}, compiled: 2026-10-06`,
  '',
];
for (const r of rows) {
  stmts.push(
    `INSERT OR REPLACE INTO prompt_guides (${COLS.join(', ')}) VALUES (${COLS.map((c) => {
      if (c.endsWith('_json')) return j(r[c.slice(0, -5)]);
      return q(r[c]);
    }).join(', ')});`
  );
}
const totalHash = createHash('sha256').update(src).digest('hex').slice(0, 32);
stmts.push(
  '',
  `INSERT OR REPLACE INTO guide_import_meta (id, source_file, source_bytes, compiled_at, guide_count, content_hash)`,
  `VALUES (1, ${q('client/public/prompt-atlas.html')}, ${src.length}, ${q('2026-10-06')}, ${rows.length}, ${q(totalHash)});`,
  ''
);

const sql = stmts.join('\n');
if (DRY) {
  console.log(sql);
} else {
  writeFileSync(OUT_PATH, sql, 'utf8');
}

/* ----------------------------------------------------------------- report */

const byGroup = {};
const withSyntax = { yes: 0, no: 0, partial: 0, unknown: 0 };
let enhancerChars = 0;
for (const r of rows) {
  byGroup[r.group_id] = (byGroup[r.group_id] || 0) + 1;
  enhancerChars += r.enhancer_md.length;
  for (const s of r.syntax) if (s.supported in withSyntax) withSyntax[s.supported]++;
}
console.error(
  JSON.stringify(
    {
      ok: true,
      out: DRY ? '(dry)' : OUT_PATH,
      guides: rows.length,
      byGroup,
      families: new Set(rows.map((r) => r.model_family)).size,
      syntaxRows: withSyntax,
      avgEnhancerChars: rows.length ? Math.round(enhancerChars / rows.length) : 0,
      totalPairs: rows.reduce((n, r) => n + r.pairs, 0),
      warnings: warnings.slice(0, 10),
      warningCount: warnings.length,
    },
    null,
    2
  )
);
if (warnings.length) process.exitCode = 1;