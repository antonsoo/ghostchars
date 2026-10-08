#!/usr/bin/env python3 -I
"""Fetch the census corpora into cache/ and write manifest.json.

Repositories come as codeload tarballs at a pinned commit; only text files are
extracted (never executed). Hugging Face datasets come as parquet / csv files at a
pinned revision and are unpacked into one text file per row. Run with the venv
python that has pyarrow:  venv/bin/python -I fetch.py

    fetch.py <cache-dir> <manifest.json> [heldout]
    fetch.py --slim <manifest.json> <slim.json>

The full manifest lists every document with its SHA-256 and is what the other scripts read; it
is large, so only the slim one (pins, tarball and parquet hashes, a digest of the per-document
list) is committed.
"""
import csv, hashlib, io, json, os, sys, tarfile, time, urllib.request
from concurrent.futures import ThreadPoolExecutor

UA = "ghostchars-census/0.1 (research; contact anton@praviel.com)"
TEXT_EXT = {".md", ".mdc", ".mdx", ".txt", ".prompt", ".yaml", ".yml", ".cursorrules", ".windsurfrules", ".rules", ".mkd"}
TEXT_NAMES = {"agents.md", "claude.md", "gemini.md", ".cursorrules", ".windsurfrules", "copilot-instructions.md"}
MAX_FILE = 2_000_000
SKIP_NAMES = {"license", "license.md", "license.txt", "code_of_conduct.md", "security.md", "contributing.md", "changelog.md"}

# (id, kind, repo, pinned commit, stratum)
REPOS = [
    ("awesome-cursorrules", "PatrickJS/awesome-cursorrules", "b044f956f021b6e8877f16781bcfc466a6a120e9", "rules"),
    ("awesome-cursor-rules-mdc", "sanjeed5/awesome-cursor-rules-mdc", "8fbf26908531c127a6076be0e55fbe17b57fb2d8", "rules"),
    ("awesome-copilot", "github/awesome-copilot", "7cce7cfb4b61196c36d7e8eb8475ae84b356b126", "rules"),
    ("agents-md", "agentsmd/agents.md", "d001185d792eb6402a58e4cbef1c228b309ec25d", "rules"),
    ("awesome-claude-code-subagents", "VoltAgent/awesome-claude-code-subagents", "721e9734670bfaf7283194e234ebb88e94c82dcd", "agents"),
    ("wshobson-agents", "wshobson/agents", "46891e7e60da0e52baf1050b7b6391b64e84c6d9", "agents"),
    ("contains-studio-agents", "contains-studio/agents", "a5a480c324cac64b9c569bca0b2f297d517240cb", "agents"),
    ("anthropics-skills", "anthropics/skills", "683bc88e56f3e09ba94f7055977f3d3aa499f202", "agents"),
    ("awesome-claude-skills", "ComposioHQ/awesome-claude-skills", "be2a406907dbc61b73e6827ded415c96139d13a2", "agents"),
    ("awesome-claude-code", "hesreallyhim/awesome-claude-code", "6e8dd6316095104e340d1efa53cfdc0c7a01bbd0", "agents"),
    ("fabric", "danielmiessler/fabric", "76cd291d4704a12933263ac7cb2d667509408db2", "prompts"),
    ("awesome-chatgpt-prompts", "f/awesome-chatgpt-prompts", "7d3f248962d1dca209d59e033524bcb86c2b26b8", "prompts"),
    ("awesome-claude-prompts", "langgptai/awesome-claude-prompts", "586aea8d3b815cc119e6a906404231d4e0f71b0b", "prompts"),
    ("system-prompts-and-models", "x1xhlol/system-prompts-and-models-of-ai-tools", "1e4203a7d88873c1b37ab2d1c07074fea498c274", "system"),
    ("system_prompts_leaks", "asgeirtj/system_prompts_leaks", "e31ec211bc24a2816b03470c61eb7f513c710d2a", "system"),
    ("CL4R1T4S", "elder-plinius/CL4R1T4S", "a4d3da04e63324e794a65500c3e41994fc4ab02e", "system"),
    ("TheBigPromptLibrary", "0xeb/TheBigPromptLibrary", "cabcdb04b5970211b1b6163d8725ae66bb48c5f0", "system"),
    ("leaked-system-prompts", "jujumilk3/leaked-system-prompts", "2bffdfe275e5dc4725b23e20c330e036ef438802", "system"),
    ("claude-code-system-prompts", "Piebald-AI/claude-code-system-prompts", "9b3512fe8a0746aa2c3f00b416dc316a838b5d27", "system"),
    ("awesome-ai-system-prompts", "dontriskit/awesome-ai-system-prompts", "74964625038011525ab44c3a673fc605b2c765b3", "system"),
    ("L1B3RT4S", "elder-plinius/L1B3RT4S", "64960b783249d36f76a48a33103cc4b168332b9b", "jailbreak"),
]
# Translated documentation that no change tonight was tuned on. Fetched with a third argument
# "heldout" into its own manifest, and not part of the census.
HELDOUT = [
    ("free-programming-books", "EbookFoundation/free-programming-books", "0ddd8749a993efeac1644ea9f47af0bb6f47b955", "heldout"),
    ("javascript-algorithms", "trekhleb/javascript-algorithms", "85293e3e2b88f4d2ce330d956b139cf628aa1e82", "heldout"),
]
LICENSE_NAMES = ["LICENSE", "LICENSE.md", "LICENSE.txt", "LICENCE", "COPYING", "license"]

