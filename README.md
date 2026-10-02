# ghostchars

**See the characters you can't.** Catch invisible and deceptive Unicode in code, docs, and LLM prompts.

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
npx --allow-git=root github:antonsoo/ghostchars .
```

That installs straight from GitHub: the npm package, `@antonsoloviev/ghostchars`,
isn't published yet (npm 12 needs `--allow-git=root` for a git-hosted package). The unscoped `ghostchars` package on npm is a
different, unrelated project.

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
| 4 | `invisible` | Any `Default_Ignorable_Code_Point` character without a legitimate emoji-ZWJ or script-joining context (a ZWJ/ZWNJ after an Indic virama, such as a Malayalam chillu, counts as one) | warning |
| 5 | `confusable` | Words that mix scripts beyond what UTS #39 allows and hold a lookalike (`paypal` with a Cyrillic letter, U+0430, for its `a`), or that reduce to the same TR39 "skeleton" as a different spelling elsewhere in the file | warning / error |
| 6 | `unusual-whitespace`, `control-character` | NBSP/em-space/ideographic-space-etc. standing in for a normal space (French typography's no-break space before `; : ! ?` and inside `« »` is allowed, and so is the ideographic space next to Chinese, Japanese or Korean text), the braille pattern blank outside braille text (it looks like a space but isn't whitespace), and C0/C1 controls (especially ESC, which enables terminal escape injection) | warning / warning-or-error |

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

```sh
npm install --allow-git=root github:antonsoo/ghostchars
```

```ts
import { sanitize, scanText } from '@antonsoloviev/ghostchars';

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

<https://antonsoo.github.io/ghostchars/> -- paste or type text and hidden characters glow as labelled chips; a panel decodes smuggled tag/variation-selector payloads; a side-by-side bidi view shows "what you see" (your real browser rendering the bytes, reordering included) against "what the compiler sees" (logical order, every control character made visible); confusable identifiers are underlined with their skeleton on hover; one click copies the sanitized text. Everything runs client-side: the text you inspect is never sent anywhere. (Google Fonts loads over the network for the typeface; nothing else does.)

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

Follows UTS #39's skeleton approach: every character in an identifier-shaped token is mapped through `confusables.txt`'s prototype mapping and concatenated. Two independent signals are flagged.

**A word that mixes scripts and holds a lookalike.** Real writing mixes scripts all the time, so the scripts of a word (from `Scripts.txt` + `ScriptExtensions.txt`, Common and Inherited aside) are first held against UTS #39's restriction levels (section 5.2). A word is ordinary, and not looked at further, when it is one script; Latin with Han + Hiragana + Katakana, Han + Bopomofo or Han + Hangul (Japanese, Chinese and Korean have no spaces, so a Latin term sits inside the word around it); or Latin with one other script in general use except Cyrillic and Greek (Arabic and Hebrew attach prefixes to a Latin term). What is left (Latin with Cyrillic or Greek, two non-Latin scripts, Latin with a script like Cherokee) is reported when the word holds an actual lookalike: a character of another script that `confusables.txt` reduces to ASCII letters, or an ASCII letter planted in a word of a script that has a double for it. So `LaTeX2ε`, `Δt` and `10μs` pass (a Greek letter used as a symbol imitates nothing) and `paypal` with the Cyrillic U+0430 for its `a` does not. The words of a `snake_case` name are judged one by one.

**Two different spellings elsewhere in the same input that reduce to the same skeleton**, where at least one side is non-ASCII and the two are not simply two words of one non-Latin script -- the actual lookalike-identifier attack, e.g. an ASCII `admin` vs. the same word with a Cyrillic substitution for one letter sharing a skeleton with the real name.

### Whitespace & control characters (rule 6)

A fixed list of Unicode space separators and line/paragraph separators that aren't `U+0020`/`\n`/`\r`, plus C0/C1 controls other than tab/LF/CR -- ESC specifically called out as an error, since printed to a terminal it can rewrite the prompt or hide text.

## Accuracy and limitations

