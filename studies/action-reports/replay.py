#!/usr/bin/env python3
"""Execute the actual composite Action Bash body on disposable Linux files."""

import argparse
import hashlib
import json
import os
import re
import resource
import shutil
import signal
import subprocess
import tempfile
import textwrap
from pathlib import Path

SOURCE = b"const value = 1; // " + "\u202e".encode() + b" reversed\n"
OLD_REPORT = b"previous complete report\n" * 512
PROTECTED = [
    "source",
    "relative-source",
    "directory-source",
    "hardlink-source",
    "symlink-source",
    "parent-symlink-source",
    "binary-source",
    "invalid-utf8-source",
    "large-source",
    "explicit-config",
    "implicit-config",
    "hardlink-config",
    "invalid-config",
    "existing-scanned-report",
    "limited-existing",
    "limited-new",
]
CONTROLS = [
    "json",
    "new-json",
    "long-name",
    "sarif",
    "github",
    "pretty",
    "summary",
    "no-output",
    "incomplete",
    "ignored-report",
]


def digest(data):
    return {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def limited_file_size():
    signal.signal(signal.SIGXFSZ, signal.SIG_IGN)
    resource.setrlimit(resource.RLIMIT_FSIZE, (2048, 2048))


def normalized(text, root):
    text = text.replace(str(root), "<fixture>")
    try:
        report = json.loads(text)
        if isinstance(report, dict) and report.get("ghostchars"):
            report["summary"].pop("durationMs", None)
        return report
    except json.JSONDecodeError:
        return re.sub(
            r"\(\d+(?:\.\d+)?(?:ms|s)\)\.$", "(<duration>).", text, flags=re.MULTILINE
        )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--node", default="node")
    parser.add_argument("--cli", type=Path, required=True)
    parser.add_argument("--action", type=Path, required=True)
    parser.add_argument("--expect", choices=["before", "after"], required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    node = Path(shutil.which(args.node) or args.node).resolve()
    cli = args.cli.resolve()
    action = args.action.read_text()
    script = textwrap.dedent(action.split("      run: |\n", 1)[1])
    rows = []
    with tempfile.TemporaryDirectory(prefix="ghostchars-action-replay-") as temporary:
        scratch = Path(temporary)
        runner = scratch / "action"
        (runner / "dist").mkdir(parents=True)
        (runner / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(cli, runner / "dist/cli.js")
        (scratch / "bin").mkdir()
        (scratch / "bin/node").symlink_to(node)
        common_env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
        common_env.update(
            {
                "PATH": str(scratch / "bin") + os.pathsep + os.environ["PATH"],
                "NO_COLOR": "1",
            }
        )
        common_env.pop("FORCE_COLOR", None)

        for name in PROTECTED + CONTROLS:
            root = scratch / name
            root.mkdir()
            source = root / "source.js"
            source.write_bytes(SOURCE)
            config = root / "config.json"
            config.write_bytes(b"{}")
            output = root / "report.json"
            output.write_bytes(OLD_REPORT)
            paths = "source.js"
            config_arg = "config.json"
            output_arg = "report.json"
            format_arg = (
                name if name in {"sarif", "github", "pretty", "summary"} else "json"
            )
            if name in {
                "source",
                "relative-source",
                "directory-source",
                "binary-source",
                "invalid-utf8-source",
                "large-source",
            }:
                output.unlink()
                if name == "directory-source":
                    (root / "src").mkdir()
                    source.rename(root / "src/source.js")
                    source = root / "src/source.js"
                    paths = "src"
                elif name == "binary-source":
                    source.write_bytes(b"\x00binary\x00")
                elif name == "invalid-utf8-source":
                    source.write_bytes(b"\xffinvalid UTF-8")
                elif name == "large-source":
                    source.write_bytes(SOURCE + b" " * (6 * 1024 * 1024))
                output = source
                output_arg = (
                    "./source.js"
                    if name == "relative-source"
                    else str(source.relative_to(root))
                )
            elif name in {"hardlink-source", "symlink-source", "hardlink-config"}:
                output.unlink()
                target = config if name == "hardlink-config" else source
                if name == "symlink-source":
                    output.symlink_to(target.name)
                else:
                    os.link(target, output)
            elif name == "parent-symlink-source":
                output.unlink()
                (root / "alias").symlink_to(".", target_is_directory=True)
                output_arg = "alias/source.js"
                output = root / output_arg
            elif name in {"explicit-config", "implicit-config"}:
                output.unlink()
                if name == "implicit-config":
                    config.rename(root / ".ghostcharsrc.json")
                    config = root / ".ghostcharsrc.json"
                    config_arg = ""
                output = config
                output_arg = config.name
            elif name == "invalid-config":
                config.write_bytes(b"{broken configuration")
            elif name in {"existing-scanned-report", "ignored-report"}:
                paths = "."
                if name == "ignored-report":
                    (root / ".gitignore").write_text("report.json\n")
                    subprocess.run(
                        ["git", "init", "-q", str(root)], env=common_env, check=True
                    )
            elif name in {"limited-existing", "limited-new"}:
                source.write_bytes(SOURCE * 1024)
                if name == "limited-new":
                    output.unlink()
            elif name == "new-json":
                output.unlink()
            elif name == "long-name":
                output.unlink()
                output_arg = "r" * 250 + ".json"
                output = root / output_arg
            elif name == "no-output":
                output_arg = ""
            elif name == "incomplete":
                paths = "source.js missing.js"

            files = [
                p
                for p in root.rglob("*")
                if p.is_file() and ".git" not in p.relative_to(root).parts
            ]
            original = {str(p.relative_to(root)): p.read_bytes() for p in files}
            output_before = output.read_bytes() if output.exists() else None
            env = {
                **common_env,
                "GC_PATHS": paths,
                "GC_FORMAT": format_arg,
                "GC_OUTPUT": output_arg,
                "GC_CONFIG": config_arg,
                "GC_ACTION_PATH": str(runner),
            }
            expected_report = None
            if name in CONTROLS:
                direct = subprocess.run(
                    [
                        str(node),
                        str(cli),
                        *paths.split(),
                        "--format",
                        format_arg,
                        "--config",
                        str(config),
                    ],
                    cwd=root,
                    env=common_env,
                    capture_output=True,
                    text=True,
                    check=False,
                    timeout=30,
                )
                assert direct.returncode == (2 if name == "incomplete" else 1)
                expected_report = normalized(direct.stdout, root)
            run = subprocess.run(
                ["bash", "-c", script],
                cwd=root,
                env=env,
                capture_output=True,
                text=True,
                check=False,
                timeout=30,
                preexec_fn=limited_file_size if name.startswith("limited-") else None,
            )
            output_after = output.read_bytes() if output.exists() else None
            current = {path: (root / path).read_bytes() for path in original}
            leftovers = sorted(
                str(p.relative_to(root)) for p in root.rglob(".ghostchars-report-*.tmp")
            )
            source_intact = (
                source.read_bytes() == original[str(source.relative_to(root))]
            )
            config_intact = (
                config.read_bytes() == original[str(config.relative_to(root))]
            )
            if name in PROTECTED:
                correct = (
                    run.returncode == 2
                    and current == original
                    and output_after == output_before
                    and not leftovers
                )
            else:
                delivered = (
                    run.stdout
                    if name == "no-output"
                    else (output_after or b"").decode()
                )
                correct = (
                    run.returncode == (2 if name == "incomplete" else 1)
                    and source_intact
                    and config_intact
                    and not leftovers
                    and normalized(delivered, root) == expected_report
                    and (name == "no-output" or run.stdout == "")
                )
            report = normalized((output_after or b"").decode(errors="replace"), root)
            # Large retained inputs/reports are represented by hashes. Small
            # actual JSON reports retain all findings; text previews are bounded.
            if not isinstance(report, dict):
                report = report[:300]
            elif len(json.dumps(report)) > 10_000:
                report = {"summary": report.get("summary"), "largeReportOmitted": True}
            rows.append(
                {
                    "case": name,
                    "actionInputs": {
                        "paths": paths,
                        "format": format_arg,
                        "output": output_arg,
                        "config": config_arg,
                    },
                    "exit": run.returncode,
                    "correct": correct,
                    "sourceIntact": source_intact,
                    "configIntact": config_intact,
                    "outputBefore": digest(output_before)
                    if output_before is not None
                    else None,
                    "outputAfter": digest(output_after)
                    if output_after is not None
                    else None,
                    "outputReportOrPreview": report,
                    "stdout": normalized(run.stdout, root),
                    "stderr": run.stderr.replace(str(root), "<fixture>").replace(
                        str(runner), "<action>"
                    ),
                    "files": [
                        {
                            "path": path,
                            "before": digest(data),
                            "after": digest(current[path]),
                        }
                        for path, data in original.items()
                    ],
                    "temporaryFiles": leftovers,
                    "matchesDirectStdoutReport": correct if name in CONTROLS else None,
                }
            )

    result = {
        "scope": "Actual composite Action Bash body, run locally on synthetic Linux files; not a hosted GitHub Actions run.",
        "node": subprocess.check_output([str(node), "--version"], text=True).strip(),
        "cli": digest(cli.read_bytes()),
        "action": digest(args.action.read_bytes()),
        "fileSizeLimitBytes": 2048,
        "cases": rows,
        "summary": {
            "cases": len(rows),
            "correct": sum(r["correct"] for r in rows),
            "inputOrConfigChanged": sum(
                not r["sourceIntact"] or not r["configIntact"] for r in rows
            ),
            "falseCleanWithChangedSource": sum(
                r["exit"] == 0 and not r["sourceIntact"] for r in rows
            ),
        },
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result["summary"]))
    if args.expect == "after":
        assert all(r["correct"] for r in rows), [
            r["case"] for r in rows if not r["correct"]
        ]
    else:
        assert result["summary"]["falseCleanWithChangedSource"] >= 3
        assert not next(r for r in rows if r["case"] == "limited-existing")["correct"]


if __name__ == "__main__":
    main()
