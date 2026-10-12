"""Replay repairs against disposable files, including actual kernel write limits.

Linux/POSIX study only; no filesystem is filled and no external file is repaired.
The SIGKILL case injects the timing of termination after a real partial write.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import resource
import subprocess
import tempfile
from pathlib import Path


def digest(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def encoded(text: str, encoding: str) -> bytes:
    prefixes = {"utf-8": b"", "utf-8-sig": b"\xef\xbb\xbf", "utf-16-le": b"\xff\xfe", "utf-16-be": b"\xfe\xff"}
    return prefixes[encoding] + text.encode("utf-8" if encoding == "utf-8-sig" else encoding)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--node", required=True)
    parser.add_argument("--cli", type=Path, required=True)
    parser.add_argument("--expect", choices=["before", "after"], required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.cli = args.cli.resolve()
    kill_script = Path(__file__).with_name("kill-during-write.mjs")
    if platform.system() != "Linux" or os.geteuid() == 0:
        raise SystemExit("This study requires unprivileged Linux for its actual permission and RLIMIT cases.")
    small = 'const safe = "a\u200bb";\n'
    large = small + "".join(f"// retained source line {i:04d}: important content\n" for i in range(200))
    rows = []
    cases = [(f"ordinary-{encoding}", encoding, "ordinary") for encoding in ["utf-8", "utf-8-sig", "utf-16-le", "utf-16-be"]]
    cases += [(f"limited-{encoding}", encoding, "limited") for encoding in ["utf-8", "utf-16-le", "utf-16-be"]]
    cases += [(kind, "utf-8", kind) for kind in ["late-limit", "readonly", "readonly-directory", "hardlink", "killed"]]
    # TemporaryDirectory uses the output directory's parent so the caller can
    # keep every disposable write on its chosen scratch filesystem.
    args.output.parent.mkdir(parents=True, exist_ok=True)
    for name, encoding, kind in cases:
        with tempfile.TemporaryDirectory(prefix="ghostchars-repair-", dir=args.output.parent) as raw_dir:
            directory = Path(raw_dir)
            source = directory / "source.js"
            original = encoded(large, encoding)
            expected = encoded(large.replace("\u200b", ""), encoding)
            source.write_bytes(original)
            source.chmod(0o751)
            paths = [source.name]
            earlier = directory / "a-small.js"
            small_original = encoded(small, "utf-8")
            if kind == "late-limit":
                earlier.write_bytes(small_original)
                paths.insert(0, earlier.name)
            alias = directory / "alias.js"
            if kind == "hardlink":
                os.link(source, alias)
            if kind == "readonly":
                source.chmod(0o444)
            if kind == "readonly-directory":
                directory.chmod(0o555)
            before_stat = source.stat()

            def limit_write() -> None:
                resource.setrlimit(resource.RLIMIT_FSIZE, (1024, 1024))

            command = [args.node]
            environment = os.environ.copy()
            if kind == "killed":
                command.extend(["--import", str(kill_script)])
                environment["GHOSTCHARS_STUDY_SOURCE"] = str(source)
            command.extend([str(args.cli), *paths, "--fix", "--no-config", "--format", "json"])
            try:
                completed = subprocess.run(command, cwd=directory, capture_output=True, text=True,
                                           env=environment, preexec_fn=limit_write if kind in {"limited", "late-limit"} else None,
                                           timeout=30, check=False)
            finally:
                directory.chmod(0o755)
            after = source.read_bytes()
            after_stat = source.stat()
            leftovers = [p for p in directory.iterdir() if p.name not in {"source.js", "a-small.js", "alias.js"}]
            row = dict(name=name, encoding=encoding, exit=completed.returncode,
                       originalBytes=len(original), afterBytes=len(after), originalSha256=digest(original),
                       afterSha256=digest(after), preserved=after == original, repaired=after == expected,
                       modeBefore=oct(before_stat.st_mode & 0o7777), modeAfter=oct(after_stat.st_mode & 0o7777),
                       ownerPreserved=(before_stat.st_uid, before_stat.st_gid) == (after_stat.st_uid, after_stat.st_gid),
                       stdout=completed.stdout.replace(raw_dir, "<disposable directory>"),
                       stderr=completed.stderr.replace(raw_dir, "<disposable directory>"),
                       leftovers=[dict(bytes=p.stat().st_size, mode=oct(p.stat().st_mode & 0o7777),
                                       sha256=digest(p.read_bytes())) for p in leftovers])
            if earlier.exists():
                row["earlierPreserved"] = earlier.read_bytes() == small_original
            if alias.exists():
                row["aliasPreserved"] = alias.read_bytes() == original
                row["linksAfter"] = after_stat.st_nlink
            if kind == "ordinary" or (args.expect == "before" and kind in {"hardlink", "readonly-directory"}):
                assert completed.returncode == 0 and row["repaired"], row
                assert row["modeAfter"] == "0o751" and row["ownerPreserved"], row
            elif kind == "killed":
                assert completed.returncode == -9, row
                assert row["preserved"] if args.expect == "after" else len(after) == 32, row
                assert len(leftovers) == (1 if args.expect == "after" else 0), row
                if leftovers:
                    assert row["leftovers"][0]["mode"] == "0o600", row
            else:
                assert completed.returncode == 2, row
                if args.expect == "after" or kind == "readonly":
                    assert row["preserved"], row
                else:
                    assert len(after) == 1024 and not row["preserved"], row
            if kind != "killed":
                assert not leftovers, row
            if kind == "late-limit":
                assert row["earlierPreserved"] == (args.expect == "after"), row
            if args.expect == "after" and kind == "hardlink":
                assert row["aliasPreserved"] and row["linksAfter"] == 2, row
            rows.append(row)
            print(f"{name}: exit {completed.returncode}; {len(original)} -> {len(after)} bytes; "
                  f"original {'preserved' if row['preserved'] else 'replaced' if row['repaired'] else 'DAMAGED'}")
            source.chmod(0o600)
    report = dict(expectation=args.expect, platform=platform.platform(),
                  node=subprocess.check_output([args.node, "--version"], text=True).strip(),
                  cliSha256=digest(args.cli.read_bytes()), cases=rows,
                  limits="Actual Linux RLIMIT_FSIZE and permission failures; injected SIGKILL timing. "
                         "No disk-full device, power-loss or Windows/macOS runtime claim.")
    args.output.write_text(json.dumps(report, indent=2) + "\n")


if __name__ == "__main__":
    main()
