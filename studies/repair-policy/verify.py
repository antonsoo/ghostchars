#!/usr/bin/env python3
"""Exercise built CLIs on disk; expected bytes are independent of ghostchars."""

import argparse
import hashlib
import json
import os
import re
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def sha(data):
    return hashlib.sha256(data).hexdigest()


def encoded(text, encoding="utf-8"):
    # Explicit signatures, not ghostchars' decoder/encoder.
    signature = {"utf-8": b"", "utf-16le": b"\xff\xfe", "utf-16be": b"\xfe\xff"}
    return signature[encoding] + text.encode(encoding)


def case(name, text, expected, *, policy=None, added=None, encoding="utf-8", **rest):
    return dict(name=name, source=encoded(text, encoding), expected=encoded(expected, encoding),
                policy=policy, added=added, **rest)


def controlled_cases():
    cases = [
        case("ordinary-removal", "a\u200bb", "ab", added="1: + ab"),
        case("unfixable-findings-remain", "admin \u0430dmin", "admin \u0430dmin", review=True),
        case("disabled-rule", "a\u200bb \u202eok\u202c", "a\u200bb ok",
             policy={"rules": {"invisible": False}}, added="1: + a⟦U+200B ZWSP⟧b ok"),
        case("allowed-space", "price\u00a0USD \u200b", "price\u00a0USD ",
             policy={"allow": ["U+00A0"]}, added="1: + price⟦U+00A0 NBSP⟧USD "),
        case("second-pass-disabled", ":\u061c\u200cل", ":\u200cل",
             policy={"rules": {"invisible": False}}),
        case("second-pass-allowed", ":\u061c\u200cل", ":\u200cل",
             policy={"allow": ["U+200C"]}),
        case("partial-compound-allowlist", "x😀\U000e0158\U000e0159z", "x😀\U000e0158z",
             policy={"allow": ["U+E0158"]}),
        case("overlapping-findings", "a\u202eb", "ab", added="1: + ab"),
        case("visible-selector-carrier", "A\ufe0f\ufe0fZ", "AZ", added="1: + AZ"),
        case("astral-selector-carrier", "hi 😀\U000e0158\U000e0159 there", "hi 😀 there",
             added="1: + hi 😀 there"),
        case("second-pass-preview", ":\u061c\u200cل", ":ل", added="1: + :ل"),
        case("cr-lf-join", "start\r\u200b\nend\n", "start\r\nend\n"),
        case("literal-replacement-character", "literal \ufffd \u200b", "literal \ufffd "),
        case("missing-explicit-config", "a\u200bb", "a\u200bb", missing_config=True, exit=2),
        case("unknown-rule", "a\u200bb", "a\u200bb", policy={"rules": {"invisble": False}}, exit=2),
        case("invalid-code-point", "a\u200bb", "a\u200bb", policy={"allow": ["U+110000"]}, exit=2),
        case("invalid-config-shape", "a\u200bb", "a\u200bb", policy=[], exit=2),
        case("terminal-boundary", "\x1b[2Ja\u200bb", "\x1b[2Jab", policy={"allow": ["U+001B"]},
             filename="hide\x1b[2J\n\u202e.txt", terminal=True),
        case("github-property-boundary", "a\u202eb", "ab", filename="a,b:100%\n::error::forged.txt",
             annotation=True),
    ]
    for encoding in ("utf-8", "utf-16le", "utf-16be"):
        text = "\ufeffa\u200bb \u202eok\u202c\r\nprice\u00a0USD\rnext\n"
        expected = "\ufeffa\u200bb ok\r\nprice\u00a0USD\rnext\n"
        cases.append(case(f"policy-and-signature-{encoding}", text, expected, encoding=encoding,
                          policy={"overrides": [{"files": ["*.txt"], "rules": {"invisible": False},
                                                   "allow": ["U+00A0"]}]}))
    for name, data in [
        ("invalid-utf8", bytes.fromhex("61 ff e2 80 8b")),
        ("truncated-utf8", bytes.fromhex("61 e2 80 8b c3")),
        ("odd-utf16le", bytes.fromhex("ff fe 61 00 0b 20 62")),
        ("unpaired-utf16be", bytes.fromhex("fe ff 00 61 20 0b d8 00")),
    ]:
        cases.append({"name": name, "source": data, "expected": data, "exit": 2, "malformed": True})
    return cases


def catalogs():
    typescript = ROOT / "node_modules/typescript"
    version = json.loads((typescript / "package.json").read_text())["version"]
    if version != "5.9.3":
        raise ValueError(f"Expected the locked TypeScript 5.9.3 catalogs, got {version}")
    paths = sorted(typescript.glob("lib/*/diagnosticMessages.generated.json"))
    if len(paths) != 13:
        raise ValueError(f"Expected all 13 catalogs, got {len(paths)}")
    cases = []
    for path in paths:
        original = path.read_bytes()
        text = original.decode("utf-8")
        # A controlled mutation of real translated text, not a naturally occurring attack.
        poisoned, count = re.subn(r'(:\s*")([^"\n]+)',
                                 lambda m: m[1] + "\u202e" + m[2] + "\u202c", text, count=1)
        if count != 1:
            raise ValueError(f"Cannot insert the two control characters into {path.name}")
        json.loads(poisoned)  # The altered catalog must still be valid JSON.
        cases.append(case(f"typescript-{path.parent.name}", poisoned, text,
                          policy={"allow": ["U+00A0"], "rules": {"invisible": False, "control-character": False}},
                          catalog={"package": "typescript@5.9.3", "path": str(path.relative_to(typescript)),
                                       "bytes": len(original), "sha256": sha(original),
                                       "nbsp": text.count("\u00a0"), "zwsp": text.count("\u200b"),
                                       "c1_controls": sum(0x80 <= ord(c) <= 0x9f for c in text)}))
    return cases


