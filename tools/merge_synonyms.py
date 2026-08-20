#!/usr/bin/env python3
"""Merge Claude-generated synonym chunk files into data/synonyms.txt.

Usage: python3 tools/merge_synonyms.py <chunk_dir> [<refine_dir>]

Chunk files (out-*.txt) contain lines: word\tP\tsyn syn syn   (P in NVJR).
Validation: format, headword sanity, synonyms restricted to single lowercase
words present in the pronouncing dictionary (the finder filters by sound, so
words without phonemes are dead weight), no self/derivative echoes.

refine_dir files (refined-*.txt) are curation passes over existing entries:
their lines REPLACE the merged lines for any (word, pos) they cover.
"""
import re
import sys
from pathlib import Path

LINE_RE = re.compile(r"^([a-z]+)\t([NVJR])\t([a-z ]+)$")
DERIV = ('s', 'es', 'ed', 'd', 'ing', 'er', 'ers', 'ly', 'ness', 'way')


def same_family(a: str, b: str) -> bool:
    if a == b:
        return True
    a, b = (a, b) if len(a) <= len(b) else (b, a)
    for base in (a, a[:-1], a + a[-1]):   # exact, e-dropped, consonant-doubled
        if b.startswith(base):
            rest = b[len(base):]
            if rest in DERIV or len(rest) <= 1:
                return True
    return False


def main() -> None:
    repo = Path(__file__).resolve().parent.parent
    chunk_dir = Path(sys.argv[1])
    cmu = {l.split("\t", 1)[0] for l in (repo / "data" / "cmudict.txt").read_text().splitlines() if l}

    merged: dict[tuple[str, str], list[str]] = {}
    bad_lines = dropped_syns = 0

    def clean_line(raw):
        nonlocal bad_lines, dropped_syns
        m = LINE_RE.match(raw)
        if not m:
            bad_lines += 1
            return None
        word, pos, syn_str = m.groups()
        syns = []
        for s in syn_str.split():
            if s == word or same_family(word, s) or s not in cmu or len(s) < 2:
                dropped_syns += 1
                continue
            if s not in syns:
                syns.append(s)
        return (word, pos, syns) if syns else None

    for f in sorted(chunk_dir.glob("out-*.txt")):
        for raw in f.read_text().splitlines():
            if not raw.strip():
                continue
            parsed = clean_line(raw)
            if not parsed:
                continue
            word, pos, syns = parsed
            existing = merged.setdefault((word, pos), [])
            for s in syns:
                if s not in existing:
                    existing.append(s)

    # Refinement pass: replaces merged lines for covered headwords entirely
    # (a refined headword's absent POS line means "that line was wrong").
    if len(sys.argv) > 2:
        refine_dir = Path(sys.argv[2])
        refined_words = set()
        refined: dict[tuple[str, str], list[str]] = {}
        for f in sorted(refine_dir.glob("refined-*.txt")):
            for raw in f.read_text().splitlines():
                if not raw.strip():
                    continue
                parsed = clean_line(raw)
                if not parsed:
                    continue
                word, pos, syns = parsed
                refined_words.add(word)
                refined.setdefault((word, pos), []).extend(
                    s for s in syns if s not in refined.get((word, pos), []))
        merged = {k: v for k, v in merged.items() if k[0] not in refined_words}
        merged.update(refined)
        print(f"refined: {len(refined_words)} headwords replaced")

    out = repo / "data" / "synonyms.txt"
    lines = [f"{w}\t{p}\t{' '.join(syns)}" for (w, p), syns in sorted(merged.items())]
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    headwords = len({w for (w, _p) in merged})
    total_syns = sum(len(v) for v in merged.values())
    print(f"synonyms: {len(lines)} lines, {headwords} headwords, {total_syns} synonym links -> {out}")
    print(f"rejected: {bad_lines} malformed lines, {dropped_syns} bad synonyms")


if __name__ == "__main__":
    main()


# Definitions merge is separate: tools/merge_definitions.py
