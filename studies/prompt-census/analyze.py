#!/usr/bin/env python3 -I
"""Assemble results.json from the pieces the other scripts wrote.

    analyze.py <manifest> <scan-released> <scan-checkout> <classified-released> <classified-checkout> \
               <independent-released> <independent-checkout> <payloads> <audit> <out>
"""
import collections, json, sys

(manifest_p, rel_p, cur_p, cls_rel_p, cls_cur_p, ind_rel_p, ind_cur_p, pay_p, audit_p, out_p) = sys.argv[1:11]
manifest = json.load(open(manifest_p))


def load_scan(path):
    rows = [json.loads(l) for l in open(path, encoding="utf-8")]
    summary = rows[-1]["summary"]
    return [r for r in rows[:-1]], summary


def scan_metrics(rows, summary):
    by_rule_sev = collections.Counter()
    docs_by_rule_sev = collections.defaultdict(set)
    docs_error = set()
    per_file = collections.Counter()
    for r in rows:
        key = (r["src"], r["file"])
        for f in r["findings"]:
            k = f"{f['rule']}:{f['sev']}"
            by_rule_sev[k] += 1
            docs_by_rule_sev[k].add(key)
            per_file[key] += 1
            if f["sev"] == "error":
                docs_error.add(key)
    total = sum(by_rule_sev.values())
    top10 = sum(n for _, n in per_file.most_common(10))
    strata = collections.defaultdict(lambda: {"docs": 0, "flagged": 0, "error_docs": 0})
    for sid, s in summary.items():
        strata[s["stratum"]]["docs"] += s["docs"]
    for r in rows:
        strata[r["stratum"]]["flagged"] += 1
    for src, f in docs_error:
        stratum = next(s["stratum"] for sid, s in summary.items() if sid == src)
        strata[stratum]["error_docs"] += 1
    itw = {"jailbreak": {"docs": 0, "flagged": 0}, "regular": {"docs": 0, "flagged": 0}}
    for src in manifest["sources"]:
        if src["id"] == "itw-jailbreak-prompts":
            for name in src["files"]:
                itw["jailbreak" if name.startswith("jailbreak_") else "regular"]["docs"] += 1
    for r in rows:
        if r["src"] == "itw-jailbreak-prompts":
            itw["jailbreak" if r["file"].startswith("jailbreak_") else "regular"]["flagged"] += 1
    return {
        "findings": total,
        "documents_with_findings": len(per_file),
        "documents_with_an_error": len(docs_error),
        "by_rule_severity": {k: {"findings": n, "documents": len(docs_by_rule_sev[k])} for k, n in sorted(by_rule_sev.items(), key=lambda kv: -kv[1])},
        "top10_files_share_of_findings": round(top10 / total, 4),
        "largest_file_findings": per_file.most_common(1)[0][1],
        "by_stratum": dict(strata),
        "itw_jailbreak_vs_regular": itw,
    }


CATEGORIES = {
    "H": "hidden text: invisible characters that decode to a readable message",
    "O": "obfuscation: characters planted to disguise a word or text from matching",
    "D": "decoration: styled letters, emoji and symbol soup used for look",
    "L": "language: ordinary orthography or notation of a language or script",
    "T": "typography: deliberate spacing in ordinary prose",
    "X": "debris: copy-paste, web scraping, encoding and font artifacts",
    "M": "markup: invisible characters placed on purpose with a function that is not evasion",
    "A": "legacy: control bytes standing in for arrows and box drawing in old documents",
    "B": "tool error: ghostchars misread ordinary text",
    "U": "unclear from the context",
}
rel_rows, rel_sum = load_scan(rel_p)
cur_rows, cur_sum = load_scan(cur_p)

sources = []
for s in manifest["sources"]:
    sm = rel_sum[s["id"]]
    sources.append({
        "id": s["id"], "stratum": s["stratum"], "origin": s.get("repo") or s.get("dataset"),
        "pinned": s.get("commit") or s.get("revision"), "licence_file_first_line": (s.get("license_file") or {}).get("head"),
        "documents": sm["docs"], "bytes": sm["bytes"],
        "documents_with_findings_released": sm["docsWithFindings"], "documents_with_findings_checkout": cur_sum[s["id"]]["docsWithFindings"],
        "findings_released": sm["findings"], "findings_checkout": cur_sum[s["id"]]["findings"],
    })

indep = {}
ind_rel, ind_cur = json.load(open(ind_rel_p)), json.load(open(ind_cur_p))
for k in sorted(set(ind_rel["classes"]) | set(ind_cur["classes"])):
    a, b = ind_rel["classes"].get(k, {}), ind_cur["classes"].get(k, {})
    indep[k] = {"runs": a.get("runs"), "documents": a.get("docs"),
                "released": {"covered_runs": a.get("covered_runs"), "documents_with_an_unreported_run": a.get("docs_with_uncovered_run")},
                "checkout": {"covered_runs": b.get("covered_runs"), "documents_with_an_unreported_run": b.get("docs_with_uncovered_run")}}

