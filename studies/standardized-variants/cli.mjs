// Actual CLI scans, previews and in-place repair of synthetic Unicode examples.
// node cli.mjs BASELINE_CLI CURRENT_CLI OUTPUT
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const [baseline, current, output] = process.argv.slice(2);
assert.ok(output, 'Supply BASELINE_CLI CURRENT_CLI OUTPUT');
const sha = value => createHash('sha256').update(value).digest('hex');
const codepoints = text => Array.from(text, ch => `U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`);
const encode = text => Array.from(Buffer.from(text), b => String.fromCodePoint(b < 16 ? 0xfe00 + b : 0xe0100 + b - 16)).join('');
const registered = '0\uFE00\n\u2205\uFE00\n\u3001\uFE01\n\u1000\uFE00\n';
const cases = [
  { name: 'registered', text: registered, before: '0\n\u2205\n\u3001\n\u1000\n', after: registered, beforeFindings: 4, afterFindings: 0 },
  { name: 'extra-selector', text: '\u2205\uFE00\uFE00', before: '\u2205', after: '\u2205\uFE00', beforeFindings: 1, afterFindings: 1 },
  { name: 'unregistered-pair', text: '\u2205\uFE07', before: '\u2205', after: '\u2205', beforeFindings: 1, afterFindings: 1 },
  { name: 'payload-with-registered-prefix', text: '\u2205' + encode('\0hidden message'), before: '\u2205', after: '\u2205', beforeFindings: 1, afterFindings: 1 },
  { name: 'registered-beside-payload', text: registered + '\u2205' + encode('hidden message'), before: '0\n\u2205\n\u3001\n\u1000\n\u2205', after: registered + '\u2205', beforeFindings: 5, afterFindings: 1 },
];
const directory = mkdtempSync(join(tmpdir(), 'ghostchars-registered-'));
const records = [];
try {
  for (const [version, cli] of [['before', baseline], ['after', current]]) {
    for (const sample of cases) {
      const steps = [];
      for (const mode of ['scan', 'preview', 'repair']) {
        const file = sample.name + '.txt';
        writeFileSync(join(directory, file), sample.text);
        const args = [file, '--no-config', '--format', 'json',
          ...(mode === 'scan' ? [] : mode === 'preview' ? ['--fix', '--dry-run'] : ['--fix'])];
        const run = spawnSync(process.execPath, [resolve(cli), ...args], { cwd: directory, encoding: 'utf8', timeout: 60_000, maxBuffer: 2_000_000 });
        assert.equal(run.error, undefined);
        assert.equal(run.stderr, '');
        const count = sample[version + 'Findings'];
        // Default gating is error-only; stray-selector warnings already exit 0.
        assert.equal(run.status, sample.name.includes('payload') ? 1 : 0, `${version}/${sample.name}/${mode}`);
        const bytes = readFileSync(join(directory, file));
        assert.equal(bytes.toString('utf8'), mode === 'repair' ? sample[version] : sample.text);
        const report = mode === 'preview' ? null : JSON.parse(run.stdout);
        if (report) {
          assert.equal(report.summary.total, count);
          assert.equal(report.summary.complete, true);
          assert.equal(report.errors.length, 0);
        }
        steps.push({ mode, args, exitCode: run.status, stdout: run.stdout, stdoutSha256: sha(run.stdout),
          resultingFileSha256: sha(bytes), resultingCodePoints: codepoints(bytes.toString('utf8')) });
      }
      records.push({ version, name: sample.name, inputSha256: sha(sample.text), inputBytes: Buffer.byteLength(sample.text), inputCodePoints: codepoints(sample.text), steps });
    }
  }
} finally { rmSync(directory, { recursive: true, force: true }); }
writeFileSync(output, JSON.stringify({ node: process.version,
  cliSha256: { before: sha(readFileSync(resolve(baseline))), after: sha(readFileSync(resolve(current))) },
  scope: 'Actual CLI scan, preview and file repair. Synthetic registered/unsupported/payload cases. JSON stdout retains measured durationMs; file bytes and exit codes are asserted.',
  records }, null, 2) + '\n');
console.log(`${records.length * 3} actual CLI scan/preview/repair invocations passed.`);
