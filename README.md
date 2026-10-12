# ghostchars

**See the characters you can't.** Catch invisible and deceptive Unicode in code, docs, and LLM prompts.

[![npm](https://img.shields.io/npm/v/@antonsoloviev/ghostchars)](https://www.npmjs.com/package/@antonsoloviev/ghostchars)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Live demo](https://img.shields.io/badge/demo-the%20UV%20lamp-8f73ff)](https://antonsoo.github.io/ghostchars/)

![ghostchars scanning two files in a terminal, showing a Trojan Source bidi-override finding and a Hangul-filler homoglyph finding](docs/assets/cli-hero.png)

## What it found in 83,494 public prompts

Run over public rules files, skills, system prompts, jailbreak collections and two attack games, the study found text hidden in tag characters or variation selectors in 3 of 83,494 documents, all in one jailbreak repository and none in the 5,718 rules, skill and sub-agent files; ghostchars 0.1.5 decoded 2 of the 4 payloads. It reported 18,390 findings in 401 documents, and by hand-reading them, 53% were neither hidden nor disguised text (94.7% once one obfuscated jailbreak is set aside): pasted no-break spaces, Turkish and Persian orthography, bold-letter LinkedIn skills. It also missed an instruction override typeset in small capitals and a jailbreak typeset in circled letters. The checkout (unreleased) adds a `styled-text` rule that reads such passages out, decodes payloads nested inside payloads and one-bit-per-word payloads, stops reporting ordinary Turkish, Russian and Greek words, and has `--format summary`. Documents with an error-level finding fall from 57 to 15. Counts, labels and the held-out check: [`studies/prompt-census`](studies/prompt-census/README.md).

## Why this exists

Unicode gives text producers three ways to make a human and a machine read the same bytes differently:

1. **Bidirectional control characters** can reorder how text *displays* without touching how it's *stored* or *compiled*. Boucher & Anderson's "Trojan Source: Invisible Vulnerabilities" (USENIX Security 2023; disclosed as **CVE-2021-42574**) showed this can hide malicious code inside what looks like a comment or string, across every language they tried.
2. **Invisible and zero-width characters** (zero-width space, Hangul filler, soft hyphen, ...) can split or hide identifiers with no visible trace, and homoglyphs (Cyrillic `а` vs Latin `a`) let one name masquerade as another -- both covered by Unicode's own [UTS #39: Unicode Security Mechanisms](https://www.unicode.org/reports/tr39/).
3. **Hidden payload encodings**: Unicode tag characters (U+E0000-U+E007F, "ASCII smuggling") and variation-selector runs can encode bytes inside what looks like an empty flag emoji or an ordinary character. A raw-text pipeline receives those code points even when its review interface does not display them.

ghostchars combines these detectors in a dependency-free library, CLI and browser inspector. The findings name the characters and show decoded payloads so a reviewer can decide what to retain or remove.

## Quickstart

```sh
npx @antonsoloviev/ghostchars .
```

That runs the published package
([`@antonsoloviev/ghostchars`](https://www.npmjs.com/package/@antonsoloviev/ghostchars)
on npm; the command it installs is `ghostchars`). The unscoped `ghostchars`
package on npm is a different, unrelated project.

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
- **Web app**, "the UV lamp": paste text, watch hidden characters glow, entirely client-side (the page's Content-Security-Policy, `connect-src 'self'`, has the browser refuse to send the text anywhere). <https://antonsoo.github.io/ghostchars/>

## What it detects

The source checkout also catches **accented cross-script lookalikes** that the
previous scanner missed entirely. A runnable JavaScript example returned a
clean scan despite declaring two visually confusable, distinct variables.
[Before/after CLI output, independent ICU checks and the public-text replay](studies/canonical-confusables/README.md)
show the correction and its limits. Canonically equivalent prose spellings
stay quiet; identifier text is never automatically renamed. This correction
is available from source. The linked verification covers local builds and
installed artifacts; no npm release was made for this change.

| # | Rule ID(s) | Catches | Severity |
|---|---|---|---|
| 1 | `bidi-control`, `bidi-mark`, `bidi-unbalanced` | Explicit bidi formatting characters (U+202A-202E, U+2066-2069), bidi marks (U+200E, U+200F, U+061C), and embeddings/isolates that open without closing on a line | error / warning / error |
| 2 | `tag-smuggling` | Unicode tag characters (U+E0000-U+E007F) outside a valid emoji tag sequence -- decodes the hidden ASCII | error |
| 3 | `variation-selector-smuggling`, `variation-selector-stray` | Variation-selector runs that decode to a hidden payload, or selectors on a base that can't take one | error / warning |
| 4 | `invisible` | Any `Default_Ignorable_Code_Point` character without a legitimate emoji-ZWJ or script-joining context (a ZWJ/ZWNJ after an Indic virama, such as a Malayalam chillu, counts as one) | warning |
| 5 | `confusable` | Words that mix scripts beyond what UTS #39 allows and hold a lookalike (`paypal` with a Cyrillic letter, U+0430, for its `a`), or that reduce to the same TR39 "skeleton" as a different spelling elsewhere in the file | warning / error |
| 6 | `unusual-whitespace`, `control-character` | NBSP/em-space/ideographic-space-etc. standing in for a normal space (French typography's no-break space before `; : ! ?` and inside `« »` is allowed, and so is the ideographic space next to Chinese, Japanese or Korean text), the braille pattern blank outside braille text (it looks like a space but isn't whitespace), and C0/C1 controls (especially ESC, which enables terminal escape injection) | warning / warning-or-error |
| 7 | `styled-text` (source checkout, unreleased) | Passages of letters from the mathematical, fullwidth, circled, squared and small-capital alphabets, reported with the plain text they read as (`decoded`): a model reads that text, a match on code points does not | warning |

Run `ghostchars reveal <file>` to see all of this rendered inline, e.g. an override character shows as:

```
⟦U+202E RLO⟧
```

## Usage

```sh
# Scan the current directory (git-tracked files, or a plain walk outside a repo)
ghostchars .

# One line per kind of finding in each file, with what any payload decodes to (source checkout, unreleased)
ghostchars . --format summary

# CI-friendly formats
ghostchars . --format sarif > ghostchars.sarif
ghostchars . --format github        # ::error file=...,line=...::... annotations

# See (and fix) what's hiding
ghostchars reveal suspicious.txt
ghostchars . --fix --dry-run        # preview
ghostchars . --fix                  # apply configured removals in place
```

The source checkout's default terminal report shows a short excerpt around
**every** finding, with `[[...]]` marking its exact source span. Locations use
the original UTF-16 columns and exclusive end positions; long excerpts and
diagnostic text declare their omissions. This avoids repeatedly scanning and
printing whole lines: a recorded 97 KB document previously produced 91 MB of
output. Full findings remain available in `--format json`; `--format summary`
still groups repeated findings. [Before/after output and installed checks](studies/pretty-preview/README.md)
cover this source-only change. npm 0.1.5 has not been updated with it.

The source checkout includes an **unreleased repair fix**: `--fix` now honors
the same rules, allowlist and matching file overrides as the scan, including
later passes. Its preview shows the actual proposed text; invalid encodings or
invalid explicit configuration stop with exit 2 instead of being rewritten.
See [repair behavior and before/after evidence](studies/repair-policy/README.md).

Registered Unicode variants also survive scans and repairs in the source
checkout. Previously, `--fix` removed valid selectors from slashed zero,
mathematical symbols, CJK punctuation and script variants while claiming they
were unregistered. Exact Unicode 17 pairs now come from the pinned normative
table. Unsupported pairs and encoded payloads still produce findings.
[Reproductions and independent Unicode checks](studies/standardized-variants/README.md)
cover the correction; no npm release or hosted deployment is included.


The source checkout also reports **incomplete scans** separately from clean
results. Unreadable files, failed directory/Git enumeration and decoding errors
return exit 2, with details in every report format. Discovered symbolic links
are listed as exclusions and never followed by `--fix`; an explicitly named
link asks for the real target path. [Filesystem reproductions and installed
CLI verification](studies/discovery-evidence/README.md) retain the before/after
results. These changes have not been released to npm.

Dense bidi controls also avoid repeated full-stack searches in the source
checkout. A controlled 192 KB file scanned in 0.28 seconds versus 2.78 seconds
before the change; repair took 0.43 seconds versus 8.59 seconds, retaining
identical findings and repaired bytes. These are local single-run observations,
not production traffic or portable timing guarantees. [Reproduction, complete
output comparisons and offline browser evidence](studies/bidi-scaling/README.md).

### As an LLM input filter

```sh
npm install @antonsoloviev/ghostchars
```

```ts
import { sanitize, scanText } from '@antonsoloviev/ghostchars';

const userInput = await getUntrustedText();
const { findings } = scanText(userInput);
if (findings.some((f) => f.severity === 'error')) {
  // e.g. tag-smuggling or a bidi override: log it, reject it, or...
}
const { text: clean, remaining } = sanitize(userInput); // review both before using the result
```

Removal is textual: it can join words, change typography or affect code. It does
not establish that a prompt is trustworthy. The source checkout also accepts
`sanitize(text, { scanOptions: { allowCodePoints: [0xA0], severityOverrides:
{ invisible: false } } })` to apply the same policy on every pass.

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

In the source checkout, `allow` protects each listed Unicode scalar even inside
a compound finding. A disabled rule cannot remove text, but another enabled rule
may still cover the same character; disabling `bidi-control` alone does not
disable `bidi-unbalanced`. Severity changes (`info`, `warning`, `error`) change
reporting, not whether an enabled fixable rule can remove its characters.
All matching overrides merge in order; allowlists accumulate.

`--fix` reports findings from the **original** scan: exit 1 means error-level
findings, while exit 2 takes precedence for input or repair failures. Run a
second scan to check what remains. In the source checkout, discovery and reading
finish before any write; an input failure blocks every planned repair. A later
repair is written to an exclusive temporary file in the original's directory,
flushed, and renamed over the original only after **all** replacements have been
prepared. A failed staging write leaves every original untouched; a later rename
failure can leave earlier files repaired. There are no backups or transaction
across files. A file changed since the scan is refused when noticed; these checks
do not provide an atomic filesystem sandbox against concurrent editors.

Replacement requires a writable original and parent directory. It retains the
text encoding/BOM and, on POSIX, the owner, group and permission bits (including
executable bits), or fails before replacement. Hard-linked files are refused;
make an independent copy to repair one. Replacement changes the inode and does
**not** copy extended attributes, ACLs or alternate data streams. Use a
metadata-aware editing workflow for files that depend on those properties.
An abrupt process termination can leave a `.ghostchars-*.tmp` file beside an
unchanged original. File flushing is not a power-loss durability guarantee, and
network filesystems can have different failure semantics. `--dry-run` previews
text without testing these write prerequisites.
[Failure replay and exact boundaries](studies/atomic-repair/README.md).

JSON reports add `summary.complete`, `summary.inputErrors` and an `errors` array.
`skipped` records intentional exclusions (binary, over 5 MiB, symbolic links,
or non-regular entries), not failed reads. `complete: true` means the eligible
inputs were processed; excluded files have not been analyzed. SARIF records
execution failure separately from findings; GitHub output emits error annotations
for incomplete inputs. A detected bidi finding alone is a successful scan with
exit 1, not an execution failure. [Exact report examples](studies/discovery-evidence/README.md).

## The web app: "the UV lamp"

<https://antonsoo.github.io/ghostchars/> -- paste text to reveal hidden characters as labelled chips, including controls inside confusable identifiers. Decoded payloads show escaped controls so they cannot reorder or conceal their own diagnostics. The bidi comparison keeps the real browser rendering beside the annotated logical order; finding locations select the exact source range, including after astral characters.

Review the sanitized text before copying it. Fixable characters are removed, while lookalike identifiers stay in the output and appear in a remaining-findings list. A successful scan or sanitize operation is **not a safety guarantee**. If clipboard access fails, the sanitized output is selected for manual copying.

Scanning runs in a local worker. Editing, clearing, or cancelling discards the previous scan and its output; a failed worker can be retried. A settled worker is reused for ordinary offline edits. Restarting after cancellation or a worker failure may require connectivity to reload the scanner. Fonts, code, and workers load from this site, with no analytics or third-party requests. Inspected text is never uploaded.

| Browser boundary | Behavior |
|---|---|
| Input | At most 100,000 UTF-16 code units; larger text is rejected before scanning. Use the CLI for larger files. |
| Text previews | At most 10,000 code units and 300 findings, stopping before a finding or surrogate pair would be split. A long overlapping finding can leave the preview empty; the notice explains what was omitted. |
| Finding lists | First 300 entries per list; first 20 remaining findings after sanitizing. Long diagnostic messages are visibly shortened. |
| Counts and sanitized output | Always cover the complete accepted input. Display limits never truncate copied text. |

![The web app comparing "what you see" vs. the decoded logical order of a tag-smuggled prompt injection, with the hidden instruction revealed](docs/assets/web-tags.png)

![Reviewing sanitized output with an unresolved lookalike and a revealed hidden joiner](docs/assets/web-review-desktop.png)

[Phone-width review screenshot](docs/assets/web-review-mobile.png)

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

Uses UTS #39's prototype mappings for identifier-shaped tokens. In this source
checkout, canonical decomposition (NFD) runs before and after that mapping,
so accents and combining order cannot hide a collision. This is a prose-aware
subset, not a complete UTS #39 conformance implementation. Two independent
signals are flagged.

**A word that mixes scripts and holds a lookalike.** Real writing mixes scripts all the time, so the scripts of a word (from `Scripts.txt` + `ScriptExtensions.txt`, Common and Inherited aside) are first held against UTS #39's restriction levels (section 5.2). A word is ordinary, and not looked at further, when it is one script; Latin with Han + Hiragana + Katakana, Han + Bopomofo or Han + Hangul (Japanese, Chinese and Korean have no spaces, so a Latin term sits inside the word around it); or Latin with one other script in general use except Cyrillic and Greek (Arabic and Hebrew attach prefixes to a Latin term). What is left (Latin with Cyrillic or Greek, two non-Latin scripts, Latin with a script like Cherokee) is reported when the word holds an actual lookalike: a character of another script that `confusables.txt` reduces to ASCII letters, or an ASCII letter planted in a word of a script that has a double for it. So `LaTeX2ε`, `Δt` and `10μs` pass (a Greek letter used as a symbol imitates nothing) and `paypal` with the Cyrillic U+0430 for its `a` does not. The words of a `snake_case` name are judged one by one.

**Two different spellings elsewhere in the same input that reduce to the same skeleton**, where at least one side is non-ASCII and the two are not simply two words of one non-Latin script -- the actual lookalike-identifier attack, e.g. an ASCII `admin` vs. the same word with a Cyrillic substitution for one letter sharing a skeleton with the real name.

### Whitespace & control characters (rule 6)

A fixed list of Unicode space separators and line/paragraph separators that aren't `U+0020`/`\n`/`\r`, plus C0/C1 controls other than tab/LF/CR -- ESC specifically called out as an error, since printed to a terminal it can rewrite the prompt or hide text.

## Accuracy and limitations

- **A confusable/skeleton collision requires at least one non-ASCII side.** Two pure-ASCII spellings that happen to share a TR39 skeleton (`rn`/`m`, `l`/`1`/`I`, `O`/`0`) are a font-rendering ambiguity, not the cross-script Unicode attack this tool targets -- and English prose is full of them by accident (an early draft of this README tripped over "CI" vs. "C0/C1" reducing to the same skeleton). Flagging those would be noise, not signal, so ghostchars only reports a collision when at least one spelling contains a non-ASCII character -- the actual homoglyph-attack shape (a genuine ASCII `admin` next to the same word with one letter swapped for a Cyrillic lookalike, U+0430 in place of "a").
- **Measured on real multilingual text.** Sixty translated documents from two public repositories (the `free-programming-books` lists in 42 languages and the `javascript-algorithms` README in 18: Arabic, Hebrew, Persian, Hindi, Tamil, Thai, Japanese, Chinese, Korean, Russian and more) produced 279 findings in 23 files before 0.1.4: 240 "mixed script" warnings on Latin terms inside Japanese, Chinese and Korean sentences, and 11 collision errors, most between ordinary Hebrew words (vav and final nun both reduce to `l`). They produce 29 now, each one a real character: 16 doubled variation selectors after a heart emoji, 8 stray zero-width spaces, soft hyphens and a misplaced ZWNJ, a no-break space, and a Russian word spelled with a Latin `c`, which is the thing this rule exists to find.
- **Two words of one non-Latin script that share a skeleton are not reported.** `confusables.txt` folds lookalikes inside a script too, so ordinary text collides with itself. Latin is the exception, since its own non-ASCII lookalikes (a dotless i, U+0131; a fullwidth letter) are how an ASCII name is imitated without leaving the script; the price was that Turkish text, where the question particle is written both with a dotted and with a dotless i, was reported (see the `node_modules` breakdown below). In the source checkout (unreleased) a file with ten or more distinct words containing a dotless i, or ten or more distinct words of one Cyrillic or Greek script, is taken to be written in that language and its words are not reported as imitating a Latin word; fewer than ten are still reported. Measured in [`studies/prompt-census`](studies/prompt-census/README.md).
- **Tokenization is regex-based, not an AST.** The confusables rule treats any `\p{L}\p{M}\p{Nd}\p{Pc}`-shaped run as an "identifier," including words inside comments, string literals, and plain prose -- it will flag `admin` written twice in a docstring next to its Cyrillic lookalike, the same as it would in real code.
- **A single character type is sometimes both a real signal and commonly legitimate at once.** NBSP is the clearest case: French typography requires it before `:`/`;`/`!`/`?`, so any French-localized string will contain plenty of "findings" that are correct detections of a real, intentional NBSP -- not an attack. This is a known, honest trade-off of not being format-aware (see the `node_modules` breakdown below); `.ghostcharsrc.json` per-glob overrides exist specifically to quiet a known-legitimate path (e.g. a translations directory) without touching the default elsewhere.
- **CJK variation sequences are accepted, not verified.** A single variation selector on a CJK ideograph is treated as an ordinary Ideographic Variation Sequence rather than checked against the real IVD registry (not vendored here), so an invalid but structurally-single selector on a CJK base won't be flagged.
- **The bidi-balance check is per-line by design** (see above); a payload that only becomes unbalanced when reasoned about across an entire multi-line paragraph, rather than within one rendered line, is out of scope.
- Every detector was checked against an independent oracle where one exists: bidi/tag/variation-selector/invisible ranges are cross-checked against literal code points from the Unicode spec text (not re-derived from the generated tables), and the confusables skeleton is verified against `confusables.txt` entries directly (see `tests/`).

## Performance

```sh
npm run bench
```

Every rule in this tool is triggered by either a code point ≥ U+0080 or a C0/DEL control character -- so `scanText()` opens with one linear regex test (`/[^\t\n\r\x20-\x7E]/`) over the whole input, and if it finds nothing, returns immediately: no code point iteration, no tokenizing, nothing. Plain ASCII, the overwhelming majority of real source, takes that path.

Measured once on Node 24.21.0, x64 WSL2 Linux, 14 logical CPUs and 48 GB RAM,
after a fresh locked install. These are current-checkout measurements, not a
before/after speedup claim. [Captured output](docs/benchmark.txt); timing varies
with machine load.

| Input | Time | Throughput | Findings |
|---|---:|---:|---:|
| 50 MiB generated ASCII source | 53.3 ms | 938.3 MiB/s | 0 |
| 50 MiB generated mixed Unicode source | 4.45 s | 11.2 MiB/s | 2,191 |
| 3,353 dependency files, 34.1 MiB | 1.49 s | 23.0 MiB/s | 189 |

Both generated inputs are synthetic. The dependency scan walks `node_modules`
directly for a throughput workload; normal CLI discovery respects `.gitignore`.
Its 189 findings break down as follows:

| Rule | Count |
|---|---:|
| `unusual-whitespace` | 162 |
| `invisible` | 9 |
| `control-character` | 8 |
| `confusable` | 5 |
| `variation-selector-stray` | 3 |
| `styled-text` | 2 |

These are detected characters and patterns, not a count of attacks. For example,
translation catalogs contain intentional no-break spaces; the
[repair study](studies/repair-policy/README.md) checks that configuration can
retain their original text during an unrelated fix.

The scanner keeps the input and a line index, plus findings, without creating an
object for every code point. The whole benchmark, including generated inputs,
peaked at 636 MiB resident memory (`/usr/bin/time -v`: 651,032 KiB). This is a
measurement of that run, not a general memory bound.

## Comparison

- **VS Code's built-in Unicode highlighting** (`editor.unicodeHighlight.*`) flags ambiguous and invisible characters live in the editor -- great for authoring, but it's not a CLI/CI tool, doesn't decode tag/variation-selector payloads, and doesn't run outside VS Code (e.g. in an LLM pipeline).
- **GitHub's web UI** shows a "this file contains bidirectional Unicode text" banner for files with bidi control characters -- useful, but bidi-only, review-time-only, and not something you can gate CI on or call as a library.

ghostchars overlaps both at the bidi layer and adds tag/variation-selector decoding, confusable-skeleton collision detection, a library API, and CI/Action/pre-commit integration.

## Tests

```sh
npm test
```

Tests cover every rule (positive and negative cases -- legitimate emoji ZWJ sequences, RGI flag tag sequences, Persian ZWNJ, CJK variation sequences, real Japanese/Korean CJK-script text, and plain-ASCII/single-script/ASCII-vs-ASCII-only identifiers all must **not** fire), plus `sanitize()`/`reveal()`, the ASCII fast path, CLI/config/file-discovery coverage, and a fuzz test of `sanitize()` on hostile strings (it never throws, its output scans clean, and it never deletes a visible character), with a check that 30,000 findings in one text are scanned and removed in well under a second.

Browser regressions exercise real workers in Chromium and Firefox: cancellation, retries, stale results, clipboard denial, source selection, oversized and dense inputs, and the example gallery at 1440px and 375px with axe accessibility checks. Each workflow also checks for uncaught errors, CSP violations, and off-origin requests.

```sh
npm --prefix web ci
npm --prefix web run build
npm --prefix web run test:browser
```

For a first-time browser test setup, run `npm --prefix web exec -- playwright install chromium firefox` (on Linux CI, add `--with-deps`).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Issues and PRs welcome.

## License

[MIT](LICENSE) for the code. Vendored Unicode data (`src/generated/`) is governed by the [Unicode License](LICENSE-UNICODE).

See [SECURITY.md](SECURITY.md) for the security policy.

---

<sub>Part of [Officina](https://antonsoo.github.io/officina/), a set of small open-source tools by [Anton Soloviev](https://github.com/antonsoo).</sub>
