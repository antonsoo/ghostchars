// node studies/bidi-scaling/compare.mjs BASELINE_ROOT CURRENT_ROOT OUTPUT
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';

const [beforeRoot, afterRoot, output] = process.argv.slice(2);
if (!output) throw new Error('Supply BASELINE_ROOT CURRENT_ROOT OUTPUT');
const load = (root, file) => import(pathToFileURL(resolve(root, 'dist', file)));
const before = await load(beforeRoot, 'index.js');
const after = await load(afterRoot, 'index.js');
const beforeBidi = await load(beforeRoot, 'core/rules/bidi.js');
const afterBidi = await load(afterRoot, 'core/rules/bidi.js');
const { positionIndex } = await load(afterRoot, 'core/rules/position.js');
const sha = value => createHash('sha256').update(value).digest('hex');
const alphabet = ['\u202a', '\u202e', '\u2066', '\u2068', '\u202c', '\u2069', '\n', '\r', 'a'];
let sequences = 0;
function compareSequence(text, depth) {
  assert.deepEqual(afterBidi.scanBidi(text, positionIndex(text)), beforeBidi.scanBidi(text, positionIndex(text)));
  sequences++;
  if (depth < 5) for (const character of alphabet) compareSequence(text + character, depth + 1);
}
compareSequence('', 0);
const files = [];
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (entry.isFile()) files.push(path);
  }
}
// The published package intentionally excludes examples. Keep the input corpus
// with this study while loading both implementations from the supplied roots.
const corpusRoot = fileURLToPath(new URL('../../', import.meta.url));
await walk(resolve(corpusRoot, 'examples'));
const corpus = [];
for (const path of files.sort()) {
  const text = await readFile(path, 'utf8');
  const old = before.scanText(text), current = after.scanText(text);
  assert.deepEqual(current, old);
  const oldRepair = before.sanitize(text), currentRepair = after.sanitize(text);
  assert.deepEqual(currentRepair, oldRepair);
  assert.equal(after.reveal(text), before.reveal(text));
  corpus.push({ file: relative(corpusRoot, path), bytes: Buffer.byteLength(text), inputSha256: sha(text),
    findings: current.findings.length, findingsSha256: sha(JSON.stringify(current)),
    sanitizedSha256: sha(currentRepair.text), identicalScanRepairReveal: true });
}
const result = { node: process.version, baselineBidiSha256: sha(await readFile(resolve(beforeRoot, 'dist/core/rules/bidi.js'))),
  currentBidiSha256: sha(await readFile(resolve(afterRoot, 'dist/core/rules/bidi.js'))),
  exhaustive: { alphabet: alphabet.map(character => character.codePointAt(0)), maxLength: 5, sequences, identical: sequences,
    scope: 'Preserves the existing line-scoped checker. Not a complete Unicode bidirectional algorithm conformance test.' }, corpus };
await writeFile(output, JSON.stringify(result, null, 2) + '\n');
console.log(`${sequences} sequences and ${corpus.length} example files retain identical findings; example repairs and reveals also match.`);
