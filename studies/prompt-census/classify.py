#!/usr/bin/env python3 -I
"""Apply the hand classification to every finding of a scan and tabulate it.

    classify.py <scan.jsonl> <out.json>

The labels were assigned by one reader (Anton's agent, not a second person) after reading
two findings in context from each of the 468 groups of (source, file, rule, severity,
first code point), see ../README.md. This file is those readings written down as rules,
in order; the first rule that matches a finding labels it. Nothing is unlabeled: the
script stops if a finding falls through. `audit.py` draws a random sample of single
findings and checks the rules against a second, independent reading.

Categories (fixed before the tallies were computed):
  H  hidden text      invisible characters that decode to a readable message
  O  obfuscation      characters planted to disguise a word or text from matching
  D  decoration       styled letters, emoji and symbol soup used for look
  L  language         ordinary orthography of a language or script
  T  typography       deliberate spacing in ordinary prose (no-break, thin, em space)
  X  debris           copy-paste, web scraping, encoding and font artifacts
  M  markup           invisible characters placed on purpose with a function that is not evasion
  A  legacy           control bytes standing in for arrows and box drawing in old docs
  B  tool error       ghostchars misread ordinary text (an escape sequence)
  U  unclear          could not tell from the context
"""
import json, re, sys, collections

CJK = re.compile(r"[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af\uff00-\uffef]")
STYLED = re.compile(r"[\U0001D400-\U0001D7FF\uff21-\uff5a\u24b6-\u24e9\u1d00-\u1dbf\u02b0-\u02b8\ua730-\ua7ff]")


def word(f):
    a = f["ctx"].find("[["); b = f["ctx"].find("]]")
    return f["ctx"][a + 2:b] if a >= 0 else ""


def short(ctx):
    """A few characters either side of the finding, which is marked [[like this]]."""
    a = ctx.find("[[")
    return ctx[max(0, a - 40):a + 60] if a >= 0 else ctx[:100]


