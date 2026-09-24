# ghostchars

**See the characters you can't.** Catch invisible and deceptive Unicode in code, docs, and LLM prompts.

[![CI](https://github.com/antonsoo/ghostchars/actions/workflows/ci.yml/badge.svg)](https://github.com/antonsoo/ghostchars/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Live demo](https://img.shields.io/badge/demo-the%20UV%20lamp-8f73ff)](https://antonsoo.github.io/ghostchars/)

![ghostchars scanning two files in a terminal, showing a Trojan Source bidi-override finding and a Hangul-filler homoglyph finding](docs/assets/cli-hero.png)

## Why this exists

Unicode gives text producers three ways to make a human and a machine read the same bytes differently:

1. **Bidirectional control characters** can reorder how text *displays* without touching how it's *stored* or *compiled*. Boucher & Anderson's "Trojan Source: Invisible Vulnerabilities" (USENIX Security 2023; disclosed as **CVE-2021-42574**) showed this can hide malicious code inside what looks like a comment or string, across every language they tried.
2. **Invisible and zero-width characters** (zero-width space, Hangul filler, soft hyphen, ...) can split or hide identifiers with no visible trace, and homoglyphs (Cyrillic `а` vs Latin `a`) let one name masquerade as another -- both covered by Unicode's own [UTS #39: Unicode Security Mechanisms](https://www.unicode.org/reports/tr39/).
3. **In the LLM era**, two more encodings let text carry a payload no human reader will ever see: Unicode tag characters (U+E0000-U+E007F, "ASCII smuggling") and variation-selector runs can encode arbitrary hidden bytes inside what looks like an empty flag emoji or an ordinary character. Copy-pasted into a chat UI or a scraped web page, that payload is invisible to the person reviewing the prompt but perfectly legible to the model reading the raw text.

Different tools catch pieces of this (an editor might warn about ambiguous characters, GitHub's web UI banners bidi text), but there wasn't one small thing that catches all of it, runs the same way in CI and inside an LLM input pipeline, and tells you exactly what's hiding and how to remove it. That's ghostchars.

## Quickstart

```sh
npx github:antonsoo/ghostchars .
```

Or install from source:

```sh
git clone https://github.com/antonsoo/ghostchars.git && cd ghostchars
npm install && npm run build
node dist/cli.js .
```

(That last command will report findings -- `tests/` and `examples/` are full of deliberately bad Unicode on purpose, to exercise every rule. `node dist/cli.js src` scans just the library/CLI source, which is clean.)

## Features

- **Library** (`src/index.ts`, zero runtime dependencies, works in Node and the browser): `scanText`, `sanitize`, `reveal`, `decodeTags`, `decodeVariationSelectors`.
- **CLI** (`ghostchars`): scans a path or a `git`-tracked repo, `pretty`/`json`/`sarif`/`github` output, `--fix`/`--dry-run`, `.ghostcharsrc.json` config, a `reveal` subcommand.
- **GitHub Action** (`action.yml`): inline PR annotations or SARIF upload to code scanning.
- **pre-commit hook** (`.pre-commit-hooks.yaml`).
- **Web app**, "the UV lamp": paste text, watch hidden characters glow, entirely client-side. <https://antonsoo.github.io/ghostchars/>

## What it detects

| # | Rule ID(s) | Catches | Severity |
|---|---|---|---|
| 1 | `bidi-control`, `bidi-mark`, `bidi-unbalanced` | Explicit bidi formatting characters (U+202A-202E, U+2066-2069), bidi marks (U+200E, U+200F, U+061C), and embeddings/isolates that open without closing on a line | error / warning / error |
| 2 | `tag-smuggling` | Unicode tag characters (U+E0000-U+E007F) outside a valid emoji tag sequence -- decodes the hidden ASCII | error |
| 3 | `variation-selector-smuggling`, `variation-selector-stray` | Variation-selector runs that decode to a hidden payload, or selectors on a base that can't take one | error / warning |
| 4 | `invisible` | Any `Default_Ignorable_Code_Point` character without a legitimate emoji-ZWJ or script-joining context | warning |
| 5 | `confusable` | Identifiers that mix scripts, or that reduce to the same TR39 "skeleton" as a different spelling elsewhere in the file | warning / error |
| 6 | `unusual-whitespace`, `control-character` | NBSP/em-space/ideographic-space-etc. standing in for a normal space, and C0/C1 controls (especially ESC, which enables terminal escape injection) | warning / warning-or-error |

Run `ghostchars reveal <file>` to see all of this rendered inline, e.g. an override character shows as:

```
⟦U+202E RLO⟧
```

## Usage

```sh
# Scan the current directory (git-tracked files, or a plain walk outside a repo)
ghostchars .

# CI-friendly formats
ghostchars . --format sarif > ghostchars.sarif
ghostchars . --format github        # ::error file=...,line=...::... annotations

# See (and fix) what's hiding
ghostchars reveal suspicious.txt
ghostchars . --fix --dry-run        # preview
ghostchars . --fix                  # apply safe removals in place
```

### As an LLM input filter

```ts
import { sanitize, scanText } from 'ghostchars';

const userInput = await getUntrustedText();
const { findings } = scanText(userInput);
if (findings.some((f) => f.severity === 'error')) {
  // e.g. tag-smuggling or a bidi override: log it, reject it, or...
}
const { text: clean } = sanitize(userInput); // strip everything safely fixable before it reaches the model
```

### GitHub Action

```yaml
- uses: antonsoo/ghostchars@main
  with:
    format: github # inline PR annotations
```

See [`examples/workflows/ghostchars.yml`](examples/workflows/ghostchars.yml) and [`examples/workflows/ghostchars-sarif.yml`](examples/workflows/ghostchars-sarif.yml) (code-scanning upload) for full workflow files.

### Config (`.ghostcharsrc.json`)

```json
{
  "rules": { "unusual-whitespace": "warning" },
  "allow": ["U+200D"],
  "overrides": [
    { "files": ["fixtures/**"], "rules": { "bidi-control": false } }
  ]
}
```

## The web app: "the UV lamp"

<https://antonsoo.github.io/ghostchars/> -- paste or type text and hidden characters glow as labelled chips; a panel decodes smuggled tag/variation-selector payloads; a side-by-side bidi view shows "what you see" (your real browser rendering the bytes, reordering included) against "what the compiler sees" (logical order, every control character made visible); confusable identifiers are underlined with their skeleton on hover; one click copies the sanitized text. Everything runs client-side -- no network requests after the page loads.

![The web app comparing "what you see" vs. the decoded logical order of a tag-smuggled prompt injection, with the hidden instruction revealed](docs/assets/web-tags.png)

![The web app underlining two visually-identical "admin" identifiers -- one Latin, one with a Cyrillic а -- as confusable](docs/assets/web-revealed-confusable.png)

## How it works

### Unicode data

`scripts/generate-unicode-data.mjs` downloads the pinned Unicode Character Database, hashes every source file into `src/generated/manifest.json`, and compiles compact range/lookup tables into `src/generated/`. Pinned versions:

| Data | Source | Version |
|---|---|---|
| `Default_Ignorable_Code_Point`, `Scripts`, `ScriptExtensions`, `Emoji` | unicode.org UCD | **17.0.0** |
| Confusables (UTS #39) | unicode.org Security data | **16.0.0** (latest published; the security-data track versions independently of the UCD and hadn't cut a 17.0.0-aligned release yet) |
| RGI emoji tag sequences | unicode.org Emoji data | **Emoji 16.0** (same reason) |

`LICENSE-UNICODE` is the Unicode License that governs those files.

### Bidi (rule 1)

Every explicit formatting character (LRE/RLE/LRO/RLO/LRI/RLI/FSI/PDI) is flagged on sight. Separately, a per-line stack tracks embeddings and isolates: a PDF with nothing open, a PDI with no isolate to close, or anything still open at end-of-line is reported as `bidi-unbalanced`. The stack resets each line deliberately -- every renderer humans actually read source through (editors, terminals, PR diffs) lays out one line at a time, so an embedding left open at end-of-line has already achieved the Trojan Source effect regardless of what the formal bidi algorithm would do across a paragraph boundary.

### Tag smuggling (rule 2)

Tag characters mirror ASCII 1:1 (U+E0020-U+E007E ↔ 0x20-0x7E). `decodeTags()` finds every maximal run, decodes it, and checks whether it's exactly `U+1F3F4` (waving flag) + tag letters + `U+E007F` (cancel) -- the only legitimate use (regional flag emoji). Anything else -- no base, wrong base, unterminated -- is flagged with the decoded ASCII shown.

### Variation-selector smuggling (rule 3)

`decodeVariationSelectors()` maps VS1-16 (U+FE00-FE0F) to bytes 0-15 and VS17-256 (U+E0100-E01EF) to bytes 16-255, decodes runs as UTF-8, and allows exactly one exception: a single VS15/VS16 on an emoji, or any single selector on a CJK ideograph (a real registered variation sequence, per the Unicode Ideographic Variation Database -- not vendored here, so a single selector on a CJK base is accepted rather than verified against the exact registered pairing). Anything else -- a run of more than one selector, or a selector on the wrong kind of base -- is flagged.

### Invisible characters (rule 4)

Driven directly by the `Default_Ignorable_Code_Point` property rather than a hand list, with two carved-out legitimate contexts: ZWJ between two emoji/regional-indicator code points (real emoji ZWJ sequences), and ZWNJ/ZWJ between letters of a script that uses them for conjunct control (Arabic-family and major Indic/Southeast Asian scripts). A BOM at byte offset 0 is also allowed (a real encoding signature); anywhere else it's flagged.

### Confusables (rule 5)

Follows UTS #39's skeleton approach: every character in an identifier-shaped token is mapped through `confusables.txt`'s prototype mapping and concatenated. Two independent signals are flagged: a single identifier whose non-Common/Inherited characters span more than one `Script`/`Script_Extensions` value (from `Scripts.txt` + `ScriptExtensions.txt`), and two *different* spellings elsewhere in the same input that reduce to the same skeleton -- the actual lookalike-identifier attack, e.g. `admin` (Latin) vs. `админ`-style substitutions sharing a skeleton with the real name. Plain-ASCII tokens skip the character-by-character mapping entirely (only 8 ASCII code points appear as confusables.txt source entries at all), which is most of what a real file contains.

### Whitespace & control characters (rule 6)

A fixed list of Unicode space separators and line/paragraph separators that aren't `U+0020`/`\n`/`\r`, plus C0/C1 controls other than tab/LF/CR -- ESC specifically called out as an error, since printed to a terminal it can rewrite the prompt or hide text.

## Accuracy and limitations

- **Tokenization is regex-based, not an AST.** The confusables rule treats any `\p{L}\p{M}\p{Nd}\p{Pc}`-shaped run as an "identifier," including words inside comments and string literals -- it will flag `admin` written twice in a docstring next to its Cyrillic lookalike, the same as it would in real code. That's a legitimate signal (the text is still confusable to a reader either way) but not a scope-aware linter.
- **CJK variation sequences are accepted, not verified.** A single variation selector on a CJK ideograph is treated as an ordinary Ideographic Variation Sequence rather than checked against the real IVD registry (not vendored here), so an invalid but structurally-single selector on a CJK base won't be flagged.
- **The bidi-balance check is per-line by design** (see above); a payload that only becomes unbalanced when reasoned about across an entire multi-line paragraph, rather than within one rendered line, is out of scope.
- **NFKC-instability detection (optional in the brief) is not implemented.** Everything else in the brief is.
- Every detector was checked against an independent oracle where one exists: bidi/tag/variation-selector/invisible ranges are cross-checked against literal code points from the Unicode spec text (not re-derived from the generated tables), and the confusables skeleton is verified against `confusables.txt` entries directly (see `tests/`).

## Performance

```sh
npm run bench
```

Measured on this machine (14 vCPU / 48 GB RAM, WSL2 Linux) **while several other builds were running concurrently** -- this is a contended-machine number, not a best case, and `npm run bench` will do meaningfully better on an idle box:

- `scanText()` on 15 MiB of synthetic, code-shaped text (labelled synthetic; not sampled from a real project): **15.1s, ~1.0 MiB/s**, 15,728,663 code points, 669 findings.
- `scanText()` over this repo's real `node_modules/` (3,353 files, 34.1 MiB): **17.9s, ~1.9 MiB/s**, 9,441 findings.

The confusables rule dominates cost (per-token script/skeleton lookups); it has a fast path for plain-ASCII tokens (the common case) but a file that's mostly unique multi-script identifiers is close to worst case.

## Comparison

- **VS Code's built-in Unicode highlighting** (`editor.unicodeHighlight.*`) flags ambiguous and invisible characters live in the editor -- great for authoring, but it's not a CLI/CI tool, doesn't decode tag/variation-selector payloads, and doesn't run outside VS Code (e.g. in an LLM pipeline).
- **GitHub's web UI** shows a "this file contains bidirectional Unicode text" banner for files with bidi control characters -- useful, but bidi-only, review-time-only, and not something you can gate CI on or call as a library.

ghostchars overlaps both at the bidi layer and adds tag/variation-selector decoding, confusable-skeleton collision detection, a library API, and CI/Action/pre-commit integration.

## Tests

```sh
npm test
```

43 tests across every rule (positive and negative cases -- legitimate emoji ZWJ sequences, RGI flag tag sequences, Persian ZWNJ, CJK variation sequences, and plain-ASCII/single-script identifiers all must **not** fire), plus `sanitize()`/`reveal()` and CLI/config/file-discovery coverage.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Issues and PRs welcome.

## License

[MIT](LICENSE) for the code. Vendored Unicode data (`src/generated/`) is governed by the [Unicode License](LICENSE-UNICODE).

See [SECURITY.md](SECURITY.md) for the security policy.