def run_case(node, cli, spec):
    env = dict(os.environ, NO_COLOR="1")
    env.pop("FORCE_COLOR", None)
    with tempfile.TemporaryDirectory(prefix="ghostchars-policy-") as folder:
        cwd = Path(folder)
        name = spec.get("filename", "input.txt")
        path = cwd / name
        path.write_bytes(spec["source"])
        if spec.get("policy") is not None:
            (cwd / ".ghostcharsrc.json").write_text(json.dumps(spec["policy"]), encoding="utf-8")
        args = [name]
        if spec.get("missing_config"):
            args += ["--config", "missing.json"]

        def invoke(extra):
            result = subprocess.run([node, str(cli), *args, *extra], cwd=cwd, env=env,
                                    capture_output=True, timeout=30, check=False)
            return result.returncode, result.stdout.decode("utf-8"), result.stderr.decode("utf-8")

        preview_code, preview, preview_err = invoke(["--fix", "--dry-run"])
        checks = {"preview_did_not_write": path.read_bytes() == spec["source"]}
        if spec.get("added") is not None:
            checks["preview_added_line"] = spec["added"] in [line.lstrip() for line in preview.splitlines()]
        if spec.get("review"):
            checks["remaining_findings_visible"] = "confusable" in preview and "Review the remaining findings" in preview
        if spec.get("terminal"):
            outputs = [preview, preview_err]
            for format_name in ("pretty", "summary"):
                _, out, err = invoke(["--format", format_name])
                outputs += [out, err]
            checks["terminal_controls_inert"] = all("\x1b" not in out and "\u202e" not in out for out in outputs)
            checks["filename_visible"] = "hide\\u{001B}[2J\\u{000A}\\u{202E}.txt" in preview
        if spec.get("annotation"):
            _, out, _ = invoke(["--format", "github"])
            annotation_lines = out.splitlines()
            expected = "file=a%2Cb%3A100%25%0A%3A%3Aerror%3A%3Aforged.txt,line=1"
            checks["annotation_identity_escaped"] = bool(annotation_lines) and all(expected in line for line in annotation_lines)
        code, out, err = invoke(["--fix", "--format", "summary"])
        actual = path.read_bytes()
        checks["exact_expected_bytes"] = actual == spec["expected"]
        if "exit" in spec:
            checks["runtime_exit"] = code == preview_code == spec["exit"]
        else:
            checks["nonruntime_exit"] = code in (0, 1) and preview_code in (0, 1)
        if spec.get("malformed"):
            result = subprocess.run([node, str(cli), "reveal", name], cwd=cwd, env=env,
                                    capture_output=True, timeout=30, check=False)
            checks["reveal_refuses_lossy_decoding"] = result.returncode == 2
        result = {"checks": checks, "passed": all(checks.values()), "exit": code, "preview_exit": preview_code,
                      "actual_sha256": sha(actual), "actual_bytes": len(actual)}
        if "catalog" not in spec:
            result.update(actual_hex=actual.hex(), preview=preview, preview_stderr=preview_err, fix_stderr=err)
        else:
            result.update(preview_sha256=sha(preview.encode()), fix_stdout_sha256=sha(out.encode()))
        return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cli", type=Path, default=ROOT / "dist/cli.js")
    parser.add_argument("--baseline", type=Path)
    parser.add_argument("--baseline-revision", default="1a4a312")
    parser.add_argument("--node", default="node")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    clis = {"candidate": args.cli.resolve()}
    if args.baseline:
        clis["baseline"] = args.baseline.resolve()
    result = {"description": "Controlled repair cases and deliberate two-control insertions in all 13 TypeScript 5.9.3 catalogs. Not a detection benchmark.",
                  "node": subprocess.check_output([args.node, "--version"], text=True).strip(),
                  "cli_sha256": {name: sha(path.read_bytes()) for name, path in clis.items()}, "cases": []}
    if args.baseline:
        result["baseline_revision"] = args.baseline_revision
    for spec in controlled_cases() + catalogs():
        row = {"name": spec["name"], "source_sha256": sha(spec["source"]), "source_bytes": len(spec["source"]),
                   "expected_sha256": sha(spec["expected"]), "policy": spec.get("policy")}
        if "catalog" in spec:
            row["catalog"] = spec["catalog"]
        for name, path in clis.items():
            row[name] = run_case(args.node, path, spec)
        result["cases"].append(row)
    result["summary"] = {name: {"passed": sum(row[name]["passed"] for row in result["cases"]),
                                "total": len(result["cases"]),
                                "exact_bytes": sum(row[name]["checks"]["exact_expected_bytes"] for row in result["cases"])}
                         for name in clis}
    args.output.write_text(json.dumps(result, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")
    print(json.dumps(result["summary"], indent=2))
    failures = [row["name"] for row in result["cases"] if not row["candidate"]["passed"]]
    if failures:
        raise SystemExit("Candidate failed: " + ", ".join(failures))


if __name__ == "__main__":
    main()
