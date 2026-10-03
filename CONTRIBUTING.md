# Contributing

## Setup

```sh
npm ci
npm run build   # builds dist/index.js (library) and dist/cli.js (CLI bundle)
npm test
```

## Project layout

- `src/core/` -- the detection/decoding engine (no Node built-ins; runs in a browser too).
- `src/cli/` -- the CLI: argument parsing, file discovery, config, formatters.
- `src/generated/` -- compact Unicode data tables. Do not hand-edit; regenerate with `npm run generate:unicode` (see `scripts/generate-unicode-data.mjs`).
- `web/` -- the standalone Vite web app, published to GitHub Pages.
- `tests/` -- Vitest, one file per rule plus CLI/sanitize/reveal and browser-inspection logic coverage.
- `web/tests/` -- Playwright production browser workflows (`*.pw.ts`, kept separate from Vitest).
- `examples/` -- a gallery of deliberately-flagged fixtures used in the README, the web app, and CI's "the Action must fail on bad input" check.

## Before opening a PR

```sh
npm run typecheck
npm run lint
npm test
npm run build
git diff --exit-code -- dist/cli.js   # fails if the committed bundle is stale
```

If you change anything under `src/`, re-run `npm run build` so `dist/cli.js` stays in sync -- CI checks this and will fail the build otherwise.

If you add a rule or change what an existing rule flags, add both a positive test (it fires) and a negative test (a legitimate, similar-looking input that must *not* fire) in `tests/`.

For browser changes, also run:

```sh
npm --prefix web ci
npm --prefix web run lint
npm --prefix web run build
npm --prefix web run test:browser
```

Install the Playwright browsers once with `npm --prefix web exec -- playwright install chromium firefox`; Linux CI uses `--with-deps`. The suite starts the production preview on port 4322. It checks Chromium and Firefox, clipboard and worker failures, stale results, rendering limits, exact source selection, and accessibility at desktop and phone widths. New tests should retain the CSP/error/off-origin-request checks and use escaped Unicode in fixtures.

`npm --prefix web run build` produces the complete static site in `web/dist/`, including the worker, self-hosted fonts, and CSP. No scan input is stored in the site or uploaded. Browser rendering limits live in `web/src/limits.ts`; they must not change full-input counts or copied sanitized output.

## Regenerating Unicode data

`npm run generate:unicode` re-downloads the pinned Unicode Character Database files, verifies nothing unexpected changed shape, and rewrites `src/generated/*.ts`. Bump the version pins in `scripts/generate-unicode-data.mjs` deliberately, not as a side effect of an unrelated change.

## Commit style

Conventional commits (`feat:`, `fix:`, `docs:`, `test:`, `ci:`, `chore:`).

## Community and private reports

Please follow the [Code of Conduct](CODE_OF_CONDUCT.md). Anton Soloviev
maintains this project and handles conduct reports at
[anton@praviel.com](mailto:anton@praviel.com).

Use the bug or improvement forms for public issues. For a suspected security
vulnerability or a conduct concern, email the maintainer privately with the
repository name and relevant details. Do not post credentials, personal data,
private logs, or confidential documents in a public issue.