- **A confusable/skeleton collision requires at least one non-ASCII side.** Two pure-ASCII spellings that happen to share a TR39 skeleton (`rn`/`m`, `l`/`1`/`I`, `O`/`0`) are a font-rendering ambiguity, not the cross-script Unicode attack this tool targets -- and English prose is full of them by accident (an early draft of this README tripped over "CI" vs. "C0/C1" reducing to the same skeleton). Flagging those would be noise, not signal, so ghostchars only reports a collision when at least one spelling contains a non-ASCII character -- the actual homoglyph-attack shape (a genuine ASCII `admin` next to the same word with one letter swapped for a Cyrillic lookalike, U+0430 in place of "a").
- **Measured on real multilingual text.** Sixty translated documents from two public repositories (the `free-programming-books` lists in 42 languages and the `javascript-algorithms` README in 18: Arabic, Hebrew, Persian, Hindi, Tamil, Thai, Japanese, Chinese, Korean, Russian and more) produced 279 findings in 23 files before 0.1.4: 240 "mixed script" warnings on Latin terms inside Japanese, Chinese and Korean sentences, and 11 collision errors, most between ordinary Hebrew words (vav and final nun both reduce to `l`). They produce 29 now, each one a real character: 16 doubled variation selectors after a heart emoji, 8 stray zero-width spaces, soft hyphens and a misplaced ZWNJ, a no-break space, and a Russian word spelled with a Latin `c`, which is the thing this rule exists to find.
- **Two words of one non-Latin script that share a skeleton are not reported.** `confusables.txt` folds lookalikes inside a script too, so ordinary text collides with itself. Latin is the exception, since its own non-ASCII lookalikes (a dotless i, U+0131; a fullwidth letter) are how an ASCII name is imitated without leaving the script; the price is that Turkish text, where the question particle is written both with a dotted and with a dotless i, is reported (see the `node_modules` breakdown below).
- **Tokenization is regex-based, not an AST.** The confusables rule treats any `\p{L}\p{M}\p{Nd}\p{Pc}`-shaped run as an "identifier," including words inside comments, string literals, and plain prose -- it will flag `admin` written twice in a docstring next to its Cyrillic lookalike, the same as it would in real code.
- **A single character type is sometimes both a real signal and commonly legitimate at once.** NBSP is the clearest case: French typography requires it before `:`/`;`/`!`/`?`, so any French-localized string will contain plenty of "findings" that are correct detections of a real, intentional NBSP -- not an attack. This is a known, honest trade-off of not being format-aware (see the `node_modules` breakdown below); `.ghostcharsrc.json` per-glob overrides exist specifically to quiet a known-legitimate path (e.g. a translations directory) without touching the default elsewhere.
- **CJK variation sequences are accepted, not verified.** A single variation selector on a CJK ideograph is treated as an ordinary Ideographic Variation Sequence rather than checked against the real IVD registry (not vendored here), so an invalid but structurally-single selector on a CJK base won't be flagged.
- **The bidi-balance check is per-line by design** (see above); a payload that only becomes unbalanced when reasoned about across an entire multi-line paragraph, rather than within one rendered line, is out of scope.
- **NFKC-instability detection (optional in the brief) is not implemented.** Everything else in the brief is.
- Every detector was checked against an independent oracle where one exists: bidi/tag/variation-selector/invisible ranges are cross-checked against literal code points from the Unicode spec text (not re-derived from the generated tables), and the confusables skeleton is verified against `confusables.txt` entries directly (see `tests/`).

## Performance

```sh
npm run bench
```

Every rule in this tool is triggered by either a code point ≥ U+0080 or a C0/DEL control character -- so `scanText()` opens with one linear regex test (`/[^\t\n\r\x20-\x7E]/`) over the whole input, and if it finds nothing, returns immediately: no code point iteration, no tokenizing, nothing. Plain ASCII, the overwhelming majority of real source, takes that path.

Measured on this machine (14 vCPU / 48 GB RAM, WSL2 Linux; numbers vary with concurrent load on this box, run `npm run bench` for a live measurement):

