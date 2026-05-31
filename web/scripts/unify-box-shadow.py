#!/usr/bin/env python3
"""Replace decorative box-shadow declarations with unified --sf-shadow token."""

from __future__ import annotations

import re
from pathlib import Path

WEB_SRC = Path(__file__).resolve().parents[1] / "src"
SHADOW_VAR = "var(--sf-shadow)"
INSET_VAR = "var(--sf-shadow-inset)"

FOCUS_RE = re.compile(r"^0\s+0\s+0\s+[\d.]+px")
INSET_BORDER_RE = re.compile(
    r"inset\s+0\s+(?:0\s+0|1px\s+0)\s+[\d.]+px",
    re.I,
)


def split_shadow_parts(value: str) -> list[str]:
    parts: list[str] = []
    buf: list[str] = []
    depth = 0
    for ch in value:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth = max(0, depth - 1)
        elif ch == "," and depth == 0:
            parts.append("".join(buf).strip())
            buf = []
            continue
        buf.append(ch)
    tail = "".join(buf).strip()
    if tail:
        parts.append(tail)
    return parts


def classify_shadow_value(value: str) -> str | None:
    v = " ".join(value.split())
    if not v or v == "none":
        return None
    if v.startswith("var(--sf-shadow"):
        return None
    parts = split_shadow_parts(v)
    if not parts:
        return None
    if all(FOCUS_RE.match(p) for p in parts):
        return None
    if all(INSET_BORDER_RE.search(p) for p in parts):
        return None
    focus_parts = [p for p in parts if FOCUS_RE.match(p)]
    non_focus = [p for p in parts if not FOCUS_RE.match(p)]
    if focus_parts and not non_focus:
        return None
    has_inset = any(p.startswith("inset") for p in non_focus)
    base = INSET_VAR if has_inset else SHADOW_VAR
    if focus_parts:
        return f"box-shadow: {base}, {', '.join(focus_parts)};"
    return f"box-shadow: {base};"


def replace_inline_shadows(text: str) -> str:
    def repl(m: re.Match[str]) -> str:
        kind = classify_shadow_value(m.group(1))
        return kind if kind else m.group(0)

    return re.sub(
        r"box-shadow:\s*([^;{}]+);",
        repl,
        text,
        flags=re.MULTILINE,
    )


def replace_multiline_shadows(text: str) -> str:
    pattern = re.compile(r"box-shadow:\s*\n((?:\s+[^;\n]+\n?)+);", re.MULTILINE)

    def repl(m: re.Match[str]) -> str:
        block = m.group(1)
        lines = [
            ln.strip().rstrip(",")
            for ln in block.splitlines()
            if ln.strip()
        ]
        value = ", ".join(lines)
        kind = classify_shadow_value(value)
        return kind if kind else m.group(0)

    return pattern.sub(repl, text)


def process_file(path: Path) -> bool:
    original = path.read_text(encoding="utf-8")
    updated = replace_multiline_shadows(replace_inline_shadows(original))
    if updated != original:
        path.write_text(updated, encoding="utf-8")
        return True
    return False


def main() -> None:
    changed = []
    for path in sorted(WEB_SRC.rglob("*.scss")):
        if process_file(path):
            changed.append(path.relative_to(WEB_SRC.parent))
    print(f"Updated {len(changed)} files")
    for p in changed:
        print(f"  - {p}")


if __name__ == "__main__":
    main()
