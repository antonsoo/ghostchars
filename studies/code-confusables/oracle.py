"""Capture ICU skeletons and execute distinct bindings in the native JS engine.

No Ghostchars code or tables are used. Requires libicui18n and Node.js.
Run: python studies/code-confusables/oracle.py --out /tmp/code-oracle.json
Fixtures are controlled examples, not discovered attacks.
"""

import argparse
import ctypes as c
import ctypes.util
import hashlib
import json
import re
import subprocess
from pathlib import Path

PAIRS = [
    ("latin-cyrillic-a", "a", "\u0430"),
    ("latin-greek-o", "o", "\u03bf"),
    ("latin-greek-rho", "p", "\u03c1"),
    ("cyrillic-greek-o", "\u043e", "\u03bf"),
    ("latin-ligature", "ff", "\ufb00"),
    ("canonical-single", "\u00e9", "e\u0301"),
    ("same-script-theta", "\u03b8", "\u03d1"),
    ("styled-single", "a", "\U0001d41a"),
    ("fullwidth-single", "a", "\uff41"),
    ("canonical-word", "caf\u00e9", "cafe\u0301"),
    ("hebrew-same-script", "\u05d5", "\u05df"),
    ("accented-single", "\u00e1", "\u0430\u0301"),
    ("letter-number", "I", "\u2160"),
    ("other-id-start", "e", "\u212e"),
    ("dollar-prefix", "$a", "$\u0430"),
    ("dollar-suffix", "a$", "\u0430$"),
]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--node", default="node")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--generate-fixtures", action="store_true")
    args = parser.parse_args()
    library = ctypes.util.find_library("icui18n")
    if not library:
        raise SystemExit("libicui18n is required")
    icu = c.CDLL(library)
    match = re.search(r"\.so\.(\d+)", library)

    def function(name, arguments, result):
        symbol = name + ("_" + match[1] if match else "")
        fn = getattr(icu, symbol)
        fn.argtypes, fn.restype = arguments, result
        return fn

    open_checker = function("uspoof_open", [c.POINTER(c.c_int32)], c.c_void_p)
    close_checker = function("uspoof_close", [c.c_void_p], None)
    get_skeleton = function("uspoof_getSkeletonUTF8", [
        c.c_void_p, c.c_uint32, c.c_char_p, c.c_int32,
        c.c_char_p, c.c_int32, c.POINTER(c.c_int32),
    ], c.c_int32)

    def version(name):
        value = (c.c_uint8 * 4)()
        function(name, [c.POINTER(c.c_uint8)], None)(value)
        return ".".join(map(str, value))

    status = c.c_int32(0)
    checker = open_checker(c.byref(status))
    if not checker or status.value > 0:
        raise RuntimeError(f"uspoof_open: {status.value}")

    def skeleton(text):
        data = text.encode("utf-8")
        output = c.create_string_buffer(4096)
        error = c.c_int32(0)
        size = get_skeleton(checker, 0, data, len(data), output, len(output), c.byref(error))
        if error.value > 0 or size >= len(output):
            raise RuntimeError(f"uspoof_getSkeletonUTF8: {error.value}")
        return output.raw[:size].decode("utf-8")

    cases = []
    try:
        for name, left, right in PAIRS:
            file = Path(__file__).parent / "fixtures" / (name + ".mjs")
            source = ("// Controlled example: distinct JavaScript bindings.\n"
                      f"const {left} = 10;\nconst {right} = 20;\n"
                      f"console.log(JSON.stringify([{left}, {right}]));\n")
            if args.generate_fixtures:
                file.write_text(source, encoding="utf-8")
            if file.read_text(encoding="utf-8") != source:
                raise RuntimeError(f"Unexpected fixture bytes: {file.name}")
            a, b = skeleton(left), skeleton(right)
            if left == right or a != b:
                raise AssertionError((name, left, right, a, b))
            output = subprocess.check_output([args.node, str(file)], text=True)
            if json.loads(output) != [10, 20]:
                raise AssertionError((name, output))
            cases.append({"name": name, "file": "fixtures/" + file.name,
                          "sha256": hashlib.sha256(file.read_bytes()).hexdigest(),
                          "bytes": file.stat().st_size, "left": left, "right": right,
                          "skeleton": a, "nativeStdout": output,
                          "nativeValues": json.loads(output)})
    finally:
        close_checker(checker)
    result = {"scope": "Controlled identifier examples: ICU skeleton equality and actual "
                       "JavaScript binding values. No Ghostchars code or tables are used.",
              "icuVersion": version("u_getVersion"),
              "unicodeVersion": version("u_getUnicodeVersion"),
              "node": subprocess.check_output([args.node, "--version"], text=True).strip(),
              "cases": cases}
    args.out.write_text(json.dumps(result, ensure_ascii=True, indent=2) + "\n")
    print(f"Verified {len(cases)} native binding pairs and ICU skeletons")


if __name__ == "__main__":
    main()
