#!/usr/bin/env node
// Measures scanText() throughput on: (1) a large purely-ASCII synthetic
// input, to isolate the whole-file ASCII fast path's throughput; (2) a large
// synthetic input with scattered non-ASCII/bidi/confusable content mixed in,
// so the slow path is also exercised; and (3) a full multi-file run over
// this repo's own node_modules, a realistic "big, messy, mostly-JS tree"
// workload, broken down by rule. All numbers are printed for `npm run bench`
// / the README to quote verbatim -- nothing here is a curated best case.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanText } from '../dist/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function buildAsciiCorpus(targetBytes) {
  const lines = [];
  let bytes = 0;
  let i = 0;
  while (bytes < targetBytes) {
    const line = `function handler_${i}(request, response) { return response.json({ id: ${i}, ok: request.id === ${i} }); }`;
    lines.push(line);
    bytes += line.length + 1;
    i++;
  }
  return lines.join('\n');
}

function buildMixedCorpus(targetBytes) {
  // Deterministic, code-shaped synthetic text (explicitly synthetic, not
  // sampled from any real project) with an occasional Trojan-Source-style
  // finding mixed in, so this corpus also exercises every rule rather than
  // taking the all-clean fast path.
  const lines = [];
  let bytes = 0;
  let i = 0;
  while (bytes < targetBytes) {
    let line;
    if (i % 997 === 0) {
      // eslint-disable-next-line no-irregular-whitespace -- intentional: this is the benchmark's bidi/invisible-character test data.
      line = `const secret​key_${i} = computeToken(${i}); // ⁦note⁩`;
    } else if (i % 613 === 0) {
      line = `const pаyload_${i} = fetchRemote(${i});`; // Cyrillic а confusable
    } else {
      line = `function handler_${i}(request, response) { return response.json({ id: ${i}, ok: request.id === ${i} }); }`;
    }
    lines.push(line);
    bytes += line.length + 1;
    i++;
  }
  return lines.join('\n');
}

function fmtMs(ms) {
  return ms < 1000 ? `${ms.toFixed(1)}ms` : `${(ms / 1000).toFixed(2)}s`;
}

function fmtMBps(bytes, ms) {
  return (bytes / 1024 / 1024 / (ms / 1000)).toFixed(1);
}

console.log(`Machine: ${process.arch}, ${process.platform}, Node ${process.version}, ${(await import('node:os')).cpus().length} logical CPUs`);
console.log('');

const targetMB = Number(process.argv[2] ?? 50);

// --- 1. Pure-ASCII fast path: the whole-file HAS_NON_ASCII_OR_CONTROL_RE
// check finds nothing, so scanText() returns immediately -- no code point
// iteration, no tokenizing. This isolates that fast path's throughput.
{
  const corpus = buildAsciiCorpus(targetMB * 1024 * 1024);
  const bytes = Buffer.byteLength(corpus, 'utf8');
  console.log(`[1] scanText() on ${(bytes / 1024 / 1024).toFixed(1)} MiB of pure-ASCII, code-shaped synthetic text:`);
  const t0 = performance.now();
  const { findings, codePointCount } = scanText(corpus);
  const t1 = performance.now();
  console.log(`    ${fmtMs(t1 - t0)} (${fmtMBps(bytes, t1 - t0)} MiB/s, ${codePointCount.toLocaleString()} code points, ${findings.length.toLocaleString()} findings)`);
  console.log('');
}

// --- 2. Mixed content: the same corpus, with non-ASCII/bidi/confusable
// content scattered through it, so every rule (including the slower
// per-token confusables path) actually runs.
{
  const corpus = buildMixedCorpus(targetMB * 1024 * 1024);
  const bytes = Buffer.byteLength(corpus, 'utf8');
  console.log(`[2] scanText() on ${(bytes / 1024 / 1024).toFixed(1)} MiB of synthetic text with scattered non-ASCII content (labelled synthetic; not sampled from a real project):`);
  const t0 = performance.now();
  const { findings, codePointCount } = scanText(corpus);
  const t1 = performance.now();
  console.log(`    ${fmtMs(t1 - t0)} (${fmtMBps(bytes, t1 - t0)} MiB/s, ${codePointCount.toLocaleString()} code points, ${findings.length.toLocaleString()} findings)`);
  console.log('');
}

// --- 3. Real-world multi-file throughput: this repo's own node_modules/ --
// (walked directly here, bypassing the CLI's .gitignore-aware discovery --
// node_modules is gitignored by design, but it's still a convenient stand-in
// for "a big, messy, real tree of mostly-JS files" for a raw throughput
// number.)
const nodeModules = join(root, 'node_modules');
if (existsSync(nodeModules)) {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.bin') continue;
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile()) files.push(abs);
    }
  };
  walk(nodeModules);

  let totalBytes = 0;
  let scannedFiles = 0;
  const byRule = new Map();
  const t2 = performance.now();
  for (const file of files) {
    const stat = statSync(file);
    if (stat.size > 5 * 1024 * 1024) continue; // same MAX_FILE_BYTES the CLI applies
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue; // binary/unreadable, same as the CLI would skip
    }
    if (text.includes('\0')) continue;
    totalBytes += Buffer.byteLength(text, 'utf8');
    for (const f of scanText(text).findings) byRule.set(f.rule, (byRule.get(f.rule) ?? 0) + 1);
    scannedFiles++;
  }
  const t3 = performance.now();
  const totalFindings = [...byRule.values()].reduce((a, b) => a + b, 0);
  console.log(`[3] scanText() over ${scannedFiles.toLocaleString()} real files in this repo's node_modules/ (${(totalBytes / 1024 / 1024).toFixed(1)} MiB total):`);
  console.log(`    ${fmtMs(t3 - t2)} (${fmtMBps(totalBytes, t3 - t2)} MiB/s, ${totalFindings.toLocaleString()} findings)`);
  for (const [rule, count] of [...byRule.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`      ${String(count).padStart(6)}  ${rule}`);
  }
} else {
  console.log('[3] Skipped: node_modules/ not present (run `npm install` first).');
}
