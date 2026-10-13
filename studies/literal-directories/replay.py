#!/usr/bin/env python3
"""Run the real CLI against disposable Git directories; retain reports and bytes."""

import argparse
import hashlib
import json
import os
import subprocess
import tempfile
from pathlib import Path

TEXT = b"const value = 1; // " + "\u202e".encode() + b" reversed\n"
FIXED = TEXT.replace("\u202e".encode(), b"")
MODES = (
    "GIT_LITERAL_PATHSPECS",
    "GIT_GLOB_PATHSPECS",
    "GIT_NOGLOB_PATHSPECS",
    "GIT_ICASE_PATHSPECS",
)
CASES = [
    ("colon", ":victim", "victim", {}),
    ("colon-unmatched", ":missing", "production", {}),
    ("colon-only", ":", "production", {}),
    ("glob-magic", ":(glob)docs*", "docs-old", {}),
    ("exclude-magic", ":(exclude)draft", "production", {}),
    ("literal-magic", ":(literal)draft", "draft", {}),
    ("wildcard", "docs*", "docs-old", {}),
    ("nested-wildcard", "packages/docs*", "packages/docs-old", {}),
    ("bracket-control", "[id]", "i", {}),
    ("question-control", "notes?", "notes1", {}),
    ("space-control", "draft notes", "draft", {}),
    ("plain-control", "source", "source-old", {}),
    ("inherited-glob", ":victim", "victim", {"GIT_GLOB_PATHSPECS": "1"}),
    ("inherited-noglob", ":victim", "victim", {"GIT_NOGLOB_PATHSPECS": "1"}),
    ("inherited-icase", "App", "app", {"GIT_ICASE_PATHSPECS": "1"}),
    (
        "inherited-conflict",
        ":victim",
        "victim",
        {"GIT_GLOB_PATHSPECS": "1", "GIT_ICASE_PATHSPECS": "1"},
    ),
    ("inherited-literal-control", ":victim", "victim", {"GIT_LITERAL_PATHSPECS": "1"}),
]


def digest(data):
    return {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--node", default="node")
    parser.add_argument("--cli", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--expect", choices=["before", "after"], required=True)
    args = parser.parse_args()
    cli = args.cli.resolve()
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
    env.update({name: "0" for name in MODES})
    env["NO_COLOR"] = "1"
    results = []
    with tempfile.TemporaryDirectory(prefix="ghostchars-literal-") as temporary:
        for name, scope, sibling, modes in CASES:
            for fix in [False, True]:
                root = Path(temporary) / f"{name}-{'fix' if fix else 'scan'}"
                root.mkdir()
                subprocess.run(["git", "init", "-q", str(root)], env=env, check=True)
                originals = {".gitignore": b"ignored.js\n"}
                originals.update(
                    {
                        f"{scope}/{file}": TEXT
                        for file in ["tracked.js", "untracked.js", "ignored.js"]
                    }
                )
                originals[f"{sibling}/outside.js"] = TEXT
                for path, data in originals.items():
                    file = root / path
                    file.parent.mkdir(parents=True, exist_ok=True)
                    file.write_bytes(data)
                subprocess.run(
                    [
                        "git",
                        "--literal-pathspecs",
                        "add",
                        "--",
                        ".gitignore",
                        f"{scope}/tracked.js",
                        f"{sibling}/outside.js",
                    ],
                    cwd=root,
                    env=env,
                    check=True,
                )
                argv = [
                    args.node,
                    str(cli),
                    "--no-config",
                    "--format",
                    "json",
                    *(["--fix"] if fix else []),
                    scope,
                ]
                run = subprocess.run(
                    argv,
                    check=False,
                    cwd=root,
                    env={**env, **modes},
                    capture_output=True,
                    text=True,
                    timeout=30,
                )
                report = json.loads(run.stdout)
                report["summary"].pop("durationMs")
                # Error paths may include the disposable directory; do not retain it.
                report = json.loads(json.dumps(report).replace(str(root), "<fixture>"))
                actual = {path: (root / path).read_bytes() for path in originals}
                selected = [f"{scope}/tracked.js", f"{scope}/untracked.js"]
                expected = {
                    path: FIXED if fix and path in selected else data
                    for path, data in originals.items()
                }
                correct = (
                    run.returncode == 1
                    and report["summary"]["complete"]
                    and report["summary"]["files"] == 2
                    and sorted(row["path"] for row in report["results"])
                    == sorted(selected)
                    and actual == expected
                )
                results.append(
                    {
                        "case": name,
                        "operation": "fix" if fix else "scan",
                        "scope": scope,
                        "pathspecEnvironment": modes,
                        "exit": run.returncode,
                        "report": report,
                        "stderr": run.stderr.replace(str(root), "<fixture>"),
                        "satisfiesLiteralScope": correct,
                        "files": [
                            {
                                "path": path,
                                "before": digest(data),
                                "after": digest(actual[path]),
                                "changed": actual[path] != data,
                            }
                            for path, data in originals.items()
                        ],
                        "outsideScopeChanges": [
                            path
                            for path, data in originals.items()
                            if path not in selected and actual[path] != data
                        ],
                    }
                )

    failed = [
        f"{r['case']}/{r['operation']}"
        for r in results
        if not r["satisfiesLiteralScope"]
    ]
    output = {
        "fixture": "Synthetic Git repositories with two eligible files in the selected directory, one ignored file and one unrelated file.",
        "node": subprocess.check_output([args.node, "--version"], text=True).strip(),
        "git": subprocess.check_output(["git", "--version"], text=True).strip(),
        "cli": digest(cli.read_bytes()),
        "cases": results,
        "summary": {
            "runs": len(results),
            "correct": len(results) - len(failed),
            "incorrect": failed,
            "falseCleanScans": sum(
                r["exit"] == 0 and r["operation"] == "scan" for r in results
            ),
            "repairsOutsideScope": sum(bool(r["outsideScopeChanges"]) for r in results),
        },
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, indent=2) + "\n")
    print(
        f"{len(results)} CLI runs: {len(results) - len(failed)} respect the literal directory; {len(failed)} do not."
    )
    print(
        f"False-clean scans: {output['summary']['falseCleanScans']}; repairs outside scope: {output['summary']['repairsOutsideScope']}."
    )
    if args.expect == "after":
        assert not failed, failed
    else:
        assert {"colon/scan", "wildcard/fix", "exclude-magic/fix"}.issubset(failed), (
            failed
        )


if __name__ == "__main__":
    main()
