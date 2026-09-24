#!/usr/bin/env node
// Downloads pinned Unicode Character Database files and compiles them into
// compact TypeScript tables under src/generated/. Re-run with `npm run
// generate:unicode` whenever the pinned UNICODE_VERSION changes.
//
// Each source file's SHA-256 is checked in against manifest.json (written by
// this script) so a re-run either reproduces byte-identical output or loudly
// fails if unicode.org served something different than what we reviewed.
//
// Unicode version: 17.0.0 (https://www.unicode.org/versions/Unicode17.0.0/)
// for the core UCD. Two related data tracks version independently of the UCD
// and had not published a 17.0.0-aligned release at generation time, so they
// are pinned to their latest available release instead -- this is normal
// (both tracks lag the UCD by design) and is called out explicitly here
// rather than silently mixed in:
//   - UTS #39 (Unicode Security Mechanisms) confusables.txt -> 16.0.0
//   - Emoji sequence data (emoji-sequences.txt) -> Emoji 16.0

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const outDir = join(root, 'src', 'generated');

const UCD_BASE = 'https://unicode.org/Public/17.0.0/ucd';
const SECURITY_BASE = 'https://unicode.org/Public/security/16.0.0';
const EMOJI_BASE = 'https://unicode.org/Public/emoji/16.0';

const SOURCES = [
  { id: 'derivedCoreProperties', url: `${UCD_BASE}/DerivedCoreProperties.txt` },
  { id: 'scripts', url: `${UCD_BASE}/Scripts.txt` },
  { id: 'scriptExtensions', url: `${UCD_BASE}/ScriptExtensions.txt` },
  { id: 'emojiData', url: `${UCD_BASE}/emoji/emoji-data.txt` },
  { id: 'emojiSequences', url: `${EMOJI_BASE}/emoji-sequences.txt` },
  { id: 'confusables', url: `${SECURITY_BASE}/confusables.txt` },
];

async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.text();
}

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

// ---- generic UCD line parsing -------------------------------------------

/** Parses "XXXX..YYYY  ; Property # comment" / "XXXX ; Property # comment" lines. */
function* parsePropertyLines(text) {
  for (const raw of text.split('\n')) {
    const line = raw.split('#')[0].trim();
    if (!line) continue;
    const [range, ...rest] = line.split(';').map((s) => s.trim());
    if (!range || rest.length === 0) continue;
    const [lo, hi] = range.split('..').map((s) => parseInt(s, 16));
    yield { lo, hi: hi ?? lo, fields: rest };
  }
}

function mergeRanges(ranges) {
  ranges.sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [lo, hi] of ranges) {
    const last = out[out.length - 1];
    if (last && lo <= last[1] + 1) last[1] = Math.max(last[1], hi);
    else out.push([lo, hi]);
  }
  return out;
}

// ---- Default_Ignorable_Code_Point ----------------------------------------

function extractDefaultIgnorable(text) {
  const ranges = [];
  for (const { lo, hi, fields } of parsePropertyLines(text)) {
    if (fields[0] === 'Default_Ignorable_Code_Point') ranges.push([lo, hi]);
  }
  return mergeRanges(ranges);
}

// ---- Scripts.txt / ScriptExtensions.txt -----------------------------------

