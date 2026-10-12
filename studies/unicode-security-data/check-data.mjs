// node studies/unicode-security-data/check-data.mjs CACHE_DIRECTORY OUTPUT
// Uses independently parsed, hash-pinned upstream files, not the generator.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { confusablesTable } from '../../dist/generated/confusables.js';

const [cache, output] = process.argv.slice(2);
assert.ok(cache && output, 'Supply CACHE_DIRECTORY OUTPUT');
const specs = [
  ['confusables-16.txt', 'https://www.unicode.org/Public/security/16.0.0/confusables.txt', '95bd0aad6dced5ebc63436f459c06ab21a8d107cd842fb57f5c3a1e91bca8611'],
  ['confusables-17.txt', 'https://www.unicode.org/Public/17.0.0/security/confusables.txt', '091c7f82fc39ef208faf8f94d29c244de99254675e09de163160c810d13ef22a'],
  ['emoji-sequences-16.txt', 'https://www.unicode.org/Public/emoji/16.0/emoji-sequences.txt', '3fe3c77e72e8f26df302dc7d99b106c5d08fd808ef7246fb5d4502d659fe659c'],
  ['emoji-sequences-17.txt', 'https://www.unicode.org/Public/17.0.0/emoji/emoji-sequences.txt', '12cc8267dc33cbd11ed32bcf6fc5dc2ad9c7a77bae1bdfba2f41b1b9b3ead8dd'],
];
const source = {}, texts = {};
for (const [file, url, expected] of specs) {
  const bytes = await readFile(resolve(cache, file));
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  assert.equal(sha256, expected, file);
  source[file] = { url, sha256, bytes: bytes.length }; texts[file] = bytes.toString('utf8');
}
function mappings(text) {
  const map = new Map();
  for (const line of text.split(/\r?\n/)) {
    const data = line.split('#')[0].trim(); if (!data) continue;
    const match = /^([A-F0-9]+)\s*;\s*([A-F0-9 ]+?)\s*;\s*MA\s*;?\s*$/.exec(data);
    assert.ok(match, data);
    const key = Number.parseInt(match[1], 16); assert.ok(!map.has(key));
    map.set(key, match[2].trim().split(/\s+/).map(value => Number.parseInt(value, 16)));
  }
  return map;
}
const old = mappings(texts['confusables-16.txt']), current = mappings(texts['confusables-17.txt']);
assert.equal(confusablesTable.length, current.size);
assert.equal(new Set(confusablesTable.map(([cp]) => cp)).size, current.size);
for (const [cp, target] of confusablesTable) assert.deepEqual(target, current.get(cp), `U+${cp.toString(16)}`);
const hex = points => points?.map(point => point.toString(16).toUpperCase().padStart(4, '0')).join(' ') ?? null;
const delta = [...current].filter(([cp, target]) => hex(old.get(cp)) !== hex(target))
  .sort(([a], [b]) => a - b).map(([cp, target]) => ({ source: hex([cp]), before: hex(old.get(cp)), after: hex(target) }));
const tags = text => text.split('\n').map(line => line.split('#')[0].trim())
  .filter(line => /;\s*RGI_Emoji_Tag_Sequence\s*;/.test(line)).map(line => line.split(';')[0].trim()).sort();
assert.deepEqual(tags(texts['emoji-sequences-16.txt']), tags(texts['emoji-sequences-17.txt']));
const result = { source, beforeMappings: old.size, afterMappings: current.size,
  generatedMappingsChecked: confusablesTable.length, generatedMatchesSource: true,
  added: delta.filter(row => row.before === null).length, changed: delta.filter(row => row.before !== null).length,
  removed: [...old.keys()].filter(cp => !current.has(cp)).length,
  emojiTagSequencesUnchanged: tags(texts['emoji-sequences-17.txt']), delta,
  scope: 'Data integrity against the upstream mapping table; not full UTS #39 conformance or a detection-rate estimate.' };
await writeFile(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ mappingsChecked: current.size, added: result.added, changed: result.changed, removed: result.removed, unchangedTagSequences: result.emojiTagSequencesUnchanged.length }));
