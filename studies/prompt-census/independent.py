#!/usr/bin/env python3 -I
"""Look for evasion and decoration techniques with a probe that shares no code with ghostchars,
then ask whether ghostchars reported anything at the same place.

    independent.py <cache-dir> <manifest.json> <scan.jsonl> <out.json>

A "run" is a maximal sequence of characters of one technique class. A run is "covered" when the span of a
ghostchars finding of any rule comes within 2 UTF-16 code units of it (before, after or across).
"""
import bisect, json, os, re, sys, collections

cache, manifest_path, scan_path, out_path = sys.argv[1:5]
manifest = json.load(open(manifest_path))

findings = collections.defaultdict(list)  # (src, file) -> sorted utf-16 offsets of findings
for line in open(scan_path, encoding="utf-8"):
    row = json.loads(line)
    if "summary" in row:
        continue
    findings[(row["src"], row["file"])] = sorted((f["off"], f["end"]) for f in row["findings"])

R = lambda *rs: "[" + "".join(f"\\U{a:08x}-\\U{b:08x}" for a, b in rs) + "]"
CLASSES = {
    # styled letters and look-alike alphabets
    "math-alphanumeric": R((0x1D400, 0x1D7FF)),
    "fullwidth-latin-digit": R((0xFF10, 0xFF19), (0xFF21, 0xFF3A), (0xFF41, 0xFF5A)),
    "circled-squared-letters": R((0x24B6, 0x24E9), (0x1F130, 0x1F189), (0x1F150, 0x1F169)),
    "regional-indicator": R((0x1F1E6, 0x1F1FF)),
    "small-caps-modifier-letters": R((0x1D00, 0x1DBF), (0x2B0, 0x2B8), (0x2071, 0x2071), (0x207F, 0x207F), (0x2090, 0x209C)),
    "letterlike-roman-numeral": R((0x2100, 0x214F), (0x2160, 0x217F)),
    "ipa-extensions": R((0x250, 0x2AF)),
    "tag-latin-lookalikes-cherokee-canadian": R((0x13A0, 0x13FF), (0x1400, 0x167F)),
    # invisible and blank characters
    "zero-width-and-joiners": R((0x200B, 0x200D), (0x2060, 0x2064), (0xFEFF, 0xFEFF)),
    "soft-hyphen-cgj": R((0xAD, 0xAD), (0x34F, 0x34F)),
    "hangul-filler-braille-blank": R((0x115F, 0x1160), (0x3164, 0x3164), (0xFFA0, 0xFFA0), (0x2800, 0x2800)),
    "mongolian-fvs-khmer-inherent": R((0x180B, 0x180E), (0x17B4, 0x17B5)),
    "bidi-controls-marks": R((0x200E, 0x200F), (0x202A, 0x202E), (0x2066, 0x2069), (0x61C, 0x61C)),
    "private-use": R((0xE000, 0xF8FF), (0xF0000, 0xFFFFD), (0x100000, 0x10FFFD)),
    "interlinear-object-replacement": R((0xFFF9, 0xFFFC)),
    "tag-characters": R((0xE0000, 0xE007F)),
    "variation-selectors": R((0xFE00, 0xFE0F), (0xE0100, 0xE01EF)),
    "unusual-spaces": R((0xA0, 0xA0), (0x1680, 0x1680), (0x2000, 0x200A), (0x202F, 0x202F), (0x205F, 0x205F), (0x3000, 0x3000)),
    "noncharacter": R((0xFDD0, 0xFDEF), (0xFFFE, 0xFFFF)),
}
# styled letters: letters only (not digits, not punctuation), at least four in a row, so a lone
# math symbol or a circled digit does not count. These alphabets carry no ASCII spelling of their own.
CLASSES["styled-word-4plus"] = R((0x1D400, 0x1D6A3), (0x1D6A8, 0x1D7CB), (0xFF21, 0xFF3A), (0xFF41, 0xFF5A), (0x24B6, 0x24E9), (0x1F130, 0x1F189), (0x1D00, 0x1D2B), (0x2B0, 0x2B8))
RUNS = {k: re.compile(v + ("{4,}" if k == "styled-word-4plus" else "+")) for k, v in CLASSES.items()}
STACK = re.compile(r"[^\W\d_][\u0300-\u036f\u1ab0-\u1aff\u1dc0-\u1dff\u20d0-\u20ff\ufe20-\ufe2f]{3,}")  # base + 3 or more marks
# a Cyrillic, Greek or Armenian letter standing inside a word that is otherwise ASCII Latin
MIXED = re.compile(r"[A-Za-z]+[\u0370-\u03ff\u0400-\u04ff\u0530-\u058f]+[A-Za-z]*|[\u0370-\u03ff\u0400-\u04ff\u0530-\u058f]+[A-Za-z]+")
# an invisible character between two ASCII letters: how a filter-slipping split looks
ZW_IN_WORD = re.compile(r"[A-Za-z][\u00ad\u034f\u200b-\u200d\u2060-\u2064\ufeff\u180b-\u180e\u17b4\u17b5\u3164\uffa0\u115f\u1160]+[A-Za-z]")

