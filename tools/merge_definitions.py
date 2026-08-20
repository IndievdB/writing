#!/usr/bin/env python3
"""Merge curated definition chunk files into data/definitions.txt.

Usage: python3 tools/merge_definitions.py <dir>
Files def-*.txt: word\tP\tdefinition. Keeps at most 3 per headword.
"""
import re
import sys
from pathlib import Path

LINE_RE = re.compile(r"^([a-z][a-z'\-]*)\t([NVJR]?)\t([\x20-\x7e’–—]{3,140})$")

def main() -> None:
    repo = Path(__file__).resolve().parent.parent
    src = Path(sys.argv[1])
    merged: dict[str, list[tuple[str, str]]] = {}
    bad = 0
    for f in sorted(src.glob("def-*.txt")):
        for raw in f.read_text().splitlines():
            if not raw.strip():
                continue
            m = LINE_RE.match(raw)
            if not m:
                bad += 1
                continue
            word, pos, gloss = m.groups()
            gloss = gloss.strip().rstrip('.')
            lst = merged.setdefault(word, [])
            if len(lst) < 3 and all(g != gloss for _p, g in lst):
                lst.append((pos, gloss))
    out = repo / "data" / "definitions.txt"
    lines = [f"{w}\t{p}\t{g}" for w, defs in sorted(merged.items()) for p, g in defs]
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"definitions: {len(lines)} lines, {len(merged)} headwords -> {out}")
    print(f"rejected: {bad} malformed lines")

if __name__ == "__main__":
    main()