def label(r, f):
    src, file, rule, cp = r["src"], r["file"], f["rule"], f["cps"][0]
    sev, ctx, w = f["sev"], f["ctx"], word(f)
    msg = f["msg"]
    pre = ctx[ctx.find("[[") - 1:ctx.find("[[")] if "[[" in ctx else ""

    if rule == "styled-text":
        if (src == "L1B3RT4S" and file in ("GROK-MEGA.mkd", "DEEPSEEK.mkd", "GOOGLE.mkd", "OPENAI.mkd")) or file.endswith(("jb1.md", "_000783.txt")) or "Bet_you" in file:
            return "O", "an instruction, a request or a whole jailbreak written in styled letters"
        if file.endswith("_013668.txt"):
            return "L", "mathematical italic letters as notation in a pasted paper"
        return "D", "persona names, headings, bold/italic posts and small-capital tweets in styled letters"
    if rule in ("tag-smuggling", "variation-selector-smuggling"):
        return "H", "payload decodes to readable text (verified with an independent decoder)"
    if src == "L1B3RT4S" and file == "#MOTHERLOAD.txt":
        if rule == "variation-selector-stray":
            return "H", "VS15/VS16 after each word are one bit each; 241 bits decode to a sentence"
        return "M", "line separators around the payload"
    if src == "L1B3RT4S":
        if file in ("GROK-MEGA.mkd", "DEEPSEEK.mkd"):
            return "O", "jailbreak text written in mixed styled letters, katakana, zero-width characters or cipher"
        if file == "BRAVE.mkd":
            return "D", "small-capital letters in a posted tweet"
        if file in ("AMAZON.mkd", "GOOGLE.mkd", "XAI.mkd"):
            return "M", "U+2028 on either side of a <|vq_42069|> or <eos> marker in the template"
        return "X", "line separator inside quoted chat"
    if src == "CL4R1T4S" and "DIA" in file:
        return "M", "left-to-right mark and word joiner placed in front of every tag in the prompt"
    if rule == "variation-selector-stray" and cp == 0x20DD:
        return "D", "glyph soup string (BVM_MEMINISTI...) pasted into several leaked prompts"
    if rule == "variation-selector-stray":
        return "X", "second variation selector after an emoji, or one on a letter, from editors and copy-paste"
    if rule == "bidi-control":
        return ("O", "embedding controls wrapped round a cipher jailbreak") if src == "L1B3RT4S" else ("X", "embedding pair around one quoted sentence")
    if rule == "bidi-mark":
        if "Grok" in file or "grok" in file:
            return "M", "the prompt tells the model to begin its reply with a left-to-right mark"
        return "L", "left-to-right mark beside Hebrew or Arabic text"
    if rule == "control-character":
        if "legacy-circuit" in file:
            return "A", "ESC/SUB bytes as arrows in code-page diagrams"
        if "POnsciFK2_Random" in file:
            return "X", "a file of random bytes"
        if src == "itw-jailbreak-prompts" and file.endswith(("001353.txt", "012426.txt", "006860.txt")):
            return "O", "control bytes inside gibberish adversarial text"
        return "X", "C1 or C0 control from mojibake or a stray paste"
    if rule == "invisible":
        if src == "awesome-chatgpt-prompts":
            return "L", "ZWNJ half-space between a Latin term and a Persian suffix"
        if src == "deepset-prompt-injections" and "000479" in file:
            return "L", "ZWSP as the Khmer word separator"
        if src == "L1B3RT4S":
            return "O", "zero-width characters threaded through a jailbreak"
        if src == "CL4R1T4S":
            return "M", "word joiner next to the LRM before each tag"
        if cp == 0x3164:
            return ("M", "the prompt tells the model to reply with only this invisible letter") if "006094" in file else ("O", "Hangul filler inside gibberish")
        if cp == 0x00AD and "indus-ai" in file:
            return "X", "soft hyphen from mojibake of Devanagari"
        if cp == 0x00AD and "Aria" in file:
            return "O", "soft hyphen inside words of an explicit roleplay prompt"
        if cp == 0x00AD and "xai-grok3" in file:
            return "U", "soft hyphen inside the tag name xaiArtifact"
        if cp == 0x200B and ("claude-sonnet" in file or "grok-4.2" in file):
            return "M", "ZWSP in front of a fence or list marker so it does not close or render"
        if cp == 0x200B and "Unread Ignore Bot" in file:
            return "M", "the GPT is told to answer with a bare ZWSP"
        return "X", "stray zero-width, BOM, soft hyphen or format character from copy-paste"
    if rule == "unusual-whitespace":
        if cp == 0x3000:
            return ("L", "ideographic space inside CJK text") if CJK.search(ctx) else ("X", "ideographic space in pasted English")
        if cp == 0x200A and "Chat" in ctx and "GPT" in ctx:
            return "O", "hair space inside ChatGPT in a GPT title"
        if cp in (0x2009, 0x202F, 0x2003, 0x2005, 0x200A):
            return "T", "thin, narrow, em or hair space around a number, unit or dash"
        if cp == 0x2028:
            return "X", "line separator from a pasted web page or chat"
        if cp == 0x00A0:
            return "X", "no-break space from a scraped or pasted page"
    if rule == "confusable":
        if "mixes" in msg:
            if pre == "\\" and re.match(r"[ntrfvb]", w):
                return "B", "the n of a backslash-n escape read as part of the next word"
            if src == "L1B3RT4S":
                return "O", "see above"
            if src == "awesome-chatgpt-prompts":
                return "X", "a Cyrillic letter inside a French or Azerbaijani word of a translated document"
            if src == "contains-studio-agents":
                return "X", "three Cyrillic letters in front of 'oing' (a keyboard-layout slip)"
            if "\u0411\u044b\u0434\u043b\u043eGPT" in w:
                return "L", "a Russian word attached to GPT as a persona name"
            if src == "TheBigPromptLibrary":
                return "U", "one lookalike letter in a name or a mixed line"
            return "O", "a Cyrillic or other lookalike letter planted in a Latin word, or in gibberish"
        # collisions
        if STYLED.search(w) or any(STYLED.search(x) for x in [f.get("skel") or ""]):
            pass
        if src == "awesome-copilot":
            return "D", "bold/italic Unicode styling for LinkedIn posts, the skill's purpose"
        if src == "L1B3RT4S":
            return ("D", "small capitals") if "BRAVE" in file else ("O", "styled letters in a cipher jailbreak")
        if src == "awesome-chatgpt-prompts":
            return "L", "dotless i (Turkish, Azerbaijani) or a whole Greek or Cyrillic word that has Latin doubles"
        if src == "TheBigPromptLibrary" and "Thrill" in file:
            return "X", "fi ligature from a PDF"
        if src == "TheBigPromptLibrary":
            return "O", "an instruction block written in script-styled letters"
        if src == "itw-jailbreak-prompts":
            if "013668" in file:
                return "X", "fi ligature from a PDF, and a script I next to 1"
            return "D", "persona names and headings in styled letters beside the plain spelling"
        return "U", ""
    raise SystemExit(f"unlabeled: {src} {file} {rule} {cp:04X}")