HF = [  # (id, dataset, revision, [files], stratum, text column)
    ("itw-jailbreak-prompts", "TrustAIRLab/in-the-wild-jailbreak-prompts", "a10aab8eff1c73165a442d4464dce192bd28b9c5",
     ["jailbreak_2023_12_25/train-00000-of-00001.parquet", "regular_2023_12_25/train-00000-of-00001.parquet"], "wild", "prompt"),
    ("deepset-prompt-injections", "deepset/prompt-injections", "4f61ecb038e9c3fb77e21034b22511b523772cdd",
     ["data/train-00000-of-00001-9564e8b05b4757ab.parquet", "data/test-00000-of-00001-701d16158af87368.parquet"], "wild", "text"),
    ("gandalf-ignore-instructions", "Lakera/gandalf_ignore_instructions", "04737b65e90a6794ec227012e4a255a7def6344b",
     ["data/train-00000-of-00001-ded53be747ff55cd.parquet", "data/validation-00000-of-00001-94481a2a09ff2fff.parquet", "data/test-00000-of-00001-bc92128b9288a6d1.parquet"], "game", "text"),
    ("mosscap-prompt-injection", "Lakera/mosscap_prompt_injection", "b7e495ff63373ff7f7dabc1e9390cf62b5838570",
     ["data/validation-00000-of-00001-e136a45438d15f16.parquet", "data/test-00000-of-00001-06acab2d6a2bcf9f.parquet"], "game", "prompt"),
]


def get(url, tries=4):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.read()
        except Exception as e:
            if i == tries - 1:
                return None
            time.sleep(2 ** (i + 1))


def sha(b):
    return hashlib.sha256(b).hexdigest()


def keep(name):
    base = os.path.basename(name).lower()
    if base in SKIP_NAMES:
        return False
    if base in TEXT_NAMES:
        return True
    return os.path.splitext(base)[1] in TEXT_EXT


