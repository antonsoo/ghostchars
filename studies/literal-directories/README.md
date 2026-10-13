# Keep scans and repairs inside the selected directory

Ghostchars resolves each directory argument as an existing filesystem path,
then uses Git to list its tracked and eligible untracked files. Baseline
`2513948d5bb3e2cb83391d200e7eff838cd7485c` passes that resolved name as a
Git pathspec. Quoting the command-line argument protects it from the shell,
but does not stop Git from interpreting it again.

| Selected directory | Baseline behavior | Corrected behavior |
| --- | --- | --- |
| `:missing` with no `missing` sibling | Zero files, complete, exit 0 despite two files with bidi controls | Both selected files scanned; exit 1 |
| `:victim` with a `victim` sibling | Scans and repairs the sibling instead | Scans and repairs only `:victim` |
| `:(glob)docs*` | Zero files, complete, exit 0 | Both selected files scanned; exit 1 |
| `:(exclude)draft` | Includes unrelated production files | Only the named directory |
| `docs*` beside `docs-old` | Repairs files in both directories | Leaves `docs-old` byte-identical |
| `App` with inherited `GIT_ICASE_PATHSPECS=1` | Also repairs a file in `app` on this case-sensitive filesystem | Only `App` |

The fix uses Git's
[`--literal-pathspecs`](https://git-scm.com/docs/git#Documentation/git.txt---literal-pathspecs)
mode and clears conflicting inherited pathspec modes for that one child
process. Repository and ignore settings remain in effect. There is no change
to Unicode rules, repair bytes, config override patterns or the browser engine.

## Actual CLI replay

[`replay.py`](replay.py) creates 17 disposable synthetic Git repositories,
each once for a scan and once for `--fix`. The selected directory contains
one tracked and one untracked file with a U+202E control, plus an ignored file.
An unrelated sibling contains the same control. Every file has an independently
specified expected byte string after the operation; the replay records complete
JSON findings and before/after hashes, including ignored and unrelated files.
Elapsed report times and disposable absolute directory names are normalized.

| Result | Baseline | Corrected CLI |
| --- | ---: | ---: |
| Runs respecting the selected directory | 10 / 34 | 34 / 34 |
| False-clean scans | 2 | 0 |
| Repair runs changing files outside the selection | 10 | 0 |

Controls cover ordinary names, spaces, bracket/question-mark names and inherited
literal mode. Additional cases exercise a lone colon, nested wildcard names,
literal/exclude/glob pathspec spellings and inherited glob/case modes. These are
constructed filesystem regressions, not a prevalence estimate or public corpus.
The retained results use Git 2.43.0 on case-sensitive WSL2 Linux; reserved filename
spellings and the `App`/`app` pair are not portable to every filesystem.

Retained results: [baseline](results/before.json), [corrected development
bundle](results/after.json). The installed-artifact and clean-check receipt is
added after verification. No npm release, tag or hosted deployment is part of
this source correction; package metadata remains 0.1.5.

```sh
git show 2513948d5bb3e2cb83391d200e7eff838cd7485c:dist/cli.js > /tmp/ghostchars-before.mjs
python3 studies/literal-directories/replay.py --cli /tmp/ghostchars-before.mjs --expect before --output /tmp/before.json
npm ci && npm run build
python3 studies/literal-directories/replay.py --cli dist/cli.js --expect after --output /tmp/after.json
```

The CLI still receives already-expanded shell arguments. Quote literal names
containing wildcard characters, spaces or shell syntax. The GitHub Action's
`paths` input still uses its documented space-separated shell expansion.
Symlinks, oversized/binary inputs, ignore rules and repair-write constraints
retain their existing behavior. Literal Git enumeration is not a sandbox
against concurrent filesystem changes or a replacement for those checks.