def merge_spans(spans, pad=2):
    merged = []
    for lo, hi in spans:
        lo, hi = lo - pad, hi + pad
        if merged and lo <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], hi)
        else:
            merged.append([lo, hi])
    return merged


def astral_index(s):
    return [i for i, ch in enumerate(s) if ord(ch) > 0xFFFF]

def u16(astral, i):
    return i + bisect.bisect_left(astral, i)

out = {"classes": {}, "uncovered_examples": {}}
stat = collections.defaultdict(lambda: {"runs": 0, "chars": 0, "docs": set(), "uncovered_docs": set(), "covered_runs": 0, "by_source": collections.Counter()})
examples = collections.defaultdict(list)
total_docs = 0
for src in manifest["sources"]:
    for rel in src["files"]:
        total_docs += 1
        text = open(os.path.join(cache, src["id"], rel), "rb").read().decode("utf-8", "replace")
        if text.isascii():
            continue
        offs = findings.get((src["id"], rel), [])
        astral = astral_index(text)
        merged = merge_spans(offs)
        starts = [m[0] for m in merged]
        probes = [(k, rx) for k, rx in RUNS.items()] + [("combining-mark-stack", STACK), ("mixed-script-word", MIXED), ("invisible-inside-ascii-word", ZW_IN_WORD)]
        for name, rx in probes:
            for m in rx.finditer(text):
                if name == "zero-width-and-joiners" and m.start() == 0 and m.group() == "\ufeff":
                    name_eff = "bom-at-start"
                else:
                    name_eff = name
                s = stat[name_eff]
                a = u16(astral, m.start()); b = u16(astral, m.end())
                s["runs"] += 1
                s["chars"] += len(m.group())
                s["docs"].add((src["id"], rel))
                s["by_source"][src["id"]] += 1
                k = bisect.bisect_right(starts, b) - 1
                covered = k >= 0 and merged[k][1] >= a
                if covered:
                    s["covered_runs"] += 1
                else:
                    s["uncovered_docs"].add((src["id"], rel))
                if not covered and len(examples[name_eff]) < 400:
                    ctx = text[max(0, m.start() - 30): m.end() + 30]
                    examples[name_eff].append({"src": src["id"], "file": rel, "run": m.group()[:40], "ctx": ctx.replace("\n", " ")})

for k, s in sorted(stat.items()):
    out["classes"][k] = {"runs": s["runs"], "chars": s["chars"], "docs": len(s["docs"]), "covered_runs": s["covered_runs"], "docs_with_uncovered_run": len(s["uncovered_docs"]), "by_source": dict(s["by_source"].most_common(8))}
out["total_docs"] = total_docs
out["uncovered_examples"] = {k: v[:60] for k, v in examples.items()}
json.dump(out, open(out_path, "w"), ensure_ascii=False, indent=1)
for k, v in out["classes"].items():
    print(f"{k:42s} runs={v['runs']:6d} docs={v['docs']:5d} covered={v['covered_runs']:6d}")
