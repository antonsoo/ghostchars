"""Generate small, independent confusable vectors using the system ICU C API.

Run with Python 3 and libicui18n installed. No ghostchars tables or code are read.
ICU's Unicode version is recorded; these established characters predate both
the oracle and the bundled Unicode 16 confusables data. This is not a complete
UTS #39 conformance suite or an assertion that different Unicode tables agree.
"""

import ctypes as c
import ctypes.util
import json
import re
from pathlib import Path

library = ctypes.util.find_library("icui18n")
if not library:
    raise SystemExit("Install ICU development/runtime libraries to regenerate these vectors")
icu = c.CDLL(library)
suffix = re.search(r"\.so\.(\d+)", library)


def function(name, args, result):
    symbol = name + ("_" + suffix[1] if suffix else "")
    func = getattr(icu, symbol)
    func.argtypes, func.restype = args, result
    return func


open_checker = function("uspoof_open", [c.POINTER(c.c_int32)], c.c_void_p)
close_checker = function("uspoof_close", [c.c_void_p], None)
get_skeleton = function("uspoof_getSkeletonUTF8", [
    c.c_void_p, c.c_uint32, c.c_char_p, c.c_int32,
    c.c_char_p, c.c_int32, c.POINTER(c.c_int32),
], c.c_int32)
get_version = function("u_getVersion", [c.POINTER(c.c_uint8)], None)
get_unicode_version = function("u_getUnicodeVersion", [c.POINTER(c.c_uint8)], None)


def version(func):
    value = (c.c_uint8 * 4)()
    func(value)
    return ".".join(map(str, value))


error = c.c_int32(0)
checker = open_checker(c.byref(error))
if not checker or error.value > 0:
    raise RuntimeError(f"uspoof_open: {error.value}")


def skeleton(text):
    data = text.encode("utf-8")
    output = c.create_string_buffer(4096)
    status = c.c_int32(0)
    size = get_skeleton(checker, 0, data, len(data), output, len(output), c.byref(status))
    if status.value > 0 or size >= len(output):
        raise RuntimeError(f"uspoof_getSkeletonUTF8: {status.value}")
    return output.raw[:size].decode("utf-8")


# Expected equality is supplied by ICU, not by a handwritten implementation of NFD.
# expectedCollisions also reflects ghostchars' deliberate prose/ASCII/styled policy.
pairs = [
    ("latin-accent-cyrillic", "cop\u00e9", "\u0441\u043e\u0440\u0435\u0301", 2),
    ("cyrillic-precomposed", "cope\u0308", "\u0441\u043e\u0440\u0451", 2),
    ("greek-precomposed", "T\u00f3po", "\u03a4\u03cc\u03c1\u03bf", 2),
    ("combining-order", "cafe\u0301\u0323", "caf\u0435\u0323\u0301", 2),
    ("decomposable-mark", "ca\u0300", "c\u0430\u0340", 2),
    ("mapped-mark-order", "ca\u0315\u0300", "c\u0430\u0315\u0340", 2),
    ("latin-canonical-prose-policy", "caf\u00e9", "cafe\u0301", 0),
    ("latin-dotless-accent", "adm\u00edn", "adm\u0131\u0301n", 2),
    ("existing-cyrillic", "scope", "\u0455\u0441\u043e\u0440\u0435", 2),
    ("different-accents", "cop\u00e9", "\u0441\u043e\u0440\u0450", 0),
    ("accent-not-stripped", "cope", "\u0441\u043e\u0440\u0435\u0301", 0),
    ("identical-spelling", "caf\u00e9", "caf\u00e9", 0),
    ("greek-prose-policy", "\u03cc\u03c1\u03bf", "\u03bf\u0301\u03c1\u03bf", 0),
    ("ascii-policy", "modern", "rnodern", 0),
    ("styled-policy", "caf\u00e9", "\uff43\uff41\uff46e\u0301", 0),
]
try:
    cases = []
    for name, left, right, expected in pairs:
        a, b = skeleton(left), skeleton(right)
        if expected and a != b:
            raise AssertionError((name, a, b))
        cases.append({"name": name, "left": left, "right": right,
                      "leftSkeleton": a, "rightSkeleton": b,
                      "equalSkeletons": a == b, "expectedCollisions": expected})
    result = {"oracle": "ICU uspoof_getSkeletonUTF8", "icuVersion": version(get_version),
              "unicodeVersion": version(get_unicode_version), "cases": cases}
    destination = Path(__file__).with_name("oracle.json")
    destination.write_text(json.dumps(result, ensure_ascii=True, indent=2) + "\n")
    print(f"Wrote {len(cases)} ICU vectors to {destination.name}")
finally:
    close_checker(checker)