- **Pure-ASCII fast path**: `scanText()` on 50 MiB of pure-ASCII, code-shaped synthetic text: **35ms, ~1.4 GiB/s**, 0 findings.
- **Mixed content** (the fast path can't apply -- every rule actually runs): `scanText()` on 50 MiB of synthetic text with non-ASCII/bidi/confusable content scattered through it (labelled synthetic; not sampled from a real project): **~3s, ~17 MiB/s**, 2,191 findings. The confusables rule dominates this cost: once a file has an identifier with a non-ASCII character in it, every other identifier is reduced to its skeleton to look for a collision.
- **Real-world**: `scanText()` over this repo's own `node_modules/` (3,353 files, 34.1 MiB, walked directly -- `ghostchars` itself would never scan a gitignored `node_modules/` in normal use, but it's a convenient stand-in for "a big, messy, real tree"): **~0.8s, ~45 MiB/s**, 598 findings:

  | count | rule |
  |---:|---|
  | 416 | `confusable` |
  | 162 | `unusual-whitespace` |
  | 9 | `invisible` |
  | 8 | `control-character` |
  | 3 | `variation-selector-stray` |

  Nearly all the `confusable` findings sit in two files: Vite's bundled `node.js` chunk (360) and TypeScript's Turkish message catalog (51, the dotless-i case above). The other five are real: the homograph examples in punycode's README, and `js` followed by a Cyrillic es (U+0441) where `jsc` was meant, in TypeScript's Russian catalog. The `unusual-whitespace` findings are NBSPs (159 of 162), most of them in TypeScript's Portuguese, Polish, Russian, French, German and Spanish catalogs -- real detections of a real character, and the trade-off described above rather than a bug (a NBSP in the places French typography puts one is not flagged, which is why this count is no longer in the thousands). The rest are genuine, if benign, oddities: zero-width spaces and joiners in TypeScript's Korean catalog and two `.d.ts` files, literal control bytes in `js-yaml`'s escape-sequence tables and in the prompt code bundled with Rolldown and Vitest, a doubled variation selector in `ts-api-utils`' README and manifest and a stray one in `ajv`'s README -- true positives, none of them attacks.

Memory grows with what is found, not with the size of the text: each rule looks for its own characters and builds a record only for those. The whole benchmark, its three 50 MiB strings included, peaks at about 670 MB. (Until 0.1.3 every code point of a non-ASCII file was held as an object, well over a hundred bytes per character, and this benchmark ran out of heap at its own default size.)

## Comparison

- **VS Code's built-in Unicode highlighting** (`editor.unicodeHighlight.*`) flags ambiguous and invisible characters live in the editor -- great for authoring, but it's not a CLI/CI tool, doesn't decode tag/variation-selector payloads, and doesn't run outside VS Code (e.g. in an LLM pipeline).
- **GitHub's web UI** shows a "this file contains bidirectional Unicode text" banner for files with bidi control characters -- useful, but bidi-only, review-time-only, and not something you can gate CI on or call as a library.

ghostchars overlaps both at the bidi layer and adds tag/variation-selector decoding, confusable-skeleton collision detection, a library API, and CI/Action/pre-commit integration.

## Tests

```sh
npm test
```

69 tests across every rule (positive and negative cases -- legitimate emoji ZWJ sequences, RGI flag tag sequences, Persian ZWNJ, CJK variation sequences, real Japanese/Korean CJK-script text, and plain-ASCII/single-script/ASCII-vs-ASCII-only identifiers all must **not** fire), plus `sanitize()`/`reveal()`, the ASCII fast path, CLI/config/file-discovery coverage, and a fuzz test of `sanitize()` on hostile strings (it never throws, its output scans clean, and it never deletes a visible character), with a check that 30,000 findings in one text are scanned and removed in well under a second.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Issues and PRs welcome.

## License

[MIT](LICENSE) for the code. Vendored Unicode data (`src/generated/`) is governed by the [Unicode License](LICENSE-UNICODE).

See [SECURITY.md](SECURITY.md) for the security policy.

---

<sub>Part of [Officina](https://antonsoo.github.io/officina/), a set of small open-source tools by [Anton Soloviev](https://github.com/antonsoo).</sub>
