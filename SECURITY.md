# Security Policy

ghostchars is a static-analysis / text-filtering tool, not a network service, and has no runtime dependencies. Its main security-relevant surfaces are:

1. **False negatives** -- an attack shape this tool should catch but doesn't. Please report these; they're the most useful kind of issue for this project.
2. **The generated Unicode data** (`src/generated/`) -- pinned, hash-checked downloads from unicode.org (see `src/generated/manifest.json`). If you believe a table is stale or was generated incorrectly, that's a regular bug report.
3. **Supply chain** -- the library has zero runtime dependencies by design; the CLI bundle (`dist/cli.js`) is a single esbuild output with no dynamic `require`/`import` of user-controlled paths.

## Reporting a vulnerability

Please open a [GitHub Security Advisory](https://github.com/antonsoo/ghostchars/security/advisories/new) (private) rather than a public issue, or email the address on the maintainer's GitHub profile. Include a minimal reproduction if possible. There is no bug bounty; this is a personal open-source project, but reports are read and taken seriously.

## Scope notes

- ghostchars flags suspicious Unicode; it does not sandbox, execute, or otherwise act on the files it scans.
- `sanitize()` / `--fix` perform textual removal only (no code execution, no network access).
- The web app (`web/`) does all text processing client-side; the only network request it makes is loading its Google Fonts typeface, and the text you inspect is never sent anywhere.
