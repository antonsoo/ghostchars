// Print unedited CLI preview and actual native-process results for a synthetic check.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { cli: { type: 'string' } } });
if (!values.cli) throw new Error('Use --cli PATH to the built or installed CLI');
const cli = resolve(values.cli);
const work = mkdtempSync(join(tmpdir(), 'ghostchars-boundary-demo-'));
function run(args) {
  const r = spawnSync(process.execPath, args, { cwd: work, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
  if (r.error || r.signal) throw r.error ?? new Error(`child terminated: ${r.signal}`);
  return r;
}
try {
  writeFileSync(join(work, 'check.mjs'), '// Check below\u2028process.exitCode = 7;\n');
  const before = run(['check.mjs']);
  console.log(`Synthetic check: original native Node exit ${before.status}.`);
  const preview = run([cli, 'check.mjs', '--fix', '--dry-run', '--no-config']);
  process.stdout.write(preview.stdout);
  const fix = run([cli, 'check.mjs', '--fix', '--format', 'json', '--no-config']);
  const after = run(['check.mjs']);
  console.log(`Repaired native Node exit ${after.status}; comment boundary retained.`);
  if (before.status !== 7 || preview.status !== 0 || fix.status !== 0 || after.status !== 7) throw new Error('Repair did not preserve the check');
} finally { rmSync(work, { recursive: true, force: true }); }
