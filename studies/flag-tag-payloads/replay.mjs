// Use a built checkout or an independently installed package's actual library and CLI.
import { readFile, writeFile, mkdir, mkdtemp, rm, copyFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL, URL } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const [modulePath, cliPath, output, check] = process.argv.slice(2);
assert(modulePath && cliPath && output, 'Use replay.mjs LIBRARY CLI OUTPUT [--check]');
const { scanText, sanitize } = await import(pathToFileURL(resolve(modulePath)).href);
const cases = JSON.parse(await readFile(new URL('cases.json', import.meta.url), 'utf8'));
const observations = [];
const directory = await mkdtemp(join(tmpdir(), 'ghostchars-tags-'));
try {
  for (const item of cases) {
    const bytes = await readFile(new URL(`fixtures/${item.id}.txt`, import.meta.url));
    assert.equal(bytes.toString('utf8'), item.text);
    const scanned = scanText(item.text), cleaned = sanitize(item.text);
    const path = join(directory, `${item.id}.txt`);
    await copyFile(new URL(`fixtures/${item.id}.txt`, import.meta.url), path);
    const scan = spawnSync(process.execPath, [resolve(cliPath), path, '--no-config', '--format', 'json'], { encoding: 'utf8' });
    const fixed = spawnSync(process.execPath, [resolve(cliPath), path, '--no-config', '--fix', '--format', 'json'], { encoding: 'utf8' });
    const fixedText = await readFile(path, 'utf8');
    observations.push({ id: item.id, sha256: createHash('sha256').update(bytes).digest('hex'),
      expected_findings: item.findings, findings: scanned.findings,
      expected_sanitized: item.expected, sanitized: cleaned.text,
      remaining: cleaned.remaining, scan_exit: scan.status, fix_exit: fixed.status,
      cli_fixed: fixedText, cli_error: fixed.stderr.replaceAll(directory, '<work>'),
      matches: scanned.findings.length === item.findings && cleaned.text === item.expected && fixedText === item.expected,
    });
  }
} finally { await rm(directory, { recursive: true, force: true }); }
const result = { synthetic: true, cases: cases.length,
  matches: observations.filter(item => item.matches).length,
  missed_payload_cases: observations.filter(item => item.expected_findings > 0 && item.findings.length === 0).length,
  observations };
await mkdir(dirname(resolve(output)), { recursive: true });
await writeFile(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ cases: result.cases, matches: result.matches, missed_payload_cases: result.missed_payload_cases }));
if (check === '--check') assert.equal(result.matches, result.cases);