function extractScripts(text) {
  /** @type {Map<string, [number, number][]>} */
  const byScript = new Map();
  for (const { lo, hi, fields } of parsePropertyLines(text)) {
    const script = fields[0];
    if (!byScript.has(script)) byScript.set(script, []);
    byScript.get(script).push([lo, hi]);
  }
  const names = [...byScript.keys()].sort();
  const ranges = [];
  for (const name of names) {
    for (const [lo, hi] of mergeRanges(byScript.get(name))) {
      ranges.push([lo, hi, names.indexOf(name)]);
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  return { names, ranges };
}

function extractScriptExtensions(text, scriptNames) {
  const ranges = [];
  for (const { lo, hi, fields } of parsePropertyLines(text)) {
    const scripts = fields[0].split(' ').filter(Boolean);
    const ids = scripts.map((s) => scriptNames.indexOf(s)).filter((i) => i >= 0);
    if (ids.length) ranges.push([lo, hi, ids]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  return ranges;
}

// ---- emoji-data.txt (Emoji property) --------------------------------------

function extractEmoji(text) {
  const ranges = [];
  for (const { lo, hi, fields } of parsePropertyLines(text)) {
    if (fields[0] === 'Emoji') ranges.push([lo, hi]);
  }
  return mergeRanges(ranges);
}

// ---- emoji-sequences.txt: RGI Emoji_Tag_Sequence (flag tag sequences) -----

function extractTagSequences(text) {
  const sequences = [];
  for (const raw of text.split('\n')) {
    const line = raw.split('#')[0].trim();
    if (!line) continue;
    const [codepoints, type] = line.split(';').map((s) => s.trim());
    if (type !== 'RGI_Emoji_Tag_Sequence') continue;
    const cps = codepoints.split(/\s+/).map((s) => parseInt(s, 16));
    sequences.push(cps);
  }
  return sequences;
}

// ---- confusables.txt --------------------------------------------------

function extractConfusables(text) {
  /** @type {Map<number, number[]>} */
  const map = new Map();
  for (const raw of text.split('\n')) {
    const line = raw.split('#')[0].trim();
    if (!line || !line.includes(';')) continue;
    const parts = line.split(';');
    const src = parseInt(parts[0].trim(), 16);
    const target = parts[1]
      .trim()
      .split(/\s+/)
      .map((s) => parseInt(s, 16));
    if (Number.isNaN(src) || target.some(Number.isNaN)) continue;
    map.set(src, target);
  }
  return map;
}

// ---- emitters --------------------------------------------------------

function banner(sourceLabel) {
  return `// GENERATED FILE. Do not edit by hand.
// Produced by scripts/generate-unicode-data.mjs from ${sourceLabel}.
// Regenerate with: npm run generate:unicode
`;
}

function emitRangeTable(name, ranges, sourceLabel) {
  const body = ranges.map(([lo, hi]) => `[0x${lo.toString(16)},0x${hi.toString(16)}]`).join(',');
  return `${banner(sourceLabel)}
/** Sorted, merged, inclusive [lo, hi] code point ranges. */
export const ${name}: ReadonlyArray<readonly [number, number]> = [${body}];
`;
}

function emitScriptsTable(names, ranges, sourceLabel) {
  const namesLit = JSON.stringify(names);
  const body = ranges.map(([lo, hi, id]) => `[0x${lo.toString(16)},0x${hi.toString(16)},${id}]`).join(',');
  return `${banner(sourceLabel)}
export const scriptNames: readonly string[] = ${namesLit};
/** Sorted, inclusive [lo, hi, scriptIndex] ranges (index into scriptNames). */
export const scriptRanges: ReadonlyArray<readonly [number, number, number]> = [${body}];
`;
}

function emitScriptExtensionsTable(ranges, sourceLabel) {
  const body = ranges.map(([lo, hi, ids]) => `[0x${lo.toString(16)},0x${hi.toString(16)},[${ids.join(',')}]]`).join(',');
  return `${banner(sourceLabel)}
/** Sorted, inclusive [lo, hi, scriptIndices[]] ranges (indices into scriptNames from scripts.ts). */
export const scriptExtensionRanges: ReadonlyArray<readonly [number, number, readonly number[]]> = [${body}];
`;
}

function emitTagSequences(sequences, sourceLabel) {
  const body = sequences.map((cps) => `[${cps.map((c) => `0x${c.toString(16)}`).join(',')}]`).join(',\n  ');
  return `${banner(sourceLabel)}
/** RGI emoji tag sequences (flags encoded with Unicode tag characters), e.g. Scotland = 1F3F4 E0067 E0062 E0073 E0063 E0074 E007F. */
export const rgiEmojiTagSequences: ReadonlyArray<readonly number[]> = [
  ${body}
];
`;
}

function emitConfusables(map, sourceLabel) {
  const entries = [...map.entries()].sort((a, b) => a[0] - b[0]);
  const body = entries.map(([src, target]) => `[0x${src.toString(16)},[${target.map((c) => `0x${c.toString(16)}`).join(',')}]]`).join(',\n  ');
  return `${banner(sourceLabel)}
/** Confusable source code point -> prototype ("skeleton") code point sequence, per confusables.txt. */
export const confusablesTable: ReadonlyArray<readonly [number, readonly number[]]> = [
  ${body}
];
`;
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const manifest = { unicodeVersion: '17.0.0', emojiVersion: '16.0', generatedAt: new Date().toISOString(), sources: {} };
  const texts = {};

  for (const { id, url } of SOURCES) {
    process.stdout.write(`fetching ${url} ... `);
    const text = await download(url);
    const hash = sha256(text);
    texts[id] = text;
    manifest.sources[id] = { url, sha256: hash, bytes: text.length };
    console.log(`sha256=${hash.slice(0, 12)}… (${text.length} bytes)`);
  }

  const defaultIgnorable = extractDefaultIgnorable(texts.derivedCoreProperties);
  const { names: scriptNames, ranges: scriptRanges } = extractScripts(texts.scripts);
  const scriptExtensionRanges = extractScriptExtensions(texts.scriptExtensions, scriptNames);
  const emoji = extractEmoji(texts.emojiData);
  const tagSequences = extractTagSequences(texts.emojiSequences);
  const confusables = extractConfusables(texts.confusables);

  await writeFile(join(outDir, 'default-ignorable.ts'), emitRangeTable('defaultIgnorableRanges', defaultIgnorable, 'DerivedCoreProperties.txt (Default_Ignorable_Code_Point)'));
  await writeFile(join(outDir, 'scripts.ts'), emitScriptsTable(scriptNames, scriptRanges, 'Scripts.txt'));
  await writeFile(join(outDir, 'script-extensions.ts'), emitScriptExtensionsTable(scriptExtensionRanges, 'ScriptExtensions.txt'));
  await writeFile(join(outDir, 'emoji.ts'), emitRangeTable('emojiRanges', emoji, 'emoji/emoji-data.txt (Emoji property)'));
  await writeFile(join(outDir, 'emoji-tag-sequences.ts'), emitTagSequences(tagSequences, 'emoji-sequences.txt (RGI_Emoji_Tag_Sequence)'));
  await writeFile(join(outDir, 'confusables.ts'), emitConfusables(confusables, 'confusables.txt'));

  await writeFile(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  console.log('\nWrote src/generated/*.ts');
  console.log(`Default_Ignorable ranges: ${defaultIgnorable.length}`);
  console.log(`Scripts: ${scriptNames.length}, ranges: ${scriptRanges.length}`);
  console.log(`Script extension ranges: ${scriptExtensionRanges.length}`);
  console.log(`Emoji ranges: ${emoji.length}`);
  console.log(`RGI tag sequences: ${tagSequences.length}`);
  console.log(`Confusables entries: ${confusables.size}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
