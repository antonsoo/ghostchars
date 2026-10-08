// Scan every cached document with one build of ghostchars and write one JSON line per file
// that has at least one finding, plus a summary line per source.
//
//   node scan.mjs <dist-dir> <cache-dir> <manifest.json> <out.jsonl>
//
// <dist-dir> is a tsc build of the library (src/index.ts); the same script measures the
// released tag and this checkout. Files are read as the CLI reads them: UTF-8, BOM kept.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [dist, cache, manifestPath, outPath] = process.argv.slice(2);
const { scanText } = await import(pathToFileURL(join(dist, 'index.js')).href);
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

const esc = (s) =>
  [...s]
    .map((ch) => {
      const cp = ch.codePointAt(0);
      if (cp === 10) return '\\n';
      if (cp === 9) return '\\t';
      if (cp !== 0x20 && (cp < 0x20 || cp === 0x7f || (cp >= 0x80 && cp < 0xa0) || /[\p{Cf}\p{Cs}\p{Zs}\p{Zl}\p{Zp}\p{Co}]/u.test(ch) || (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0xe0100 && cp <= 0xe01ef))) {
        return `<U+${cp.toString(16).toUpperCase().padStart(4, '0')}>`;
      }
      return ch;
    })
    .join('');

const lines = [];
const summary = {};
for (const src of manifest.sources) {
  const s = (summary[src.id] = { stratum: src.stratum, docs: 0, docsWithFindings: 0, findings: 0, bytes: 0 });
  for (const rel of Object.keys(src.files).sort()) {
    const buf = readFileSync(join(cache, src.id, rel));
    const text = buf.toString('utf8');
    s.docs++;
    s.bytes += buf.length;
    const { findings } = scanText(text);
    if (findings.length === 0) continue;
    s.docsWithFindings++;
    s.findings += findings.length;
    lines.push(
      JSON.stringify({
        src: src.id,
        file: rel,
        stratum: src.stratum,
        n: findings.length,
        findings: findings.map((f) => ({
          rule: f.rule,
          sev: f.severity,
          off: f.start.offset,
          end: f.end.offset,
          line: f.start.line,
          cps: f.codePoints,
          msg: f.message,
          decoded: f.decoded,
          skel: f.skeleton,
          ctx: esc(text.slice(Math.max(0, f.start.offset - 40), f.start.offset)) + '[[' + esc(text.slice(f.start.offset, Math.max(f.end.offset, f.start.offset + 1))) + ']]' + esc(text.slice(f.end.offset, f.end.offset + 40)),
        })),
      }),
    );
  }
}
lines.push(JSON.stringify({ summary }));
writeFileSync(outPath, lines.join('\n') + '\n');
console.log(JSON.stringify(summary, null, 1));
