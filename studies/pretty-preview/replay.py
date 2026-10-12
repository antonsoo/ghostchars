"""Actual CLI compatibility and source-location checks. Public text is not vendored."""
import collections
import hashlib
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

before, after, repo, scratch, output = map(Path, sys.argv[1:6])
node = sys.argv[6] if len(sys.argv) > 6 else "node"
before, after, repo, scratch = [path.resolve() for path in [before, after, repo, scratch]]
scratch.mkdir(parents=True, exist_ok=True)
env = {**os.environ, "NO_COLOR": "1"}
inputs = [
    ("dense-500", ("a\u200b" * 500).encode()),
    ("dense-1500", ("a\u200b" * 1500).encode()),
    ("dense-6000", ("a\u200b" * 6000).encode()),
    ("distant-column", ("x" * 1_000_000 + "\u200b end").encode()),
    ("long-identifier", ("a" * 100_000 + "\u0430").encode()),
    ("wide-context", "\t🧪漢字\u200bthen\u202e end\r\nnext\u200bline".encode()),
    ("long-payload", ("A" + "".join(chr(0xfe00 + b) if b < 16 else chr(0xe0100 + b - 16) for b in b"harmless payload " * 1000)).encode()),
    ("clean", "Ordinary source text.\r\n日本語\n".encode()),
    ("invalid-utf8", b"broken\xfftext"),
]
public = json.loads((repo / "studies/pretty-preview/public-inputs.json").read_text())
for i, entry in enumerate(public):
    data = (repo / "studies/prompt-census/cache" / entry["source"] / entry["file"]).read_bytes()
    assert hashlib.sha256(data).hexdigest() == entry["sha256"]
    inputs.append((f"public-{i}", data))


def sha(data):
    return hashlib.sha256(data).hexdigest()


def invoke(cli, name, fmt, extra=()):
    start = time.monotonic()
    result = subprocess.run([node, str(cli), "--no-config", name + ".txt", "--format", fmt, *extra],
                            cwd=scratch, env=env, capture_output=True, timeout=60)
    assert result.returncode in (0, 1, 2), (name, fmt, result.returncode)
    assert not result.stderr, (name, fmt, result.stderr[:200])
    return result, time.monotonic() - start


def canonical(result, fmt):
    if fmt == "json":
        value = json.loads(result.stdout)
        value["summary"].pop("durationMs")
        return json.dumps(value, sort_keys=True, ensure_ascii=True).encode()
    return result.stdout


def check_locations(data, findings):
    # Derive positions directly from the UTF-16 source units, retaining CRLF.
    units = data.decode().encode("utf-16-le")
    targets = {f[edge]["offset"] for f in findings for edge in ["start", "end"]}
    positions = {}
    line, column = 1, 1
    for offset in range(len(units) // 2 + 1):
        if offset in targets:
            positions[offset] = {"offset": offset, "line": line, "column": column}
        value = units[2 * offset:2 * offset + 2]
        following = units[2 * offset + 2:2 * offset + 4]
        if value == b"\n\0" or value == b"\r\0" and following != b"\n\0":
            line, column = line + 1, 1
        else:
            column += 1
    for finding in findings:
        for edge in ["start", "end"]:
            assert finding[edge] == positions[finding[edge]["offset"]]


results = []
header = re.compile(r"^  (\d+):(\d+)-(\d+):(\d+)\s+(error|warn|info)\s+([a-z-]+)$", re.M)
for name, data in inputs:
    path = scratch / (name + ".txt")
    path.write_bytes(data)
    formats = []
    for fmt in ["json", "sarif", "github", "summary"]:
        old, _ = invoke(before, name, fmt)
        new, _ = invoke(after, name, fmt)
        assert old.returncode == new.returncode, (name, fmt)
        assert canonical(old, fmt) == canonical(new, fmt), (name, fmt)
        formats.append({"format": fmt, "status": new.returncode, "sha256": sha(canonical(new, fmt))})
        if fmt == "json":
            report = json.loads(new.stdout)
    findings = [finding for entry in report["results"] for finding in entry["findings"]]
    if findings:
        check_locations(data, findings)
    pretty, elapsed = invoke(after, name, "pretty")
    text = pretty.stdout.decode()
    expected = [(str(f["start"]["line"]), str(f["start"]["column"]), str(f["end"]["line"]), str(f["end"]["column"]),
                 {"warning": "warn"}.get(f["severity"], f["severity"]), f["rule"]) for f in findings]
    assert header.findall(text) == expected, name
    assert pretty.returncode == formats[0]["status"]
    assert not any(chr(cp) in text for cp in [0x1b, 0x200b, 0x202e, 0x2066, 0x2069])
    if findings:
        assert len(pretty.stdout) < len(findings) * 3500 + 2000
    assert path.read_bytes() == data
    if name.startswith("dense-"):
        count = int(name.removeprefix("dense-"))
        assert len(findings) == count
        assert text.count("[[\\u{200B}]]") == count
    results.append({"name": name, "bytes": len(data), "inputSha256": sha(data), "findings": len(findings),
                    "rules": dict(collections.Counter(f["rule"] for f in findings)), "formatsUnchanged": formats,
                    "pretty": {"status": pretty.returncode, "bytes": len(pretty.stdout), "seconds": elapsed, "sha256": sha(pretty.stdout),
                               "allLocationsVerified": True, "sourceUnchanged": True}})
    print(f"{name}: {len(findings)} findings; {len(pretty.stdout)} pretty bytes; four other formats unchanged", flush=True)

repairs = []
for name, data in inputs[:7]:
    outcomes = []
    for cli in [before, after]:
        (scratch / (name + ".txt")).write_bytes(data)
        result, _ = invoke(cli, name, "json", ("--fix",))
        outcomes.append((result.returncode, canonical(result, "json"), (scratch / (name + ".txt")).read_bytes()))
    assert outcomes[0] == outcomes[1], name
    repairs.append({"name": name, "status": outcomes[1][0], "reportSha256": sha(outcomes[1][1]), "repairedSha256": sha(outcomes[1][2])})
Path(output).write_text(json.dumps({"node": subprocess.check_output([node, "--version"], text=True).strip(),
                                  "results": results, "repairs": repairs}, indent=2) + "\n")
