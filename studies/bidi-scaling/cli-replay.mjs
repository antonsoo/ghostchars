// node studies/bidi-scaling/cli-replay.mjs BASELINE_CLI CURRENT_CLI OUTPUT
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const [baseline, current, output] = process.argv.slice(2);
if (!output) throw new Error('Supply BASELINE_CLI CURRENT_CLI OUTPUT');
const directory = mkdtempSync(join(tmpdir(), 'ghostchars-bidi-'));
const source = 'keep ' + '\u202e'.repeat(32_000) + '\u2069'.repeat(32_000) + 'this';
const sha = value => createHash('sha256').update(value).digest('hex');
const results = [];
try {
  for (const [name, file] of [['before', baseline], ['after', current]]) {
    const steps = [];
    for (const repair of [false, true]) {
      writeFileSync(join(directory, 'case.txt'), source);
      const args = ['case.txt', '--no-config', '--format', 'summary', ...(repair ? ['--fix'] : [])];
      const start = performance.now();
      const run = spawnSync(process.execPath, [resolve(file), ...args], { cwd: directory, encoding: 'utf8', timeout: 60_000, maxBuffer: 2_000_000 });
      const ms = performance.now() - start;
      assert.equal(run.error, undefined);
      assert.equal(run.stderr, '');
      assert.equal(run.status, 1); // Findings in the input still fail the scan gate after a repair.
      assert.match(run.stdout, /128000 error\(s\)/);
      assert.equal(readFileSync(join(directory, 'case.txt'), 'utf8'), repair ? 'keep this' : source);
      steps.push({ command: `ghostchars ${args.join(' ')}`, exitCode: run.status, ms,
        output: run.stdout, outputSha256: sha(run.stdout), resultingFileSha256: sha(readFileSync(join(directory, 'case.txt'))) });
    }
    results.push({ version: name, cliSha256: sha(readFileSync(resolve(file))), steps });
  }
  for (let index = 0; index < 2; index++) {
    assert.equal(results[0].steps[index].output, results[1].steps[index].output);
    assert.equal(results[0].steps[index].resultingFileSha256, results[1].steps[index].resultingFileSha256);
  }
  writeFileSync(output, JSON.stringify({ node: process.version, sourceCodeUnits: source.length,
    sourceBytes: Buffer.byteLength(source), sourceSha256: sha(source), identical: true,
    environment: '14 vCPU WSL2 Linux, 48 GB RAM; host not isolated',
    scope: 'One actual CLI process per scan/repair/version; timings include process startup and formatting. Controlled dense input, not production traffic.', results }, null, 2) + '\n');
  console.log(JSON.stringify(results.map(row => ({ version: row.version, ms: row.steps.map(step => step.ms) }))));
} finally { rmSync(directory, { recursive: true, force: true }); }
