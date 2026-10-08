#!/bin/sh
# Reproduce the census end to end. Usage: sh reproduce.sh <work-dir>
# Needs: node >= 20, git, python3, uv (for pyarrow, which only reads the Hugging Face parquet files).
# Downloads about 450 MB of public text into <work-dir>/cache and never executes any of it.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)
work=${1:?work directory}
mkdir -p "$work/home"

# 1. the data, at the commits and revisions pinned in fetch.py
[ -d "$work/venv" ] || uv venv "$work/venv" -q
env -i PATH="$PATH" HOME="$work/home" uv pip install -q --python "$work/venv/bin/python" pyarrow==25.0.1
"$work/venv/bin/python" -I "$here/fetch.py" "$work/cache" "$work/manifest.json"
"$work/venv/bin/python" -I "$here/fetch.py" "$work/cache/heldout" "$work/manifest-heldout.json" heldout

# 2. the released build (tag v0.1.5) and this checkout, library only
git -C "$repo" worktree add --detach "$work/release" v0.1.5
ln -s "$repo/node_modules" "$work/release/node_modules"
"$repo/node_modules/.bin/tsc" -p "$work/release/tsconfig.build.json" --outDir "$work/released-dist"
"$repo/node_modules/.bin/tsc" -p "$repo/tsconfig.build.json" --outDir "$work/checkout-dist"

# 3. scan every document with each build, from a directory that is not the data
cd "$work"
node "$here/scan.mjs" released-dist cache manifest.json released.jsonl
node "$here/scan.mjs" checkout-dist cache manifest.json checkout.jsonl

node "$here/scan.mjs" released-dist cache/heldout manifest-heldout.json heldout-released.jsonl
node "$here/scan.mjs" checkout-dist cache/heldout manifest-heldout.json heldout-checkout.jsonl

# 4. the yardsticks and the reading
python3 -I "$here/payloads.py" cache manifest.json released.jsonl checkout.jsonl payloads.json
python3 -I "$here/independent.py" cache manifest.json released.jsonl independent-released.json
python3 -I "$here/independent.py" cache manifest.json checkout.jsonl independent-checkout.json
python3 -I "$here/classify.py" released.jsonl classified-released.json
python3 -I "$here/classify.py" checkout.jsonl classified-checkout.json
python3 -I "$here/audit.py" released.jsonl audit.json
python3 -I "$here/heldout.py" heldout-released.jsonl heldout-checkout.jsonl heldout.json
python3 -I "$here/analyze.py" manifest.json released.jsonl checkout.jsonl classified-released.json classified-checkout.json independent-released.json independent-checkout.json payloads.json audit.json results.json
