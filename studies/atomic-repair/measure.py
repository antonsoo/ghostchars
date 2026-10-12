"""Time complete CLI repair of fresh synthetic batches; check every output byte."""

import argparse
import hashlib
import json
import platform
import statistics
import subprocess
import tempfile
import time
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--node", required=True)
    parser.add_argument("--before", type=Path, required=True)
    parser.add_argument("--after", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    original = ('const safe = "a\u200bb";\n' + "".join(
        f"// retained source line {i:04d}: important content\n" for i in range(200))).encode()
    expected = original.replace("\u200b".encode(), b"")
    binaries = {name: path.resolve() for name, path in [("before", args.before), ("after", args.after)]}
    elapsed: dict[str, list[float]] = {name: [] for name in binaries}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    for repetition in range(5):
        order = list(binaries) if repetition % 2 == 0 else list(reversed(binaries))
        for name in order:
            with tempfile.TemporaryDirectory(prefix="ghostchars-batch-", dir=args.output.parent) as raw_dir:
                directory = Path(raw_dir)
                files = [directory / f"source-{i:04d}.js" for i in range(200)]
                for path in files:
                    path.write_bytes(original)
                start = time.perf_counter()
                result = subprocess.run([args.node, str(binaries[name]), ".", "--fix", "--no-config", "--format", "json"],
                                        cwd=directory, capture_output=True, timeout=60, check=False)
                elapsed[name].append((time.perf_counter() - start) * 1000)
                assert result.returncode == 0, result.stderr
                assert json.loads(result.stdout)["summary"]["complete"]
                assert all(path.read_bytes() == expected for path in files)
                assert sorted(directory.iterdir()) == files
    report = dict(platform=platform.platform(),
                  node=subprocess.check_output([args.node, "--version"], text=True).strip(),
                  filesPerBatch=200, bytesPerFile=len(original), repetitions=5,
                  note="Synthetic 200-file batch; alternating before/after order, fresh files each time. "
                       "Timing includes CLI startup, scan, repair and JSON output, excludes fixture creation and byte checks. "
                       "One WSL2 filesystem; not a general storage benchmark.",
                  results={name: dict(cliSha256=hashlib.sha256(path.read_bytes()).hexdigest(),
                                      elapsedMs=elapsed[name], medianMs=statistics.median(elapsed[name]))
                           for name, path in binaries.items()})
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    for name, row in report["results"].items():
        print(f"{name}: median {row['medianMs']:.1f} ms for 200 repaired files (5 fresh batches)")


if __name__ == "__main__":
    main()
