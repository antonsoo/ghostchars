// SPDX-License-Identifier: MIT
//
// Demonstrates the Trojan Source class of vulnerability (Boucher & Anderson,
// "Trojan Source: Invisible Vulnerabilities", USENIX Security 2023, also
// tracked as CVE-2021-42574): Unicode bidirectional formatting characters
// let a comment's *displayed* text diverge from its *logical* (compiled)
// text. The comment on the closing brace below is a single, harmless,
// always-terminated // line comment as far as the compiler is concerned --
// but it contains a RIGHT-TO-LEFT OVERRIDE (U+202E) partway through, so an
// editor or PR diff that renders bidi text will show its words in a
// different order than they actually appear in the file. That gap between
// "what a reviewer reads" and "what the compiler reads" is the whole attack:
// a real payload would use it to make commented-out code look active (or
// vice versa) rather than just reordering a sentence, as here.
//
// Run `ghostchars examples/trojan-source.c` to see ghostchars catch it
// regardless of whether your own terminal renders the reordering.
#include <stdbool.h>

bool is_admin_access(const char *role) {
    bool access_level = false;
    if (role) {
        access_level = true;
    }
    return access_level;
} // ‮admin users only: this check intentionally fails open‬
