# Dense bidi controls without repeated stack searches

At baseline `a9d54cf`, each POP DIRECTIONAL ISOLATE (PDI) copied and reversed
the entire open-control stack to find an isolate. A line with many unmatched
controls, or many nested isolates, repeated that work quadratically. The CLI
and browser sanitizer scan the same text again, multiplying the delay.

The correction records each open isolate's stack position. PDI takes the most
recent position and closes that isolate together with its inner embeddings.
Line resets discard both stacks. Every control, unmatched-pop diagnostic and
unterminated opening remains reported. The stack bookkeeping is linear; the
full scanner still includes finding sorting and other rules.

This is source and local-package validation. It does not establish an npm
release or a hosted deployment.

## Actual CLI behavior

[`cli-replay.mjs`](cli-replay.mjs) creates a temporary file containing `keep `,
32,000 U+202E controls, 32,000 U+2069 controls, then `this`: **192,009 UTF-8 bytes**.
This is an explicitly constructed stress input, not an observed attack or a
sample of production text. The file is within the browser's existing input
limit. Each version runs the actual CLI on the same relative filename.

The [retained CLI record](cli.json) includes complete summary stdout and output
hashes. Both versions report **128,000 findings**, with identical stdout, exit
codes and repaired bytes. Repair produces exactly `keep this`; exit 1 continues
to report the findings in the original input, as before.

| Workflow | Baseline | Corrected source |
| --- | --- | --- |
| `ghostchars case.txt --no-config --format summary` | 2.78 s | 0.28 s |
| Same command with `--fix` | 8.59 s | 0.43 s |

These are single-process observations including startup and formatting, on
14-vCPU WSL2 Linux with 48 GB RAM and Node 26.7.0. The host was not isolated.
The measurement ran after our browser/build jobs completed; timing varies with
hardware, runtime state and other work. This is not a throughput guarantee.

## Evidence preserved

[`compare.mjs`](compare.mjs) exhaustively compares all **66,430** sequences of
length zero through five over two embeddings, two isolates, PDF, PDI, LF, CR and
ordinary text. Every complete bidi finding equals baseline, including order,
positions, messages and suggestions. All **10** shipped example files also
retain identical full scans, complete sanitization results and revealed text.
The [comparison record](compatibility.json) retains source and result hashes.

This checks preservation of the existing line-scoped diagnostic policy, not
complete Unicode Bidirectional Algorithm conformance. It does not change which
Unicode controls are permitted or establish that sanitized text is safe.

[`benchmark.mjs`](benchmark.mjs) compares complete `scanText` calls on several
dense inputs, alternating the before/after order for three runs per case after
two small warmups. Finding hashes must agree on every run. [The final
matrix](performance.json) was recorded with our other verification jobs stopped.
[The earlier overlapping matrix](performance-overlap.json) is retained separately.
JSON serialization and hashing are outside the timed interval. The nested case
also exercises successful isolate matching, not only stray closers.

The built app imports the scanner through its real worker. [Chromium](browser-chromium.json)
and [Firefox](browser-firefox.json) go offline, inspect the full input, show all
128,000 findings in the total, render the existing cap of 300 rows, and copy the
complete `keep this` result. No page errors, external requests or CSP violations
were recorded. The change does not alter app rendering or its input limits.

All four screenshots were opened and inspected; totals, the repaired text and
preview-limit notice remain readable, including at 375px:

- [Chromium desktop](../../docs/assets/bidi-scaling/chromium-1440.png)
- [Chromium mobile](../../docs/assets/bidi-scaling/chromium-375.png)
- [Firefox desktop](../../docs/assets/bidi-scaling/firefox-1440.png)
- [Firefox mobile](../../docs/assets/bidi-scaling/firefox-375.png)

## Reproduce

Build a separate archive/checkout of `a9d54cf`, with `npm ci` and `npm run build`,
and use its path as `BASELINE_ROOT`. Then in the corrected checkout:

```sh
npm ci
npm run build
node studies/bidi-scaling/compare.mjs "$BASELINE_ROOT" . studies/bidi-scaling/compatibility.json
node studies/bidi-scaling/benchmark.mjs "$BASELINE_ROOT" . studies/bidi-scaling/performance.json
node studies/bidi-scaling/cli-replay.mjs "$BASELINE_ROOT/dist/cli.js" dist/cli.js studies/bidi-scaling/cli.json
npm --prefix web ci
npm run web:build
cd web
CAPTURE_BIDI_EVIDENCE=1 npx playwright test --grep 'dense unmatched bidi'
```

Keep other verification jobs stopped while measuring. The performance scripts
are reproducible observations, not fixed wall-time assertions in the unit suite.
