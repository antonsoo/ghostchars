"""Check the shipped CLI, unchanged library and separately installed tarball."""
import hashlib
import json
import subprocess
import sys
import tarfile
from pathlib import Path

before, clean, current, installed, archive, output = map(Path, sys.argv[1:])


def receipt(path, data):
    return {"path": path, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}


commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=current, text=True).strip()
tracked = subprocess.check_output(["git", "ls-tree", "-r", "--name-only", commit], cwd=current, text=True).splitlines()
configs = {"package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json", "esbuild.cli.mjs", "eslint.config.js"}
inputs = []
for name in tracked:
    if name.startswith(("src/", "tests/")) or name in configs:
        data = (clean / name).read_bytes()
        assert data == (current / name).read_bytes(), name
        inputs.append(receipt(name, data))
build = []
unchanged_library = []
for path in sorted((clean / "dist").rglob("*")):
    if not path.is_file():
        continue
    name = path.relative_to(clean).as_posix()
    data = path.read_bytes()
    assert data == (current / name).read_bytes(), name
    item = receipt(name, data)
    build.append(item)
    if name != "dist/cli.js":
        assert data == (before / name).read_bytes(), name
        unchanged_library.append(item)
assert (clean / "dist/cli.js").read_bytes() == subprocess.check_output(["git", "show", f"{commit}:dist/cli.js"], cwd=current)
package = []
with tarfile.open(archive) as tar:
    for member in tar.getmembers():
        if not member.isfile():
            continue
        name = member.name.removeprefix("package/")
        data = tar.extractfile(member).read()
        assert data == (installed / name).read_bytes(), name
        assert data == (clean / name).read_bytes(), name
        package.append(receipt(name, data))
Path(output).write_text(json.dumps({"sourceCommit": commit, "sourceInputs": inputs, "build": build,
                                   "unchangedLibrary": unchanged_library, "package": package,
                                   "archive": receipt(archive.name, archive.read_bytes()), "allBytesEqual": True,
                                   "scope": "CLI source change; no registry release or hosted deployment"}, indent=2) + "\n")
print(f"Verified {len(inputs)} inputs, {len(build)} built files, {len(unchanged_library)} unchanged library files and {len(package)} installed package files")
