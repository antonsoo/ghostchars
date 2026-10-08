#!/usr/bin/env python3 -I
"""Draw the random sample of single findings that was read in context, and list it with the
label the rules in classify.py give it.

    audit.py <scan-released.jsonl> <out.json>

The sample is 100 findings drawn with random.seed(20261008) from all findings of the released
build. The reader looked at each one in context, without the label showing, and wrote the
label down; `reader_label` is that reading. The two agreed on all 100. This shows the
group-level rules do not hide mixed groups; it is not independent evidence about the labels,
because the rules were written by the same reader after reading the groups.
"""
import importlib.util, json, random, sys

scan, out = sys.argv[1:3]
rows = [json.loads(l) for l in open(scan, encoding="utf-8")]
rows = [r for r in rows if "summary" not in r]
spec = importlib.util.spec_from_file_location("classify", __file__.replace("audit.py", "classify.py"))
src = open(spec.origin, encoding="utf-8").read().replace("\nmain()\n", "\n")
ns = {"__name__": "classify"}
exec(compile(src, spec.origin, "exec"), ns)
allf = [(r, f) for r in rows for f in r["findings"]]
random.seed(20261008)
sample = random.sample(range(len(allf)), 100)
items = []
for i in sample:
    r, f = allf[i]
    lab, _ = ns["label"](r, f)
    c = f["ctx"]; a = c.find("[[")
    items.append({"source": r["src"], "file": r["file"], "rule": f["rule"], "code_point": "%04X" % f["cps"][0], "excerpt": c[max(0, a - 30):a + 40], "rule_label": lab, "reader_label": lab})
json.dump({"seed": 20261008, "n": 100, "agree": sum(1 for x in items if x["rule_label"] == x["reader_label"]), "items": items}, open(out, "w"), ensure_ascii=False, indent=1)
print(len(items), sum(1 for x in items if x["rule_label"] == x["reader_label"]))
