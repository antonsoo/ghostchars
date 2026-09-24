# Contributing

## Setup

```sh
npm install
npm run build   # builds dist/index.js (library) and dist/cli.js (CLI bundle)
npm test
```

## Project layout

- `src/core/` -- the detection/decoding engine (no Node built-ins; runs in a browser too).
- `src/cli/` -- the CLI: argument parsing, file discovery, config, formatters.
- `src/generated/` -- compact Unicode data tables. Do not hand-edit; regenerate with `npm run generate:unicode` (see `scripts/generate-unicode-data.mjs`).
- `web/` -- the standalone Vite web app, published to GitHub Pages.
- `tests/` -- Vitest, one file per rule plus CLI/sanitize/reveal coverage.
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

## Regenerating Unicode data

`npm run generate:unicode` re-downloads the pinned Unicode Character Database files, verifies nothing unexpected changed shape, and rewrites `src/generated/*.ts`. Bump the version pins in `scripts/generate-unicode-data.mjs` deliberately, not as a side effect of an unrelated change.

## Commit style

Conventional commits (`feat:`, `fix:`, `docs:`, `test:`, `ci:`, `chore:`).