cls_rel, cls_cur = json.load(open(cls_rel_p)), json.load(open(cls_cur_p))


def shares(cls):
    out = {}
    for key, labels in cls["by_rule_severity"].items():
        n = sum(labels.values())
        deceptive = labels.get("H", 0) + labels.get("O", 0)
        out[key] = {"findings": n, "labels": labels, "share_not_hidden_or_disguised": round(1 - deceptive / n, 4)}
    n = cls["findings"]
    deceptive = cls["by_label"].get("H", 0) + cls["by_label"].get("O", 0)
    return out, round(1 - deceptive / n, 4)


rel_shares, rel_share_all = shares(cls_rel)
cur_shares, cur_share_all = shares(cls_cur)

# the same share without the one file that holds nearly half of the findings
big = "GROK-MEGA.mkd"
rel_wo = collections.Counter()
for g in cls_rel["groups"]:
    if g["file"] != big:
        rel_wo[g["label"]] += g["n"]
wo_total = sum(rel_wo.values())
rule_wo = collections.defaultdict(collections.Counter)
for g in cls_rel["groups"]:
    if g["file"] != big:
        rule_wo[f"{g['rule']}:{g['severity']}"][g["label"]] += g["n"]
rule_wo = {k: {"findings": sum(v.values()), "labels": dict(v)} for k, v in sorted(rule_wo.items(), key=lambda kv: -sum(kv[1].values()))}

def error_documents(rows):
    """Documents that make the CLI exit 1, and how many of them have no error that was read as hidden or disguised."""
    src = open(__file__.replace("analyze.py", "classify.py"), encoding="utf-8").read().replace("\nmain()\n", "\n")
    ns = {"__name__": "classify"}
    exec(compile(src, "classify.py", "exec"), ns)
    total = harmless = 0
    for r in rows:
        labels = [ns["label"](r, f)[0] for f in r["findings"] if f["sev"] == "error"]
        if labels:
            total += 1
            if not any(lab in ("H", "O") for lab in labels):
                harmless += 1
    return {"documents_with_an_error": total, "of_which_no_error_was_read_as_hidden_or_disguised": harmless}


rel_flagged = {f"{r['src']}/{r['file']}" for r in rel_rows}
hidden_now = cls_cur["hidden_or_disguised_docs"]
results = {
    "corpus": {"documents": sum(s["docs"] for s in rel_sum.values()), "bytes": sum(s["bytes"] for s in rel_sum.values()), "sources": sources,
               "documents_by_stratum": {st: sum(s["docs"] for s in rel_sum.values() if s["stratum"] == st) for st in sorted({s["stratum"] for s in rel_sum.values()})}},
    "released_0_1_5": {**scan_metrics(rel_rows, rel_sum), "error_documents_read": error_documents(rel_rows)},
    "checkout": {**scan_metrics(cur_rows, cur_sum), "error_documents_read": error_documents(cur_rows)},
    "classification_released": {"findings": cls_rel["findings"], "by_label": cls_rel["by_label"], "documents_by_label": cls_rel["docs_by_label"],
                                "hidden_payload_documents": cls_rel["hidden_payload_docs"], "hidden_or_disguised_documents": cls_rel["hidden_or_disguised_docs"],
                                "share_of_findings_not_hidden_or_disguised": rel_share_all,
                                "share_not_hidden_or_disguised_without_GROK_MEGA": round(1 - (rel_wo["H"] + rel_wo["O"]) / wo_total, 4),
                                "findings_without_GROK_MEGA": wo_total, "by_label_without_GROK_MEGA": dict(rel_wo), "by_rule_severity_without_GROK_MEGA": rule_wo,
                                "by_rule_severity": rel_shares, "by_stratum": cls_rel["by_stratum"]},
    "classification_checkout": {"findings": cls_cur["findings"],
                                "hidden_or_disguised_documents": hidden_now,
                                "hidden_or_disguised_documents_released_reported_nothing_in": [d for d in hidden_now if d not in rel_flagged], "by_label": cls_cur["by_label"], "documents_by_label": cls_cur["docs_by_label"],
                                "share_of_findings_not_hidden_or_disguised": cur_share_all, "by_rule_severity": cur_shares},
    "independent_probes": indep,
    "payloads": json.load(open(pay_p)),
    "audit": {k: v for k, v in json.load(open(audit_p)).items() if k != "items"},
}
json.dump(results, open(out_p, "w"), ensure_ascii=False, indent=1)
# The reading itself: one row per group of findings, with the label and a short excerpt to check it against.
json.dump({"categories": CATEGORIES, "released": cls_rel["groups"], "checkout": cls_cur["groups"]}, open(out_p.replace("results.json", "classification.json"), "w"), ensure_ascii=False, indent=1)
print(json.dumps({k: results[k] for k in ("released_0_1_5", "checkout")}, indent=1)[:3000])
