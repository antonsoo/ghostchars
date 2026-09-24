#!/usr/bin/env node
// Measures scanText() throughput on a large synthetic input, and a full CLI
// run (I/O + file discovery + scanning) over this repo's own node_modules,
// which is a realistic "big, messy, mostly-JS tree" workload. Both numbers
// are printed for `npm run bench` / the README to quote verbatim -- nothing
// here is a curated best-case run.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanText } from '../dist/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function buildSyntheticCorpus(targetBytes) {
  // Deterministic, code-shaped synthetic text (explicitly synthetic, not
  // sampled from any real project) with an occasional Trojan-Source-style
  // finding mixed in, so the benchmark also exercises every rule rather than
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

// --- 1. Raw scanText() throughput on a large synthetic string -------------
const targetMB = Number(process.argv[2] ?? 50);
const corpus = buildSyntheticCorpus(targetMB * 1024 * 1024);
const bytes = Buffer.byteLength(corpus, 'utf8');
console.log(`[1] scanText() on ${(bytes / 1024 / 1024).toFixed(1)} MiB of synthetic, code-shaped text (labelled synthetic; not sampled from a real project):`);

const t0 = performance.now();
const { findings, codePointCount } = scanText(corpus);
const t1 = performance.now();
console.log(`    ${fmtMs(t1 - t0)} (${fmtMBps(bytes, t1 - t0)} MiB/s, ${codePointCount.toLocaleString()} code points, ${findings.length.toLocaleString()} findings)`);
console.log('');

// --- 2. Real-world multi-file throughput: this repo's own node_modules/ --
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
  let totalFindings = 0;
  let scannedFiles = 0;
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
    totalFindings += scanText(text).findings.length;
    scannedFiles++;
  }
  const t3 = performance.now();
  console.log(`[2] scanText() over ${scannedFiles.toLocaleString()} real files in this repo's node_modules/ (${(totalBytes / 1024 / 1024).toFixed(1)} MiB total):`);
  console.log(`    ${fmtMs(t3 - t2)} (${fmtMBps(totalBytes, t3 - t2)} MiB/s, ${totalFindings.toLocaleString()} findings)`);
} else {
  console.log('[2] Skipped: node_modules/ not present (run `npm install` first).');
}
