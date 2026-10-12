"""Measure complete pretty CLI output; retain bytes and status, never trim stdout."""
import hashlib
import json
import os
import platform
import resource
import signal
import subprocess
import sys
import time
from pathlib import Path

cli, repo, scratch, output = map(Path, sys.argv[1:5])
node = sys.argv[5] if len(sys.argv) > 5 else "node"
cli, repo, scratch = [path.resolve() for path in [cli, repo, scratch]]
scratch.mkdir(parents=True, exist_ok=True)
resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
inputs = []
for count in [500, 1500]:
    path = scratch / f"zero-width-{count}.txt"
    path.write_text("a\u200b" * count)
    inputs.append((f"dense-{count}", path))
entry = json.loads((repo / "studies/pretty-preview/public-inputs.json").read_text())[0]
source = repo / "studies/prompt-census/cache" / entry["source"] / entry["file"]
assert hashlib.sha256(source.read_bytes()).hexdigest() == entry["sha256"]
inputs.append(("public-0", source))
results = []
for name, path in inputs:
    out, err = scratch / f"{name}.stdout", scratch / f"{name}.stderr"
    start = time.monotonic()
    with out.open("wb") as stdout, err.open("wb") as stderr:
        process = subprocess.Popen([node, str(cli), "--no-config", str(path)], stdout=stdout, stderr=stderr,
                                   start_new_session=True, env={**os.environ, "NO_COLOR": "1"})
        timed_out = False
        try:
            status = process.wait(timeout=60)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            status = process.wait()
            timed_out = True
    elapsed = time.monotonic() - start
    with out.open("rb") as captured:
        output_hash = hashlib.file_digest(captured, "sha256").hexdigest()
    result = {"name": name, "inputBytes": path.stat().st_size, "inputSha256": hashlib.sha256(path.read_bytes()).hexdigest(),
              "status": status, "timedOut": timed_out, "seconds": elapsed, "outputBytes": out.stat().st_size,
              "outputSha256": output_hash, "stderrBytes": err.stat().st_size}
    results.append(result)
    print({k: result[k] for k in ["name", "status", "seconds", "outputBytes", "timedOut"]}, flush=True)
Path(output).write_text(json.dumps({"node": subprocess.check_output([node, "--version"], text=True).strip(),
                                  "platform": platform.platform(), "logicalCpus": os.cpu_count(),
                                  "compiledCliSha256": hashlib.sha256(cli.read_bytes()).hexdigest(), "results": results}, indent=2) + "\n")