def fetch_repo(cache, spec):
    rid, repo, commit, stratum = spec
    data = get(f"https://codeload.github.com/{repo}/tar.gz/{commit}")
    if data is None:
        return {"id": rid, "repo": repo, "error": "download failed"}
    out = os.path.join(cache, rid)
    os.makedirs(out, exist_ok=True)
    files = {}
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tf:
        for m in tf:
            if not m.isreg() or m.size > MAX_FILE or m.size == 0:
                continue
            rel = m.name.split("/", 1)[1] if "/" in m.name else m.name
            if ".." in rel.split("/") or rel.startswith("/") or not keep(rel):
                continue
            body = tf.extractfile(m).read()
            dest = os.path.join(out, rel)
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            with open(dest, "wb") as f:
                f.write(body)
            files[rel] = sha(body)
    lic = None
    for n in LICENSE_NAMES:
        b = get(f"https://raw.githubusercontent.com/{repo}/{commit}/{n}", tries=1)
        if b:
            lic = {"file": n, "sha256": sha(b), "head": b.decode("utf-8", "replace").strip().splitlines()[0][:80]}
            break
    return {"id": rid, "kind": "github", "repo": repo, "commit": commit, "stratum": stratum,
            "tarball_sha256": sha(data), "license_file": lic, "files": files}


def fetch_hf(cache, spec):
    import pyarrow.parquet as pq
    rid, ds, rev, paths, stratum, col = spec
    out = os.path.join(cache, rid)
    os.makedirs(out, exist_ok=True)
    files, raw = {}, {}
    where = {}  # per data file: rows by the dataset's own "platform" and "source" columns, where it has them
    for p in paths:
        b = get(f"https://huggingface.co/datasets/{ds}/resolve/{rev}/{p}")
        if b is None:
            return {"id": rid, "dataset": ds, "error": f"download failed: {p}"}
        raw[p] = sha(b)
        tbl = pq.read_table(io.BytesIO(b)).to_pylist()
        for column in ("platform", "source"):
            if tbl and column in tbl[0]:
                counts = {}
                for row in tbl:
                    counts[row[column]] = counts.get(row[column], 0) + 1
                where.setdefault(p.split("/")[0], {})[column] = dict(sorted(counts.items(), key=lambda kv: -kv[1])[:10])
        tag = p.split("/")[0].split("-")[0]
        for i, row in enumerate(tbl):
            text = row[col]
            if not isinstance(text, str) or not text:
                continue
            rel = f"{p.replace('/', '_').replace('.parquet', '')}_{i:06d}.txt"
            body = text.encode("utf-8", "surrogatepass")
            with open(os.path.join(out, rel), "wb") as f:
                f.write(body)
            files[rel] = sha(body)
    return {"id": rid, "kind": "huggingface", "dataset": ds, "revision": rev, "stratum": stratum,
            "source_files_sha256": raw, "rows_by_platform_and_source": where, "files": files}


def slim(full):
    """The committed manifest: every pin and hash needed to get the same files, without the
    83,000 per-document entries (a digest over them stands in)."""
    out = {"fetched": full["fetched"], "sources": []}
    for s in full["sources"]:
        t = {k: v for k, v in s.items() if k != "files"}
        listing = "\n".join(f"{name} {digest}" for name, digest in sorted(s.get("files", {}).items()))
        t["documents"] = len(s.get("files", {}))
        t["documents_sha256"] = hashlib.sha256(listing.encode()).hexdigest()
        out["sources"].append(t)
    return out


def main():
    if sys.argv[1] == "--slim":
        json.dump(slim(json.load(open(sys.argv[2]))), open(sys.argv[3], "w"), indent=1, sort_keys=True)
        return
    cache, manifest = sys.argv[1], sys.argv[2]
    heldout = len(sys.argv) > 3 and sys.argv[3] == "heldout"
    os.makedirs(cache, exist_ok=True)
    with ThreadPoolExecutor(4) as ex:
        a = list(ex.map(lambda s: fetch_repo(cache, s), HELDOUT if heldout else REPOS))
        b = [] if heldout else list(ex.map(lambda s: fetch_hf(cache, s), HF))
    res = a + b
    with open(manifest, "w") as f:
        json.dump({"fetched": time.strftime("%Y-%m-%d"), "sources": res}, f, indent=1, sort_keys=True)
    json.dump(slim({"fetched": time.strftime("%Y-%m-%d"), "sources": res}), open(manifest.replace(".json", ".slim.json"), "w"), indent=1, sort_keys=True)
    for r in res:
        print(r["id"], len(r.get("files", {})), r.get("error", ""), (r.get("license_file") or {}).get("head", ""))


main()
