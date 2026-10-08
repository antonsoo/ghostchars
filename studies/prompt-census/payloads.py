#!/usr/bin/env python3 -I
"""Find hidden payloads with decoders that share no code with ghostchars, and compare.

    payloads.py <cache-dir> <manifest.json> <scan-released.jsonl> <scan-checkout.jsonl> <out.json>

Four schemes are searched in every document: Unicode tag characters (U+E0020-E007E are ASCII
shifted up by 0xE0000), variation-selector bytes (VS1-16 are 0-15, VS17-256 are 16-255), one
bit per VS15/VS16 after ordinary characters (read both ways round), and zero-width binary (two
zero-width characters as the two bits). A byte payload is unwrapped
again while its text still holds selectors. A candidate counts only if it decodes to clean
UTF-8 text of at least 8 characters, so a stray selector never makes a "payload". For each
payload the script reports whether a finding from each ghostchars build carries the same text.
"""
import hashlib, json, os, re, sys

cache, manifest_path, rel_path, cur_path, out_path = sys.argv[1:6]
manifest = json.load(open(manifest_path))


def vs_byte(c):
    o = ord(c)
    if 0xFE00 <= o <= 0xFE0F:
        return o - 0xFE00
    if 0xE0100 <= o <= 0xE01EF:
        return o - 0xE0100 + 16
    return None


def clean(text):
    return len(text) >= 8 and not re.search(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f\ufffd]", text)


def decode_bytes(seq):
    try:
        return bytes(seq).decode("utf-8")
    except UnicodeDecodeError:
        return None


def runs_of_selectors(text):
    run, start = [], None
    for i, c in enumerate(text):
        b = vs_byte(c)
        if b is not None:
            if start is None:
                start = i
            run.append(b)
        elif run:
            yield start, run
            run, start = [], None
    if run:
        yield start, run


def unwrap(text):
    layers = 0
    while True:
        spliced, changed, last = [], False, 0
        for start, run in runs_of_selectors(text):
            if len(run) < 2:
                continue
            decoded = decode_bytes(run)
            if decoded is None:
                continue
            spliced.append(text[last:start])
            spliced.append(decoded)
            last = start + len(run)
            changed = True
        if not changed:
            return text, layers
        spliced.append(text[last:])
        text = "".join(spliced)
        layers += 1
        if layers > 8:
            return text, layers


def tag_payloads(text):
    run = []
    for c in text + "\0":
        o = ord(c)
        if 0xE0020 <= o <= 0xE007E:
            run.append(chr(o - 0xE0000))
        else:
            if run and clean("".join(run)):
                yield "tag-characters", "".join(run), 1
            run = []


def byte_payloads(text):
    for start, run in runs_of_selectors(text):
        if len(run) < 2:
            continue
        decoded = decode_bytes(run)
        # the first selector is often the emoji's own VS16, which reads as the control byte 0x0F
        if decoded is not None and clean(decoded.lstrip("\x00\x01\x02\x03\x04\x05\x06\x07\x08\x0b\x0c\x0e\x0f")):
            final, layers = unwrap(decoded)
            yield "variation-selector-bytes", final, layers + 1


def bit_payloads(text):
    singles = []
    for start, run in runs_of_selectors(text):
        if len(run) == 1 and run[0] in (14, 15) and start > 0 and not re.match(r"[\u2190-\u2bff\U0001F000-\U0001FAFF\u00a9\u00ae\u203c\u2049\u2122\u2139\u2194-\u21aa\u231a-\u23ff\u24c2\u25aa-\u25fe\u2600-\u27bf]", text[start - 1]):
            singles.append(run[0])
    if len(singles) < 64:
        return
    for one in (15, 14):
        bits = [1 if b == one else 0 for b in singles]
        decoded = decode_bytes([int("".join(map(str, bits[i:i + 8])), 2) for i in range(0, len(bits) - 7, 8)])
        if decoded is not None and clean(decoded):
            yield "variation-selector-bits", decoded, 1
            return


def ascii_of(text):
    return "".join(c for c in (text or "") if 32 <= ord(c) < 127)


ZERO_WIDTH = "\u200b\u200c\u200d\u2060\ufeff"


def zero_width_payloads(text):
    """Zero-width binary: two of the zero-width characters as 0 and 1, eight to a byte, the
    other zero-width characters ignored. Every ordered pair of the four commonest is tried."""
    seq = [c for c in text if c in ZERO_WIDTH]
    if len(seq) < 64:
        return
    commonest = sorted(set(seq), key=seq.count, reverse=True)[:4]
    for zero in commonest:
        for one in commonest:
            if zero == one:
                continue
            bits = [1 if c == one else 0 for c in seq if c in (zero, one)]
            decoded = decode_bytes([int("".join(map(str, bits[i:i + 8])), 2) for i in range(0, len(bits) - 7, 8)])
            if decoded is not None and clean(decoded):
                yield "zero-width-binary", decoded, 1
                return


def reported(path):
    out = {}
    for line in open(path, encoding="utf-8"):
        row = json.loads(line)
        if "summary" in row:
            continue
        out[(row["src"], row["file"])] = [f for f in row["findings"] if f.get("decoded")]
    return out


rel, cur = reported(rel_path), reported(cur_path)
found = []
for src in manifest["sources"]:
    for relname in src["files"]:
        text = open(os.path.join(cache, src["id"], relname), "rb").read().decode("utf-8", "replace")
        if text.isascii():
            continue
        for scheme_fn in (tag_payloads, byte_payloads, bit_payloads, zero_width_payloads):
            seen = set()
            for scheme, payload, layers in scheme_fn(text):
                if payload in seen:
                    continue
                seen.add(payload)
                key = (src["id"], relname)
                probe = payload.strip("\x0f\U0001f573\U0001f3f4\u2620\U0001f409\u200d\ufe0f")[:60]
                found.append({
                    "source": src["id"], "file": relname, "scheme": scheme, "layers": layers,
                    "payload_head": payload[:120], "payload_chars": len(payload),
                    "payload_sha256": hashlib.sha256(payload.encode()).hexdigest(),
                    "released_decodes_it": any(probe in ascii_of(f["decoded"]) for f in rel.get(key, [])),
                    "checkout_decodes_it": any(probe in ascii_of(f["decoded"]) for f in cur.get(key, [])),
                })
json.dump({"payloads": found, "documents_with_payload": len({(p["source"], p["file"]) for p in found})}, open(out_path, "w"), ensure_ascii=False, indent=1)
for p in found:
    print(p["source"], p["file"], p["scheme"], p["layers"], p["payload_chars"], p["released_decodes_it"], p["checkout_decodes_it"], repr(p["payload_head"][:60]))
