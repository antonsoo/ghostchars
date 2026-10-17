// Compare built lookup functions with independently parsed, pinned Unicode 17 text.
// node oracle.mjs PACKAGE_ROOT UCD_DIRECTORY OUTPUT [--verify]
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL, URL } from 'node:url';

const [root, directory, output] = process.argv.slice(2);
if (!output) throw new Error('Supply PACKAGE_ROOT UCD_DIRECTORY OUTPUT');
const lookup = await import(pathToFileURL(resolve(root, 'dist/core/unicode-utils.js')));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const inputs = {};
function records(name, expectedSha) {
  const bytes = readFileSync(join(directory, name));
  assert.equal(sha(bytes), expectedSha, name);
  inputs[name] = { bytes: bytes.length, sha256: sha(bytes), url: 'https://www.unicode.org/Public/17.0.0/ucd/' + name };
  return bytes.toString('utf8').split('\n').map(raw => raw.split('#')[0].trim()).filter(Boolean).map(line => line.split(';').map(field => field.trim()));
}
const manifest = JSON.parse(readFileSync(new URL('../../src/generated/manifest.json', import.meta.url)));
const aliases = new Map();
for (const [property, short, canonical, ...others] of records('PropertyValueAliases.txt', manifest.sources.propertyValueAliases.sha256)) {
  if (property === 'sc') for (const name of [short, canonical, ...others]) aliases.set(name, canonical);
}
const primary = new Array(0x110000).fill('Unknown');
const extensions = new Map();
function bounds(value) {
  const [lo, hi] = value.split('..').map(h => Number.parseInt(h, 16));
  return [lo, hi ?? lo];
}
for (const [range, script] of records('Scripts.txt', manifest.sources.scripts.sha256)) {
  const [lo, hi] = bounds(range);
  for (let cp = lo; cp <= hi; cp++) primary[cp] = script;
}
let explicitRanges = 0;
for (const [range, values] of records('ScriptExtensions.txt', manifest.sources.scriptExtensions.sha256)) {
  const expected = values.split(/\s+/).map(alias => {
    assert.ok(aliases.has(alias), alias);
    return aliases.get(alias);
  }).sort();
  const [lo, hi] = bounds(range);
  for (let cp = lo; cp <= hi; cp++) {
    assert.ok(!extensions.has(cp));
    extensions.set(cp, expected);
  }
  explicitRanges++;
}
let explicitMismatches = 0, defaultMismatches = 0, primaryMismatches = 0;
const examples = [];
for (let cp = 0; cp < primary.length; cp++) {
  const expected = extensions.get(cp) ?? [primary[cp]];
  const actual = lookup.scriptsOf(cp).sort();
  const matches = JSON.stringify(expected) === JSON.stringify(actual);
  if (!matches) {
    if (extensions.has(cp)) explicitMismatches++;
    else defaultMismatches++;
    if (examples.length < 12) examples.push({ cp, expected, actual });
  }
  if (lookup.scriptOf && lookup.scriptOf(cp) !== primary[cp]) primaryMismatches++;
}
// The host implements this property independently, but can carry older data.
// Record version differences instead of treating them as failed pinned lookups.
const native = [
  [0x2bc, 'Cyrillic', true], [0x2bc, 'Latin', true], [0x2bc, 'Greek', false],
  [0x308, 'Latin', true], [0x308, 'Syriac', true],
  [0x342, 'Greek', true], [0x342, 'Cyrillic', false],
  [0x30fc, 'Hiragana', true], [0x30fc, 'Katakana', true], [0x30fc, 'Latin', false],
].map(([cp, script, expected]) => {
  const actual = new RegExp(`\\p{Script_Extensions=${script}}`, 'u').test(String.fromCodePoint(cp));
  assert.equal((extensions.get(cp) ?? [primary[cp]]).includes(script), expected);
  return { cp, script, pinnedExpected: expected, nativeActual: actual, matchesPinnedVersion: actual === expected };
});
const result = { scope: 'Pinned property-set equivalence across every Unicode code point, including surrogate/unassigned defaults; not full UAX #24 run segmentation or UTS #39 conformance.',
  node: process.version, icu: process.versions.icu, unicode: process.versions.unicode,
  inputs, codePoints: primary.length, explicitRanges, explicitCodePoints: extensions.size,
  explicitMismatches, defaultMismatches, primaryAvailable: Boolean(lookup.scriptOf), primaryMismatches, examples, native,
  nativeVersionDifferences: native.filter(row => !row.matchesPinnedVersion).length,
  lookupSha256: sha(readFileSync(resolve(root, 'dist/core/unicode-utils.js'))),
  tableSha256: sha(readFileSync(resolve(root, 'dist/generated/script-extensions.js'))),
};
writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ codePoints: primary.length, explicitRanges, explicitCodePoints: extensions.size, explicitMismatches, defaultMismatches, primaryMismatches }));
if (process.argv.includes('--verify')) {
  assert.ok(lookup.scriptOf);
  assert.equal(explicitMismatches + defaultMismatches + primaryMismatches, 0);
}
