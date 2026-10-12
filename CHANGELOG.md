# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

### Added

- (source checkout) `styled-text` rule: letters in the mathematical, fullwidth, circled, squared and small-capital alphabets are reported with the plain text they read as (`decoded`, NFKC). A whole jailbreak written in circled letters, with no plain spelling beside it, was not reported at all before. Fullwidth letters and digits inside CJK text, runs of fewer than three letters and digit-only runs are not reported.
- (source checkout) Variation-selector payloads that are written in selectors again are decoded to the end ("search pliny ..." sat four layers down in one file, and the first layer decoded to more invisible characters). The finding says how many layers.
- (source checkout) A single VS15/VS16 after each word of a paragraph is read as one bit apiece (VS16 = 1, either way round); when the bits are at least 8 bytes of clean UTF-8 text they are reported as `variation-selector-smuggling` errors and the first carries the message. A jailbreak collection hides a sentence this way under 240 selectors that were each only a stray-selector warning.
- (source checkout) `--format summary`: one line per file and kind of finding with a count and the first and last position, and what a payload decoded to. One scraped page had 1,021 no-break spaces.
- `studies/prompt-census`: a census of 83,494 public prompts and agent-instruction files, with the scripts, the manifest and the hand classification of every finding.

### Fixed

- (source checkout) Default CLI diagnostics no longer rescan and repeat an entire
  source line for every finding. Show bounded source excerpts with the reported
  span bracketed, preserve every original location and full count, and label
  shortened diagnostics. Avoid huge caret padding and alignment errors after
  escaped controls or wide characters. JSON, SARIF, GitHub annotations, summary
  reports and repairs remain unchanged. Retain actual public-input measurements
  and installed-artifact checks in `studies/pretty-preview/`; no npm release.
- CLI repairs stage and flush every replacement before renaming it over its
  original. A partial write failure no longer truncates source files; failed
  staging cancels the whole batch. POSIX ownership and permission bits are
  retained. Hard links and noticed edits are refused. Replacements require a
  writable parent and do not copy extended metadata or provide a transaction
  across files. Actual kernel-limit and process-interruption replays are in
  `studies/atomic-repair`.
- Registered Unicode 17 standardized variation sequences now survive scans and
  repairs, including mathematical symbols, punctuation and script variants.
  Exact base/selector pairs come from pinned `StandardizedVariants.txt`; other
  selectors and encoded payloads remain reported. A recognized first variant
  survives removal of extra non-payload selectors. Existing CJK IVS and emoji
  policies remain separate. The Unicode generator now enforces the source
  hashes it previously only recorded and reports actual UTF-8 byte counts.
- Bundled Inter and Space Grotesk variable fonts use one face per file/range
  across the existing weights. Changing offline report states no longer makes
  Firefox fetch a second face backed by the same file.
- Canonical accents no longer hide cross-script identifier collisions. Comparison
  keys use NFD before and after confusable mapping; canonically equivalent-only
  prose spellings remain quiet. Original source ranges and text are preserved,
  including CR-only line locations. Independent ICU vectors, an executable
  JavaScript counterexample and a hash-checked public-text replay are retained
  in `studies/canonical-confusables`.
- Bidi isolate matching no longer copies and reverses the whole control stack
  for each PDI. Dense or deeply nested controls retain every finding while
  avoiding quadratic stack work in scans, repairs and the browser worker.
  Before/after CLI and compatibility evidence: `studies/bidi-scaling`.
- Unreadable files and directories, failed Git enumeration, missing requested
  paths and invalid encodings now produce an incomplete scan with exit 2.
  They remain visible in JSON, SARIF, GitHub annotations and human reports.
  Binary and size exclusions retain their separate skipped-file records.
- Repository scans do not follow symbolic links, including tracked directory
  paths replaced by links. Explicit link inputs are refused with instructions
  to choose the real path. This prevents `--fix .` from repairing outside link
  targets. Discovery/read failures block all planned repairs; detected edits
  since the scan are not overwritten.
- SARIF uses the maintained OASIS schema URL, reports execution failures in
  invocation notifications, and encodes filenames as URI paths.
