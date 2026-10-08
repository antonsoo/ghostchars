#!/usr/bin/env python3 -I
"""Compare the two builds on the held-out translated documentation.

    heldout.py <scan-released.jsonl> <scan-checkout.jsonl> <out.json>

Lists every finding that only one build reports, with a short excerpt, so the removed ones can
be read.
"""
import collections, json, sys

rel_p, cur_p, out_p = sys.argv[1:4]


def load(path):
    findings, docs = {}, 0
    for line in open(path, encoding="utf-8"):
        row = json.loads(line)
        if "summary" in row:
            docs = sum(s["docs"] for s in row["summary"].values())
            continue
        for f in row["findings"]:
            findings[(row["src"], row["file"], f["off"], f["rule"], "mixes" in f["msg"])] = f
    return findings, docs


rel, docs = load(rel_p)
cur, _ = load(cur_p)


def counts(findings):
    c = collections.Counter(f"{k[3]}:{f['sev']}" for k, f in findings.items())
    return dict(sorted(c.items()))


def excerpt(f):
    c = f["ctx"]; a = c.find("[[")
    return c[max(0, a - 20):a + 40].replace("\n", " ")


out = {
    "documents": docs,
    "released": {"findings": len(rel), "by_rule_severity": counts(rel)},
    "checkout": {"findings": len(cur), "by_rule_severity": counts(cur)},
    "only_released": [{"file": k[1], "rule": k[3], "severity": f["sev"], "excerpt": excerpt(f)} for k, f in rel.items() if k not in cur],
    "only_checkout": [{"file": k[1], "rule": k[3], "severity": f["sev"], "excerpt": excerpt(f)} for k, f in cur.items() if k not in rel],
}
json.dump(out, open(out_p, "w"), ensure_ascii=False, indent=1)
print(out["documents"], out["released"]["findings"], out["checkout"]["findings"], len(out["only_released"]), len(out["only_checkout"]))
