"""Homoglyph identifier collision.

`аdmin` (Cyrillic а, U+0430) and `admin` (plain ASCII) render
identically in most fonts but are two different Python names. The real
authorization check below only ever sets the ASCII one, so it always
returns False -- while a reviewer skimming the diff sees what looks like
one consistent `admin` flag throughout.
"""

ADMIN_USERS = {"root", "operator"}


def is_authorized(username: str) -> bool:
    аdmin = username in ADMIN_USERS  # note: Cyrillic а (U+0430), not "a"
    admin = False                     # the real flag: always False
    return admin