- Configured repairs use the scan's allowlist, disabled rules and per-file overrides on every sanitizer pass. Previously an unrelated fix triggered default-policy removal of characters the user had explicitly retained. Allowlisted scalars are also protected inside compound findings.
- `--fix --dry-run` renders the proposed text instead of replaying overlapping or shifted diagnostic spans. Bidi overlap, retained variation-selector carriers and later sanitizer passes now preview the same output that is written.
- A dry run with unfixable or protected findings and no permitted removal shows those findings for review instead of a green "nothing to fix" message.
- Missing explicit configuration and malformed policy entries fail before repair. Invalid UTF-8 or BOM-marked UTF-16 returns exit 2 without rewriting the file; decoding no longer silently inserts replacement characters.
- Human CLI diagnostics escape controls in filenames and retained source text. GitHub annotation filenames escape property delimiters and newlines. Summary and dry-run output include skipped-file reasons, and write errors return exit 2.
- (source checkout) The `n` of a backslash-n escape in a string literal was read as the first letter of the word after it, so every `\n` before a Greek or Cyrillic word was a "mixes scripts" warning (124 in one set of translated prompts).
- (source checkout) A ZWNJ between a Latin term and a Persian suffix (`token` + ZWNJ + plural) is orthography, not an `invisible` warning. A ZWNJ with ASCII on both sides, and a ZWJ in that place, are still reported.
- Revealed text now shows invisible characters inside confusable identifiers instead of letting the identifier highlight hide them. Overlapping findings at the same offset use the complete span, so variation-selector tails cannot remain invisible.
- Decoded payload controls are escaped in `reveal()` and browser diagnostics; decoding a hidden bidi override no longer reactivates it in the diagnostic.
- Sanitized text is visible before copying, with remaining lookalike findings and manual-copy fallback when clipboard access fails. A delayed clipboard result cannot announce success for newly edited text.

### Changed

- (source checkout) A word set in a styled alphabet beside its plain spelling is reported by `styled-text` instead of as a `confusable` collision error. The collision rule still reports a Latin, Cyrillic or Greek copy.
- (source checkout) A Cyrillic or Greek word that shares a skeleton with a Latin word, and a Turkic word with a dotless i that shares one with its dotted twin, are not reported when the file is written in that script or language: ten distinct words of the script, or ten with a dotless i. Below that they are reported as before.
- (source checkout) The `unusual-whitespace` message for a no-break space and the line and paragraph separators says they are usually left by pasting from a web page or chat window.
- (source checkout) `reveal()` and the browser page leave styled text as readable text, and the page lists `styled-text` findings with the lookalikes.
- Browser scanning runs in a cancellable worker with retry, immediate stale-result clearing, and a 100,000 UTF-16 code-unit input limit. Evidence previews and finding lists are bounded; totals and sanitized output still cover the full accepted input.
- Finding location buttons select the corresponding source range. The page includes a clear-text action, keyboard-accessible evidence panes, and locally hosted fonts described accurately in the privacy note.

### Tests

- `studies/repair-policy` exercises the built CLI with independent expected bytes: 26 controlled cases and a targeted repair in all 13 TypeScript 5.9.3 translation catalogs. It records the old and new output hashes, previews, and exit codes.
- Added `tests/promptCensus.spec.ts`: layered and one-bit-per-word payloads, the backslash-n escape, Turkish, Russian and Greek text, the Persian ZWNJ, `styled-text` (circled letters, small capitals, a styled persona name beside its plain spelling, fullwidth text in Japanese) and `--format summary`. Every case is a shape found in the census.
- Added regressions for overlapping findings, inert decoded controls, source offsets, complete sanitized output, and preview boundaries. Production browser workflows run in Chromium and Firefox, including desktop and phone accessibility audits, clipboard failures, and cancelled or failed workers.

## [0.1.5] - 2026-10-02

### Added

- Published to npm as `@antonsoloviev/ghostchars`: `npx @antonsoloviev/ghostchars .`
  for the CLI, `npm install @antonsoloviev/ghostchars` for the library. The
  README uses the registry package instead of the GitHub install, which npm 12
  blocks by default.

### Fixed

