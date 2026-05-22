#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Split css/screens.css into css/screens/*.css by section comment headers."""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "css" / "screens.css"
OUT_DIR = ROOT / "css" / "screens"

TITLE_RE = re.compile(r"^   (ЭКРАН:|Matizi|ПРОГНОЗ)")


def find_block_bounds(lines: list[str], title_idx: int) -> tuple[int, int]:
    """Return [start, end] inclusive line indices for the /* ... */ comment block containing title_idx."""
    s = title_idx
    while s >= 0 and not lines[s].lstrip().startswith("/*"):
        s -= 1
    e = title_idx
    while e < len(lines) and "*/" not in lines[e]:
        e += 1
    return s, e


def classify_title(title_line: str) -> str:
    t = title_line.strip()
    if t.startswith("ЭКРАН: ЛОГИН"):
        return "login"
    if "ГЛАВНАЯ" in t and "МЕХАНИК" in t:
        return "home"
    if "ДАШБОРД" in t:
        return "dashboard"
    if "ДОБАВИТЬ ОПЕРАЦИЮ" in t:
        return "add"
    if "ИСТОРИЯ" in t:
        return "history"
    if "ПАРК МАШИН" in t:
        return "fleet"
    if "СПИСОК ВОДИТЕЛЕЙ" in t or t.startswith("ЭКРАН: ВОДИТЕЛИ"):
        return "drivers"
    if "КАРТОЧКА ВОДИТЕЛЯ" in t:
        return "drivers"
    if "НАСТРОЙКИ" in t:
        return "settings"
    if "АНАЛИТИКА" in t:
        return "analytics"
    if "ПРИНЯТЬ ПЛАТ" in t or "income.js" in t:
        return "income"
    if "ПЕРЕВОД" in t and "КАСС" in t:
        return "transfer"
    if t.startswith("Matizi"):
        return "home"
    if "ПРОГНОЗ ДЕНЕЖНОГО" in t:
        return "analytics"
    raise ValueError(f"Unknown section title: {title_line!r}")


def main() -> None:
    text = SRC.read_text(encoding="utf-8")
    lines = text.splitlines(keepends=True)

    title_indices: list[int] = []
    for i, line in enumerate(lines):
        if TITLE_RE.match(line):
            title_indices.append(i)

    block_starts: list[int] = []
    block_titles: list[str] = []
    for ti in title_indices:
        bs, be = find_block_bounds(lines, ti)
        if not block_starts or bs != block_starts[-1]:
            block_starts.append(bs)
            block_titles.append(lines[ti].rstrip("\n"))

    chunks: list[tuple[str, str]] = []  # (bucket, content)
    first_start = block_starts[0]
    if first_start > 0:
        common = "".join(lines[:first_start])
        chunks.append(("common", common))

    for i, bs in enumerate(block_starts):
        end = block_starts[i + 1] if i + 1 < len(block_starts) else len(lines)
        chunk = "".join(lines[bs:end])
        bucket = classify_title(block_titles[i])
        chunks.append((bucket, chunk))

    merged: dict[str, list[str]] = {}
    for bucket, content in chunks:
        merged.setdefault(bucket, []).append(content)

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    order = [
        "login",
        "home",
        "dashboard",
        "analytics",
        "history",
        "fleet",
        "drivers",
        "income",
        "transfer",
        "add",
        "settings",
    ]

    common_text = "".join(merged.get("common", [])).rstrip() + "\n"
    SRC.write_text(common_text, encoding="utf-8")

    for name in order:
        parts = merged.get(name, [])
        body = "\n\n".join(p.rstrip() for p in parts).strip() + "\n"
        header = (
            f"/* ═══════════════════════════════════════════════\n"
            f"   screens/{name}.css — вынесено из screens.css (аудит п.8)\n"
            f"════════════════════════════════════════════════ */\n\n"
        )
        (OUT_DIR / f"{name}.css").write_text(header + body, encoding="utf-8")

    print("Wrote", SRC, "lines:", len(common_text.splitlines()))
    for name in order:
        p = OUT_DIR / f"{name}.css"
        n = len(p.read_text(encoding="utf-8").splitlines())
        print(f"  {p.relative_to(ROOT)}: {n} lines")


if __name__ == "__main__":
    main()