def main():
    scan, out = sys.argv[1:3]
    rows = [json.loads(l) for l in open(scan, encoding="utf-8")]
    rows = [r for r in rows if "summary" not in r]
    cat = collections.Counter()
    by_rule = collections.defaultdict(collections.Counter)
    by_rule_sev = collections.defaultdict(collections.Counter)
    by_stratum = collections.defaultdict(collections.Counter)
    docs_by_label = collections.defaultdict(set)
    groups = collections.OrderedDict()
    for r in rows:
        for f in r["findings"]:
            lab, note = label(r, f)
            cat[lab] += 1
            by_rule[f["rule"]][lab] += 1
            by_rule_sev[f"{f['rule']}:{f['sev']}"][lab] += 1
            by_stratum[r["stratum"]][lab] += 1
            docs_by_label[lab].add((r["src"], r["file"]))
            sig = f["cps"][0]
            key = (r["src"], r["file"], f["rule"], f["sev"], "mix" if f["rule"] == "confusable" and "mixes" in f["msg"] else ("coll" if f["rule"] == "confusable" else "%04X" % sig))
            g = groups.setdefault(key, {"n": 0, "labels": collections.Counter(), "note": note, "excerpt": short(f["ctx"])})
            g["n"] += 1
            g["labels"][lab] += 1
    res = {
        "findings": sum(cat.values()),
        "by_label": dict(cat),
        "docs_by_label": {k: len(v) for k, v in docs_by_label.items()},
        "hidden_or_disguised_docs": sorted(f"{a}/{b}" for a, b in docs_by_label["H"] | docs_by_label["O"]),
        "hidden_payload_docs": sorted(f"{a}/{b}" for a, b in docs_by_label["H"]),
        "docs_with_findings": len({(r["src"], r["file"]) for r in rows}),
        "by_rule": {k: dict(v) for k, v in by_rule.items()},
        "by_rule_severity": {k: dict(v) for k, v in by_rule_sev.items()},
        "by_stratum": {k: dict(v) for k, v in by_stratum.items()},
        "groups": [{"source": k[0], "file": k[1], "rule": k[2], "severity": k[3], "kind": k[4], "n": v["n"], "label": v["labels"].most_common(1)[0][0], "note": v["note"], "excerpt": v["excerpt"]} for k, v in groups.items()],
    }
    json.dump(res, open(out, "w"), ensure_ascii=False, indent=1)
    print(json.dumps({k: res[k] for k in ("findings", "by_label", "docs_by_label")}, indent=1))


main()