- The web page's "code units scanned" count no longer follows the browser's
  locale.
- UTF-16 files were not scanned. A file saved as UTF-16 with a byte-order mark
  (a PowerShell script from the ISE, a `.reg` file, anything redirected with
  `>` in Windows PowerShell) is half zero bytes, so it was listed as "skipped
  (binary)" and the run exited 0: a bidi override in such a file passed the
  check. The mark now decides the encoding and the text is scanned like any
  other; a UTF-16 copy of `examples/trojan-source.c` gives the findings of the
  original, at the same lines and columns. `--fix` writes the file back in the
  encoding it came in, and `reveal` reads it too. Files that only start like
  UTF-16 (control bytes after the mark, UTF-32) are still skipped as binary.

### Changed

- The page's fonts are served by the page itself. They came from Google Fonts,
  the one request the page made to another origin; the same font files (every
  subset, as Google serves them to a current browser) are now in
  `web/src/fonts/`, with their SIL Open Font License texts. Nothing looks
  different: screenshots before and after match. The page now loads with
  every other host blocked.

### Security

- The built page carries a Content-Security-Policy. Scripts, styles, fonts and
  workers load from the page's own origin only, and `connect-src 'self'` has
  the browser refuse to send what you give the page to any other host, even
  for a script injected through a bug in how the page renders a file. Inline
  event handlers and `eval` are not allowed. Every control was exercised
  in Chromium and Firefox with a listener for policy violations: none.

### Accessibility

- Checked with axe-core (WCAG 2.1 A and AA, and its best-practice rules) in light and dark,
  at desktop and phone widths, with an example loaded: no findings
  now. The faint text was 3.3:1 to 3.7:1; the page has a `main` landmark.

## [0.1.4] - 2026-10-02

Run on real multilingual text for the first time: sixty translated documents
from two public repositories, in 45 languages. They produced 279 findings in
23 files, nearly all on ordinary words; they produce 29 now, every one a real
character.

### Fixed

- **A long report was cut off at 64 KB when piped.** The CLI called
  `process.exit()` with its output still on the way: redirected to a file a
  3,000-finding report was 2.26 MB, and through a pipe exactly 65,536 bytes,
  in every format. A CI log, `--format sarif | ...` and `--format json | jq`
  lost everything past that point, and the JSON was not valid. The exit code
  is now set and the process ends when the output has drained.
- **A path that does not exist passed the check.** `ghostchars scr` printed
  "no findings in 0 file(s)" and exited 0. A path named on the command line
  that is not there is now an error, exit 2.
- **Latin inside Japanese, Chinese or Korean was a "homoglyph-attack shape".**
  These languages have no spaces, so `JavaScript` followed by the katakana
  for "algorithm" is one word, and every such word was a mixed-script
  warning: 99 in one Japanese document. The rule now follows UTS #39's
  restriction levels: Latin with Han, Hiragana and Katakana, with Han and
  Bopomofo, or with Han and Hangul is ordinary, and so is Latin with one other
  script in general use except Cyrillic and Greek (an Arabic or Hebrew prefix
  on a Latin term).
- **A Greek letter used as a symbol was a mixed-script warning**: `LaTeX2ε`,
  `Δt`, `10μs`, `πr`. A word outside the allowed mixes is reported when it
  holds an actual lookalike: a character that `confusables.txt` reduces to
  ASCII letters (Cyrillic `а`, Greek omicron), or an ASCII letter planted in
  a word of a script that has a double for it. The words of a `snake_case`
  name or a URL slug are judged one by one.
- **Ordinary Hebrew words were errors.** `confusables.txt` reduces vav and
  final nun to the same letter, so two common words "shared a skeleton".
  A collision between two words of one non-Latin script is no longer
  reported; a cross-script one is, and it found a real one in the corpus (a
  Russian word spelled with a Latin `c`).
- **A doubled emoji selector was described wrongly, and `--fix` changed the
  emoji.** A heart followed by VS16 twice was reported as a selector with "no
  registered variation sequence", and fixing it removed both, turning the red
  heart into its text form. The first selector is the registered emoji
  presentation and stays; the finding names the extra one.
