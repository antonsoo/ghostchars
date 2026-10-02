# Changelog

All notable changes to this project are documented in this file.

## [0.1.5] - 2026-10-02

### Fixed

- UTF-16 files were not scanned. A file saved as UTF-16 with a byte-order mark
  (a PowerShell script from the ISE, a `.reg` file, anything redirected with
  `>` in Windows PowerShell) is half zero bytes, so it was listed as "skipped
  (binary)" and the run exited 0: a bidi override in such a file passed the
  check. The mark now decides the encoding and the text is scanned like any
  other; a UTF-16 copy of `examples/trojan-source.c` gives the findings of the
  original, at the same lines and columns. `--fix` writes the file back in the
  encoding it came in, and `reveal` reads it too. Files that only start like
  UTF-16 (control bytes after the mark, UTF-32) are still skipped as binary.

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

- The package is named `@antonsoloviev/ghostchars`, ready for npm (the unscoped
  `ghostchars` name belongs to an unrelated project). It isn't published yet;
  until it is, install from GitHub as before.

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
