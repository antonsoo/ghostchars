# Preserve registered glyph variants during repair

Baseline `571474b4190d2a0dde2044fc109284e3fa95d7c0` treated single selectors
as ordinary only on emoji and CJK ideographs. It reported other registered
pairs as stray selectors and removed them during `sanitize` / `--fix`.

| Registered sequence | Meaning in the pinned Unicode table | Baseline repair | Corrected repair |
| --- | --- | --- | --- |
| U+0030 U+FE00 | Slashed zero variant | Removes U+FE00 | Preserves both scalars |
| U+2205 U+FE00 | Empty-set glyph variant | Removes U+FE00 | Preserves both scalars |
| U+3001 U+FE01 | Centered ideographic comma | Removes U+FE01 | Preserves both scalars |
| U+1000 U+FE00 | Dotted Myanmar KA | Removes U+FE00 | Preserves both scalars |

These are registered in the normative
[Unicode 17 StandardizedVariants.txt](https://www.unicode.org/Public/17.0.0/ucd/StandardizedVariants.txt),
the version already pinned for the checkout's core Unicode data. The retained
[source bytes](StandardizedVariants-17.0.0.txt) have SHA-256
`f55100b2fb11d3d75a37b8c1ab752192dbd1c4b12328c5ec6b38e3807c0ca597`.
They are Unicode data under the repository's [Unicode license](../../LICENSE-UNICODE).

The decoder now recognizes exact standardized base/selector pairs. It preserves
a recognized first variant when removing extra non-payload selectors, as it
already did for emoji presentation. A run that decodes a payload still receives
the payload diagnostic even if its first byte selects a registered variant.
The generated lookup contains 1,293 VS1-256 pairs; the 60 Mongolian free-selector
rows retain their existing separate treatment. The generator verifies pinned
source hashes before writing and records UTF-8 byte lengths rather than UTF-16
string lengths. The other generated lookup tables stay byte-identical.

## Independent checks

[oracle.mjs](oracle.mjs) parses the retained normative text independently of the
production generator. The [retained comparison](oracle.json) checks all 1,353 listed pairs: every one survives sanitization. Baseline
alters 291; the other 1,062 retain exactly the same complete scan. The check
also varies five non-emoji/non-ideograph bases across all 256 selectors:
1,273 unsupported combinations retain identical complete scans and repairs.
Twelve byte-encoded payloads, including a NUL prefix that starts with a
registered selector, retain their complete diagnostics and repaired bytes.

[cli.mjs](cli.mjs) invokes the actual CLI 30 times: scan, preview and file repair
for five cases in both versions. The [retained CLI record](cli.json) checks actual bytes on disk, including
preserving the input in preview mode. The mixed case preserves the registered
sequences beside a removed payload. The default gate is error-only: stray
selector warnings already exit 0, while payload findings exit 1. This repair
changes inappropriate warnings/removals, not a previously failing warning gate.

## Installed package and public-text replay

Clean archive `91718e6` passes type checking, lint, 235 unit checks in each of
two locales, the bundled-CLI consistency check, source self-scan and benchmark
smoke check. A separately installed package repeats the independent oracle and
30 actual CLI invocations on Node 20.0.0 and 24.21.0. Full oracle results agree
between runtimes; CLI reports agree after excluding only measured duration.
Preview text, exit codes and repaired bytes agree exactly. The
[Node 20 oracle](installed-oracle-node20.json), [Node 24 oracle](installed-oracle-node24.json),
[Node 20 CLI](installed-cli-node20.json) and [Node 24 CLI](installed-cli-node24.json)
retain these results.

The [cached public-text comparison](corpus.json) covers all 83,494 historical
files, 155,361,980 bytes. Every complete scan, sanitizer result (text, fixed and
remaining findings) and revealed-text output matches baseline exactly. Both
versions report 18,582 findings. No input was downloaded or relabeled. These
examples do not establish how often registered variants occur in real input;
the original public corpus is a compatibility check, not a new effectiveness
study.

[Regeneration verification](generator-verification.json) reproduces all seven
lookup tables exactly from checked source bytes. Only the manifest's generation
timestamp changes. A deliberately incorrect expected hash makes generation
exit 1 before changing any table.

## Browser evidence

A fresh archive of `ab8f7f3` passes all 36 Chromium/Firefox browser checks.
[browser.mjs](browser.mjs) also runs four separate contexts per version:
Chromium/Firefox at 1440/375px, each checking registered text and registered
text beside a real encoded payload. The no-store HTTP server stops before new
input, and the browser is offline. The [baseline](browser-before.json) and
[corrected](browser-after.json) receipts retain exact input/output hashes,
keyboard-selected output, worker identity and served-asset hashes. This verifies
manual output selection; it does not read the operating-system clipboard.

The stricter replay found a late font request in both Firefox baseline layouts.
The bundled Inter and Space Grotesk files are variable fonts, but separate
faces referenced the same file for each weight. Their existing used weights
now share one face per file/range; static IBM Plex Mono faces remain separate.
[Font inspection](font-faces.json) verifies all ten variable files, whose bytes
are unchanged. Corrected contexts have zero late HTTP requests, page errors,
CSP violations, axe violations or page overflow. The source scanner/package
is identical between the two clean archives; the follow-up changes font CSS.

| Browser and width | Before | Corrected |
| --- | --- | --- |
| Chromium, 1440px, registered text | [Four warnings/removals](../../docs/assets/standardized-variants/before/chromium-1440.png) | [No removals](../../docs/assets/standardized-variants/after/chromium-1440.png) |
| Chromium, 375px, mixed payload | [Five findings](../../docs/assets/standardized-variants/before/chromium-375.png) | [Only the payload finding](../../docs/assets/standardized-variants/after/chromium-375.png) |
| Firefox, 1440px, mixed payload | [Five findings](../../docs/assets/standardized-variants/before/firefox-1440.png) | [Only the payload finding](../../docs/assets/standardized-variants/after/firefox-1440.png) |
| Firefox, 375px, registered text | [Four warnings/removals](../../docs/assets/standardized-variants/before/firefox-375.png) | [No removals](../../docs/assets/standardized-variants/after/firefox-375.png) |

All eight retained screenshots were opened and reviewed. The
[artifact receipt](artifacts.json) checks all 53 installed output files, 94 build
inputs and 11 served assets against the clean archives. All 41 package source
files are identical between those archives. Browser evidence applies to these
local builds, not the hosted site.

## Boundaries

The examples are constructed from normative Unicode data, not a newly observed
attack or an estimate of prevalence. A registered glyph variant does not make
surrounding text trustworthy. This preserves text; it does not verify a font's
shaping, glyph support or visual output. The existing broad single-selector
CJK policy still treats an IVS as ordinary without consulting the complete
Ideographic Variation Database. The existing emoji and Mongolian context
policies are unchanged. This is not full Unicode conformance or an upgrade to
a later Unicode release.

## Reproduce

Build a separate archive of the baseline with `npm ci && npm run build` and set
`BASELINE_ROOT` to its directory. In this checkout:

```sh
npm ci
npm run build
node studies/standardized-variants/oracle.mjs "$BASELINE_ROOT" . /tmp/variants-oracle.json
node studies/standardized-variants/cli.mjs "$BASELINE_ROOT/dist/cli.js" dist/cli.js /tmp/variants-cli.json
npm --prefix web ci
npm run web:build
cd web
npm run test:browser -- --grep 'registered variants'
cd ..
node studies/standardized-variants/browser.mjs web/dist /tmp/variants-browser.json verify /tmp/variants-screens
```

The oracle and CLI scripts can target a separately installed package directory
and its `dist/cli.js`. `corpus.mjs` reuses the existing hash-pinned public prompt
cache; it does not download or republish the original text. These changes are
source work only, with no npm release, tag or hosted deployment.