- The ideographic space (U+3000) next to Chinese, Japanese or Korean text is
  ordinary typography and is not reported.

## [0.1.3] - 2026-10-01

### Fixed

- Memory. Scanning a file with any non-ASCII character in it built an object
  for every code point of the file, well over a hundred bytes per character:
  the benchmark needed 2.7 GB at 20 MiB, and `npm run bench` ran out of heap
  at its own default of 50 MiB. Each rule now looks for its own characters and
  keeps a record only of what it reports, so memory follows the findings. The
  50 MiB mixed benchmark finishes in about 3 s, and the scan of this repo's
  `node_modules` went from 2.3 s to 0.7 s. Findings are identical: checked on
  30,000 generated hostile strings and 3,411 real files (254,669 findings),
  and on 40,000 generated identifier texts for the confusables rule (81,023).
- Many findings in one text made the scan quadratic. The tag and
  variation-selector rules rescanned the text from its start for the line and
  column of each finding, and `sanitize()` copied the rest of the text for
  each removal: 30,000 stray selectors in 60 KB took 2.7 s to scan and 3.6 s
  to sanitize, now about 50 ms each.

### Changed

- The README's benchmark figures are measured again, at the benchmark's
  default size.

## [0.1.2] - 2026-10-01

### Added

- The package is named `@antonsoloviev/ghostchars`, ready for npm (published
  there from 0.1.5). The unscoped `ghostchars` name belongs to an unrelated
  project.

### Fixed

- `sanitize()` and `ghostchars --fix` deleted the visible character before a
  stray or smuggling variation selector: `ok` + U+FE00 + `!` became `o!`, and an
  emoji carrying a smuggled payload was removed along with it. A
  variation-selector finding is located at its base character; the fix now
  removes only the selectors (`Finding.removal`).
- One `sanitize()` pass could leave characters a second scan would flag, because
  removing a character changes what its neighbor is (a zero-width joiner that
  was legitimate next to an Arabic letter mark isn't, once the mark is gone).
  It now rescans until the text is clean, so the output always passes its own
  scanner and sanitizing twice changes nothing.

## [0.1.1] - 2026-09-30

### Fixed

- Installing from GitHub (`npm install github:antonsoo/ghostchars`) gave a
  package with only the bundled CLI, so the documented library import failed;
  a `prepare` script now builds `dist/` on install. The README says how to
  install from GitHub and that the `ghostchars` package on npm is a different
  project.
- `invisible` no longer flags a ZWJ/ZWNJ right after an Indic virama at the
  end of a word (legacy Malayalam chillus are NA + VIRAMA + ZWJ).
- `unusual-whitespace` no longer flags the no-break space French typography
  puts before `; : ! ?` and inside `« »`.
- The braille pattern blank (U+2800) went unreported. It renders as an empty
  space but isn't whitespace, so `trim()` and word splitting keep it; it is
  now an `unusual-whitespace` warning, except between braille patterns, where
  it is braille's word space.

## [0.1.0] - 2026-09-24

Initial release.

### Added

- Core detection library (`scanText`, `sanitize`, `reveal`, `decodeTags`, `decodeVariationSelectors`) covering bidi controls/marks/unbalanced embeddings, Unicode tag-character smuggling, variation-selector smuggling, invisible/default-ignorable characters, script-mixing and skeleton-collision confusables, and unusual whitespace/control characters.
- `ghostchars` CLI: `scan` (default) and `reveal` commands, `pretty`/`json`/`sarif`/`github` output formats, `--fix`/`--dry-run`, and `.ghostcharsrc.json` per-glob configuration.
- GitHub Action (`action.yml`, composite) plus example workflows for inline annotations and SARIF/code-scanning upload.
- `.pre-commit-hooks.yaml` for the [pre-commit](https://pre-commit.com) framework.
- Web app ("the UV lamp"): a local-only, client-side Unicode inspector with an example gallery.
- Unicode data pinned to UCD 17.0.0 (confusables.txt / emoji sequences pinned to their own latest tracks, 16.0.0 / Emoji 16.0), generated by `scripts/generate-unicode-data.mjs` into `src/generated/`.
