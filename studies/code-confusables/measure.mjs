// node studies/code-confusables/measure.mjs BASELINE_ROOT CURRENT_ROOT OUTPUT
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const [beforeRoot, afterRoot, output] = process.argv.slice(2);
if (!output) throw new Error('Supply BASELINE_ROOT CURRENT_ROOT OUTPUT');
const before = await import(pathToFileURL(resolve(beforeRoot, 'dist/index.js')));
const after = await import(pathToFileURL(resolve(afterRoot, 'dist/index.js')));
const directory = dirname(fileURLToPath(import.meta.url));
const oracle = JSON.parse(readFileSync(join(directory, 'results/oracle.json')));
const unit = oracle.cases.map(row => '{\n' + readFileSync(join(directory, row.file), 'utf8') + '}\n').join('');
const results = [];
for (const copies of [1, 10, 100]) {
  const source = unit.repeat(copies);
  const checked = spawnSync(process.execPath, ['--check', '--input-type=module'], { input: source, encoding: 'utf8' });
  assert.equal(checked.status, 0, checked.stderr);
  const modes = {};
  for (const [name, library, options, count] of [
    ['baselineText', before, {}, 0], ['currentText', after, {}, 0],
    ['currentCode', after, { isCode: true }, copies * 64],
  ]) {
    for (let i = 0; i < 4; i++) assert.equal(library.scanText(source, options).findings.length, count);
    const samplesMs = [];
    for (let i = 0; i < 7; i++) {
      const start = performance.now(); const scan = library.scanText(source, options);
      samplesMs.push(performance.now() - start); assert.equal(scan.findings.length, count);
    }
    const sorted = [...samplesMs].sort((a, b) => a - b);
    modes[name] = { findings: count, samplesMs, medianMs: sorted[3] };
  }
  results.push({ copies, bytes: Buffer.byteLength(source), utf16Units: source.length,
    sha256: createHash('sha256').update(source).digest('hex'), nativeSyntaxCheck: true, modes });
}
writeFileSync(output, JSON.stringify({ node: process.version,
  scope: 'Local controlled scan measurement on valid block-scoped repetitions of the 16 native fixtures. Seven samples after four warmups, modes run in fixed order. Includes finding construction, excludes I/O and formatting. No general throughput or speedup claim.', results }, null, 2) + '\n');
console.log(results.map(r => `${r.bytes} bytes: text ${r.modes.currentText.medianMs.toFixed(2)}ms; code ${r.modes.currentCode.medianMs.toFixed(2)}ms (${r.modes.currentCode.findings} findings)`).join('\n'));
