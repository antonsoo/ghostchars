"""Execute escaped identifiers with Node and retain an independent ICU comparison.

Authored controls, not discovered attacks. No Ghostchars implementation is used.
The existing ICU runner checks the literal names; this runner encodes those same
names in source and verifies that Node actually keeps their values distinct.
"""

import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--node", default="node")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--generate-fixtures", action="store_true")
    args = parser.parse_args()
    args.out.parent.mkdir(parents=True, exist_ok=True)
    pairs_path = args.out.with_name("icu-pairs.json")
    assert pairs_path != args.out
    helper = HERE.parent / "code-confusables/oracle.py"
    subprocess.run([sys.executable, str(helper), "--node", args.node, "--out", str(pairs_path)], check=True)
    pairs = json.loads(pairs_path.read_text())
    cases = []
    for pair in pairs["cases"]:
        for encoding in ("fixed", "braced"):
            if encoding == "fixed" and any(ord(c) > 0xFFFF for c in pair["right"]):
                continue  # Surrogate escapes are not valid identifier code points.
            raw = "".join(
                f"\\u{ord(c):04X}" if encoding == "fixed" else f"\\u{{{ord(c):X}}}"
                for c in pair["right"]
            )
            source = (
                "// Authored control: Unicode escapes in distinct JavaScript bindings.\n"
                f"const {pair['left']} = 10;\nconst {raw} = 20;\n"
                f"console.log(JSON.stringify([{pair['left']}, {raw}]));\n"
            )
            file = HERE / "fixtures" / f"{pair['name']}-{encoding}.mjs"
            if args.generate_fixtures:
                file.write_text(source)
            assert file.read_text() == source, file
            native = subprocess.check_output([args.node, str(file)], text=True)
            assert json.loads(native) == [10, 20]
            cases.append({
                "file": f"fixtures/{file.name}", "sha256": sha(file),
                "left": pair["left"], "right": pair["right"], "right_source": raw,
                "skeleton": pair["skeleton"], "native_stdout": native,
                "native_values": json.loads(native), "encoding": encoding,
            })
    result = {
        "scope": "Authored native binding controls; not attack prevalence or detection accuracy.",
        "script_sha256": sha(Path(__file__)), "icu_helper_sha256": sha(helper),
        "icu_pairs_sha256": sha(pairs_path), "icu_version": pairs["icuVersion"],
        "icu_unicode_version": pairs["unicodeVersion"], "node": pairs["node"],
        "cases": cases,
    }
    args.out.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({"executed_distinct_pairs": len(cases), "literal_icu_pairs": len(pairs["cases"])}))


if __name__ == "__main__":
    main()
