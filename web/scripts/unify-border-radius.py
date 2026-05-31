#!/usr/bin/env python3
"""Unify decorative border-radius values to var(--sf-radius) = 1rem."""

from __future__ import annotations

import re
from pathlib import Path

WEB_SRC = Path(__file__).resolve().parents[1] / "src"
RADIUS_VAR = "var(--sf-radius)"

# Circles / pills — keep shape
KEEP_RE = re.compile(
    r"^(50%|100%|9999?px|0(?:px)?)$",
    re.I,
)


def should_keep(value: str) -> bool:
    v = value.strip()
    return bool(KEEP_RE.match(v))


def replace_in_file(path: Path) -> bool:
    text = path.read_text(encoding="utf-8")
    original = text

    def repl(m: re.Match[str]) -> str:
        val = m.group(1).strip()
        if should_keep(val) or val.startswith("var(--sf"):
            return m.group(0)
        return f"border-radius: {RADIUS_VAR};"

    text = re.sub(
        r"border-radius:\s*([^;{}]+);",
        repl,
        text,
        flags=re.MULTILINE,
    )

    if text != original:
        path.write_text(text, encoding="utf-8")
        return True
    return False


def main() -> None:
    changed = []
    for path in sorted(WEB_SRC.rglob("*.scss")):
        if replace_in_file(path):
            changed.append(path.relative_to(WEB_SRC.parent))
    print(f"Updated {len(changed)} files")
    for p in changed:
        print(f"  - {p}")


if __name__ == "__main__":
    main()
