# One selector per ideograph must not hide an instruction

The [authored fixture](fixtures/carrier-message.txt) looks like four repetitions
of `山川異域風月同天`. Each visible character also carries one unregistered
variation selector, encoding one byte of `ignore all previous instructions`.
The baseline scanner at `80eb4020e9d56add7ffdad60ebe0439ec46bb33c`
reports **zero findings**, leaves the payload intact during repair and exits 0.
The corrected source reports 32 payload errors, decodes the instruction once,
and removes the selectors while retaining all 32 visible characters.

This is a controlled encoding, not an attack discovered in the public corpus
or a demonstration of any model following the hidden instruction.

## Exact registrations, rather than CJK block membership

The old exception accepted any single selector after any character in a broad
list of CJK blocks. Those structural conditions do not establish a registered
Ideographic Variation Sequence. It also rejected four actual registered pairs
outside those blocks, deleting their selectors during repair.

| Input | Baseline | Corrected source |
| --- | --- | --- |
| 32 adjacent, unregistered byte carriers | No findings; payload retained | 32 errors; instruction decoded; carriers retained |
| `U+30654` with `U+E0100`, `U+E0101` or `U+E0102` | Warning; selector removed | Registered; preserved |
| `U+31350 U+E0100` | Warning; selector removed | Registered; preserved |
| `U+908A U+FE00` | Silently accepted | Unregistered; warning |
| Registered selector choices on adjacent ideographs | Preserved | Preserved; not decoded as a payload |

The generator now vendors exact pairs from the
[IVD of 2026-08-03](https://www.unicode.org/ivd/data/2026-08-03/IVD_Sequences.txt),
independently versioned from Unicode 17's UCD. The file has 39,509 collection
records, 29,642 distinct pairs and 15,304 bases; multiple collections can
register the same pair. Its SHA-256 is
`2b466659c2bfde1c52e60bd9fc883ab14dfa5c583df024b80352420265d2cd87`.
The [manifest](../../src/generated/manifest.json) records the URL, size and
digest. The generated table retains the Unicode license attribution.

[UTS #37](https://www.unicode.org/reports/tr37/) defines registered ideographic
variants and explains that variation selectors are default-ignorable.
Registration does not guarantee a font will render a distinct glyph, establish
author intent or make text safe. Valid registered variants can also encode
choices. This scanner preserves them; it is not universal steganalysis.

## Decoder boundaries

Adjacent, unregistered single-selector carriers can now form a byte stream.
Only sequences of at least eight bytes decoding as valid UTF-8 without C0/C1
controls other than tab, LF and CR are presented as a combined message.
Unrelated source text, newlines, registered variants and other selector-run
shapes break the chain. Short and invalid streams remain individual stray
selector warnings. Existing single-byte previews can still appear in those
warnings; they are not joined across a boundary.

The first finding carries the combined `decoded` value; subsequent findings
identify their byte positions. Every finding retains its original UTF-16 source
and removal ranges. Both library repair modes and CLI repair preserve the
visible base characters. Existing multi-selector and one-bit-per-word decoders
remain available. Nested multi-selector payloads retain their eight-layer limit;
this change does not add general recursive decoding of distributed streams.

## Replay

```sh
npm ci && npm run build
node dist/cli.js studies/ideographic-selectors/fixtures/carrier-message.txt --no-config --format summary
node studies/ideographic-selectors/replay.mjs . /tmp/ivs-after.json --verify
curl -fsSL https://www.unicode.org/ivd/data/2026-08-03/IVD_Sequences.txt -o /tmp/IVD_Sequences.txt
node studies/ideographic-selectors/oracle.mjs . /tmp/IVD_Sequences.txt /tmp/ivs-oracle.json --full --verify
```

The CLI scan exits 1. [Before](results/before.json) and
[after](results/after.json) retain six public-library controls, all four CLI
report formats, repair exits, byte hashes and runtime identity.

The oracle parses the pinned text independently of the generated lookup table.
It scans and repairs all 29,642 registered pairs separately: the four baseline
false warnings and removals become zero. It also checks every one of 240 high
selectors for all 15,304 registered bases, **3,672,960 classification probes**,
with zero mismatches. This exhausts that matrix, not all Unicode or all input
contexts. [Before](results/oracle-before.json),
[after](results/oracle-after.json).

The [full existing prompt-census replay](results/corpus.json) verifies all
83,494 input file digests against its cached manifest. All **18,583 findings**
and complete output digests are unchanged, including unrelated rules. No new
attack was found there. This previously inspected corpus is compatibility
evidence, not a held-out detection benchmark. The historical census's released
0.1.5 count uses different source; the fresh comparison uses `80eb402` on both
sides except for this correction.

```sh
node studies/ideographic-selectors/corpus.mjs BASELINE_ROOT CURRENT_ROOT /tmp/ivs-corpus.json
```

The census cache is obtained as described in [its study](../prompt-census/README.md).
## Installed CLI and offline browser

The [artifact receipt](results/artifacts.json) records a fresh staged-tree archive:
types, lint, 351 tests, self-scan, benchmark smoke, web types/lint/build and
40 Chromium/Firefox workflows all pass. The checked-in CLI equals the clean
build. A separate installation of the packed tarball with `--ignore-scripts`
has all **55 `dist/` files** and both licenses byte-identical to that build;
the installed command is executable.

Both [Node 20.0.0](results/installed-node20.json), the declared minimum, and
[Node 26.7.0](results/installed-node26.json) replay the six library controls,
four actual CLI formats and dry-run/real repair. The minimum runtime also scans
and repairs [all 29,642 registered pairs](results/installed-oracle-node20.json)
without a finding or change. The version was read from each actual process.

The [focused browser replay](results/browser.json) uses the real built worker
in Chromium and Firefox at 1440px and 375px. It byte-compares every emitted web
asset, then shuts down the no-store HTTP server and goes offline before new
input. All four registered controls survive. The instruction decodes, all 32
carrier findings remain, three locations select the exact original UTF-16
spans, and keyboard output selection equals the visible carriers. No subsequent
network requests, page/CSP errors, horizontal overflow or Axe violations occur.
This checks keyboard selection; it does not read the operating-system clipboard.

All four captures were opened and inspected. The existing app has one dark
theme. CJK glyphs use an existing Microsoft YaHei font copied to temporary
task-only Fontconfig paths; no system setting changes or font redistribution
are part of the source. Registration tests do not assert that these newer
ideographs render a distinct glyph in that font.

![The actual offline worker reveals the distributed instruction and preserves its visible carriers](../../docs/assets/ideographic-selectors/chromium-1440.png)

[Phone capture](../../docs/assets/ideographic-selectors/firefox-375.png).

Vendoring the exact registry has a loading cost:

| Built file | Before bytes | After bytes | Before gzip bytes | After gzip bytes |
| --- | ---: | ---: | ---: | ---: |
| CLI | 278470 | 620860 | 73834 | 158968 |
| Browser scanner worker | 176748 | 457417 | 57057 | 137590 |

[Build identities](results/build-cost.json) come from locked builds of both
revisions. Gzip sizes are computed locally, not measured HTTP transfer sizes.
The [generator replay](results/generator.json) independently downloaded all
eight pinned sources again and reproduced all eight generated TypeScript files;
only the manifest's generation timestamp changes.

These are local source and installed-artifact checks. No npm release is implied
by the unchanged package version 0.1.5. Public source and hosted bytes require
separate verification.
