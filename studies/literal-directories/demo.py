#!/usr/bin/env python3
"""Capture unedited CLI summaries and actual file comparisons for two regressions."""

import argparse
import os
import subprocess
import tempfile
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--node", default="node")
parser.add_argument("--before", type=Path, required=True)
parser.add_argument("--after", type=Path, required=True)
args = parser.parse_args()
env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
env["NO_COLOR"] = "1"
original = "const value = 1; // \u202e reversed\n".encode()

for scope, fix in [(":missing", False), ("docs*", True)]:
    for label, cli in [("BASELINE", args.before), ("INSTALLED FIX", args.after)]:
        with tempfile.TemporaryDirectory(prefix="ghostchars-scope-demo-") as temporary:
            root = Path(temporary)
            subprocess.run(["git", "init", "-q", str(root)], env=env, check=True)
            chosen = root / scope / "input.js"
            chosen.parent.mkdir()
            chosen.write_bytes(original)
            outside = root / "docs-old" / "outside.js"
            outside.parent.mkdir()
            outside.write_bytes(original)
            options = ["--fix"] if fix else []
            print(f"{label}: ghostchars '{scope}' {' '.join(options)} --format summary")
            result = subprocess.run(
                [
                    args.node,
                    str(cli.resolve()),
                    scope,
                    *options,
                    "--no-config",
                    "--format",
                    "summary",
                ],
                cwd=root,
                env=env,
                capture_output=True,
                text=True,
                check=False,
            )
            print(result.stdout, end="")
            print(result.stderr, end="")
            print(f"Exit: {result.returncode}")
            if fix:
                print(
                    f"docs-old/outside.js unchanged: {outside.read_bytes() == original}"
                )
            print()
