# CLI repair write-failure verification

The source fix is `412098faef57cfae42e1e4b3a0d813534d7ba506`; the reproduced
baseline is `94580b4718596f9c464883813ad2e79664af64d7`. Package metadata remains
0.1.5. No package release, tag or hosted deployment is part of this work.

The practical failure is source truncation, even though the CLI reports exit 2.
With `RLIMIT_FSIZE=1024`, the baseline leaves only 1,024 bytes of a 9,622-byte
UTF-8 file. The installed fixed CLI retains all original bytes. The
[study](../studies/atomic-repair/README.md) gives the exact fixtures, before/after
table, replacement protocol and boundaries.

## Clean source and installed artifact

A fresh `git archive` of the fix was extracted into an empty directory.
Node 24.21.0 / npm 12.0.1 performed the locked installs and builds. Node 20.0.0
is the exact floor of the declared `>=20` runtime range.

| Check | Result | Retained output |
| --- | --- | --- |
| `npm ci` | Clean locked install | [Install](../studies/atomic-repair/results/clean-install.txt) |
| `npm run typecheck` / `npm run lint` | Passed | [Types](../studies/atomic-repair/results/clean-typecheck.txt), [lint](../studies/atomic-repair/results/clean-lint.txt) |
| `npm test` | 245 tests in 20 files passed | [Tests](../studies/atomic-repair/results/clean-tests.txt) |
| `LC_ALL=de_DE.UTF-8 LANG=de_DE.UTF-8 npm test` | Same 245 tests passed | [Locale](../studies/atomic-repair/results/clean-locale-tests.txt) |
| `npm run build` | Passed; rebuilt CLI equals committed bundle | [Build](../studies/atomic-repair/results/clean-build.txt) |
| CI self-scan command | No findings in 53 source/config/documentation files | [Scan](../studies/atomic-repair/results/clean-self-scan.txt) |
| `node scripts/benchmark.mjs 2` | Scanner benchmark smoke completed | [Output](../studies/atomic-repair/results/clean-benchmark.txt) |
| `npm pack`, isolated `npm install --ignore-scripts` | Package installs without a build step | [Install](../studies/atomic-repair/results/installed.txt) |
| Installed CLI on Node 20.0.0 / 24.21.0 | All 12 study cases passed on each runtime | [Node 20](../studies/atomic-repair/results/installed-node20.json), [Node 24](../studies/atomic-repair/results/installed-node24.json) |
| Installed command and library | Bin reports 0.1.5; `scanText` finds U+200B and `sanitize` removes it | Verified against isolated package |

The 12 cases include four successful encoding/BOM repairs, three kernel-limited
encoding failures, failure on a later file, a read-only original, a read-only
parent, a hard-link alias, and SIGKILL after a partial write. Successful files
retain mode 0751 and owner/group. Kernel-limit failures clean their staging files;
SIGKILL leaves one private partial temporary file and an intact original.

The [artifact manifest](../studies/atomic-repair/results/artifacts.json) compares
114 source/build inputs and all 57 installed package files with the clean tree.
Committed, rebuilt and installed CLI bytes share SHA-256
`69943f2809d8d643b5296cd8f0c69ca7f4406ba4d2f9277f4c9b7d0ae4365f4e`.
The packed artifact is 165,138 bytes; its hash is recorded in the same manifest.

## Existing browser workflows

The CLI change leaves browser source untouched. The clean archive nevertheless
passes the existing web checks: locked install, TypeScript, ESLint, production
build and **36 Chromium/Firefox workflows without retries**. These cover offline
editing, clipboard behavior, dense controls and accessibility at 1440px/375px.
See the retained [build](../studies/atomic-repair/results/web-build.txt) and
[browser output](../studies/atomic-repair/results/web-browser.txt).

All six generated browser screenshots were inspected and byte-match the existing
captures. The new [terminal image](assets/atomic-repair/installed-node20.png)
renders unedited output from the installed Node 20 replay; it was also inspected.
These checks concern a local production build, not the hosted demo.

## Cost and limits

Five alternating fresh 200-file batches per version, on the tested WSL2
filesystem (14 logical CPUs, approximately 47 GiB RAM) with Node 24.21.0,
took median 830.7 ms before and 3,065.5 ms after.
Timing includes startup, scan, repair and JSON output. The correctness check
compares every output byte after each batch. The cost of extra staging and
flushing is explicit in the [raw timing record](../studies/atomic-repair/results/installed-performance.json).

This verifies Linux kernel write limits and injected interruption/failure points.
It does not verify a physical full disk, power-loss durability, Windows/macOS,
network-filesystem failure semantics, or atomicity across multiple renames.
Replacements require writable parents and do not copy extended attributes,
ACLs or alternate data streams. The README documents those behavior changes.
