#!/usr/bin/env python3
"""Capture the actual Action result when its output names the source file."""

import argparse
import os
import shutil
import subprocess
import tempfile
import textwrap
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--node", default="node")
parser.add_argument("--before-cli", type=Path, required=True)
parser.add_argument("--before-action", type=Path, required=True)
parser.add_argument("--after-cli", type=Path, required=True)
parser.add_argument("--after-action", type=Path, required=True)
args = parser.parse_args()
node = Path(shutil.which(args.node) or args.node).resolve()
original = "const value = 1; // \u202e reversed\n".encode()

for label, cli, action in [
    ("BASELINE", args.before_cli, args.before_action),
    ("INSTALLED FIX", args.after_cli, args.after_action),
]:
    with tempfile.TemporaryDirectory(prefix="ghostchars-action-demo-") as temporary:
        root = Path(temporary)
        runner = root / "action"
        (runner / "dist").mkdir(parents=True)
        (runner / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(cli, runner / "dist/cli.js")
        (root / "bin").mkdir()
        (root / "bin/node").symlink_to(node)
        source = root / "source.js"
        source.write_bytes(original)
        script = textwrap.dedent(action.read_text().split("      run: |\n", 1)[1])
        env = {
            **os.environ,
            "PATH": str(root / "bin") + os.pathsep + os.environ["PATH"],
            "NO_COLOR": "1",
            "GC_ACTION_PATH": str(runner),
            "GC_PATHS": "source.js",
            "GC_OUTPUT": "source.js",
            "GC_FORMAT": "json",
            "GC_CONFIG": "",
        }
        result = subprocess.run(
            ["bash", "-c", script],
            cwd=root,
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )
        print(f"{label} Action: paths=source.js format=json output=source.js")
        print(result.stdout, end="")
        print(result.stderr, end="")
        current = source.read_bytes()
        print(f"Exit: {result.returncode}")
        print(
            f"Source: {len(original)} -> {len(current)} bytes; original preserved: {current == original}"
        )
        if current != original:
            print("Report now occupying source.js:")
            print(current.decode(), end="")
        print()
