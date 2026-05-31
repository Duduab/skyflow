#!/usr/bin/env python3
"""Set font-weight: 500 on heading / __title SCSS rules (not labels, KPIs, buttons)."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "src"

HEADING_HINTS = (
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "__title",
    "__hero-title",
    "__sheets-title",
    "__steps-title",
    "admin-page__title",
    ".admin-dash h2",
    "admin-scrap__chart-head h2",
    "admin-scrap__section-head h2",
    "admin-scrap__insight-title",
    "admin-settings-card__head h2",
    "admin-sim__section-head h2",
    "admin-sim__lines-head h3",
    "admin-sim-card h3",
    "admin-sim__insight h3",
    "admin-sim-modal__preview h3",
    "admin-users-panel h3",
    "planning-panel__heading",
    "planning-row-card__heading",
)

SKIP_HINTS = (
    "__label",
    "__value",
    "__kpi",
    "__badge",
    "__btn",
    "__link",
    "__nav",
    "__status",
    "__pack",
    "__gauge",
    "__cta",
    "__meta",
    "__glyph",
    "__account",
    "__initials",
    "__coverage",
    "__project-name",
    "__project-scrap",
    "__list__",
    "__doc__",
    "__order-row",
    "__shipping-pack",
    "__truck",
    "__kicker",
    "__eyebrow",
    "__filter",
    "__toolbar",
    "__live-badge",
    "__live-progress",
    "__live-link",
    "__project-select",
    "__activity-icon",
    "__orders-open",
    "__insight-title",  # handled via h2 in selector
    "admin-table th",
    ".admin-scrap__td",
    "__lang-name",
    "__lang-glyph",
)

WEIGHT_RE = re.compile(
    r"font-weight:\s*(?:700|800|850|900)(\s*!important)?\s*;"
)


def selector_is_heading(selector: str) -> bool:
    s = selector.strip()
    if not s or s.startswith("@") or s.startswith("//"):
        return False
    if any(skip in s for skip in SKIP_HINTS):
        if not any(h in s for h in ("h1", "h2", "h3", "h4", "h5", "h6")):
            return False
    return any(hint in s for hint in HEADING_HINTS)


def patch_file(path: Path) -> bool:
    text = path.read_text(encoding="utf-8")
    lines = text.splitlines(keepends=True)
    out: list[str] = []
    i = 0
    changed = False

    while i < len(lines):
        line = lines[i]
        if "{" not in line:
            out.append(line)
            i += 1
            continue

        # Accumulate selector until opening brace
        sel_lines = [line.split("{", 1)[0]]
        rest = line.split("{", 1)[1] if "{" in line else ""
        brace_depth = line.count("{") - line.count("}")
        block_body: list[str] = []
        if rest:
            block_body.append(rest)

        i += 1
        while brace_depth > 0 and i < len(lines):
            ln = lines[i]
            if brace_depth == 1 and "{" in ln and not block_body:
                sel_lines.append(ln.split("{", 1)[0])
                rest = ln.split("{", 1)[1]
                if rest:
                    block_body.append(rest)
                brace_depth += ln.count("{") - ln.count("}")
            else:
                block_body.append(ln)
                brace_depth += ln.count("{") - ln.count("}")
            i += 1

        selector = " ".join(s.strip() for s in " ".join(sel_lines).splitlines())
        is_heading = any(
            selector_is_heading(part.strip()) for part in selector.split(",")
        )

        block_text = "".join(block_body)
        if is_heading and WEIGHT_RE.search(block_text):

            def repl(m: re.Match[str]) -> str:
                imp = m.group(1) or ""
                return f"font-weight: 500{imp};"

            new_body = WEIGHT_RE.sub(repl, block_text)
            if new_body != block_text:
                changed = True
                block_text = new_body

        out.append("".join(sel_lines) + "{" + block_text)
        if not block_body and i <= len(lines):
            pass

    new_text = "".join(out)
    if changed and new_text != text:
        path.write_text(new_text, encoding="utf-8")
    return changed


def main() -> None:
    touched = []
    for path in sorted(ROOT.rglob("*.scss")):
        if path.name.startswith("_") and "worker-terminal-partials" not in str(path):
            pass
        if patch_file(path):
            touched.append(path.relative_to(ROOT.parent))
    print(f"Updated {len(touched)} files:")
    for p in touched:
        print(f"  {p}")


if __name__ == "__main__":
    main()
