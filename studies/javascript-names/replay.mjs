// node replay.mjs BASELINE_ROOT CURRENT_ROOT OUTPUT
// Uses built public APIs and the actual CLI; the native/ICU oracle is separate.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const [beforeRoot, afterRoot, output] = process.argv.slice(2);
if (!output) throw Error('Supply BASELINE_ROOT CURRENT_ROOT OUTPUT');
const before = await import(pathToFileURL(resolve(beforeRoot, 'dist/index.js')));
const after = await import(pathToFileURL(resolve(afterRoot, 'dist/index.js')));
const parsed = await import(pathToFileURL(resolve(afterRoot, 'dist/javascript.js')));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const oracleBytes = readFileSync(resolve(here, 'results/oracle.json'));
const oracle = JSON.parse(oracleBytes);
const cases = [];
for (const item of oracle.cases) {
  const file = resolve(here, item.file), bytes = readFileSync(file), source = bytes.toString('utf8');
  assert.equal(sha(bytes), item.sha256);
  const previous = before.scanText(source, { isCode: true });
  assert.deepEqual(after.scanText(source, { isCode: true }), previous);
  assert.deepEqual(after.scanText(source), before.scanText(source));
  assert.equal(previous.findings.filter(f => f.rule === 'confusable').length, 0);
  const result = parsed.scanJavaScript(source);
  const findings = result.findings.filter(f => f.rule === 'confusable');
  assert.equal(findings.length, 4);
  assert.deepEqual(findings.map(f => source.slice(f.start.offset, f.end.offset)),
    [item.left, item.right_source, item.left, item.right_source]);
  assert.deepEqual(findings.map(f => f.skeleton), Array(4).fill(item.skeleton));
  assert.deepEqual(findings.filter(f => f.decoded).map(f => f.decoded), [item.right, item.right]);
  assert.ok(findings.every(f => f.severity === 'error' && f.fixable === false));
  const run = spawnSync(process.execPath,
    [resolve(afterRoot, 'dist/cli.js'), file, '--no-config', '--javascript', 'module', '--format', 'json'],
    { encoding: 'utf8' });
  assert.equal(run.status, 1, run.stderr);
  const cli = JSON.parse(run.stdout);
  assert.equal(cli.summary.complete, true);
  assert.equal(cli.results.length, 1);
  const expected = result.findings.map(({ codePoints, ...rest }) => ({
    ...rest, codePoints: codePoints.map(cp => `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`),
  }));
  assert.deepEqual(cli.results[0].findings, expected);
  cases.push({ file: item.file, input_sha256: item.sha256, ordinary_code: previous,
    parsed: result, cli_complete: cli.summary.complete, cli_exit: run.status });
}
const result = { node: process.version, script_sha256: sha(readFileSync(fileURLToPath(import.meta.url))),
  oracle_sha256: sha(oracleBytes), cases, old_modes_identical: true,
  scope: 'Authored native controls; same inputs developed the feature. No prevalence or held-out accuracy claim.' };
writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ native_pairs: cases.length, parsed_confusable_spans: cases.length * 4,
  previous_confusable_spans: 0, actual_cli_cases: cases.length }));
