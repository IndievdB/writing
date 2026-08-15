#!/usr/bin/env python3
"""Build the compact data files the analyzer loads at runtime.

Sources (all fetched over HTTPS, see README for licenses):
  - CMU Pronouncing Dictionary 0.7b  -> data/cmudict.txt   (word \t ARPAbet phones with stress)
  - Eric Brill's tagger lexicon      -> data/pos.txt        (word \t POS-category letters)
  - Brysbaert et al. concreteness    -> data/conc.txt       (word \t rating*100, 100..500)
  - hermitdave FrequencyWords (2018) -> data/freq.txt       (words in rank order, top N)

Run from the repo root:  python3 tools/build_data.py <source_dir>
where <source_dir> holds the four raw downloads (see fetch_sources()).
"""
import json
import re
import sys
import urllib.request
from pathlib import Path

SOURCES = {
    "cmudict-0.7b": "https://raw.githubusercontent.com/Alexir/CMUdict/master/cmudict-0.7b",
    "lexicon.js": "https://raw.githubusercontent.com/dariusk/pos-js/master/lexicon.js",
    "concreteness.txt": "https://raw.githubusercontent.com/ArtsEngine/concreteness/master/Concreteness_ratings_Brysbaert_et_al_BRM.txt",
    "en_full.txt": "https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/en/en_full.txt",
}

FREQ_TOP_N = 100_000

# Penn Treebank tag -> single-letter category used by the analyzer.
#   N noun, V verb, J adjective, R adverb, D determiner, P preposition/particle,
#   C conjunction, M modal, O pronoun, U interjection, E existential/other
TAG_MAP = {
    "NN": "N", "NNS": "N", "NNP": "N", "NNPS": "N",
    "VB": "V", "VBD": "V", "VBG": "V", "VBN": "V", "VBP": "V", "VBZ": "V",
    "JJ": "J", "JJR": "J", "JJS": "J",
    "RB": "R", "RBR": "R", "RBS": "R", "WRB": "R",
    "DT": "D", "PDT": "D", "WDT": "D",
    "IN": "P", "TO": "P", "RP": "P",
    "CC": "C",
    "MD": "M",
    "PRP": "O", "PRP$": "O", "WP": "O", "WP$": "O", "PP": "O", "PP$": "O",
    "UH": "U",
    "EX": "E", "CD": "E", "FW": "E", "POS": "E", "LS": "E", "SYM": "E",
}

WORD_RE = re.compile(r"^[a-z][a-z'\-]*$")


def fetch_sources(src_dir: Path) -> None:
    src_dir.mkdir(parents=True, exist_ok=True)
    for name, url in SOURCES.items():
        dest = src_dir / name
        if dest.exists():
            continue
        print(f"fetching {url}")
        urllib.request.urlretrieve(url, dest)


def build_cmudict(src: Path, out: Path) -> None:
    lines = []
    for raw in src.read_text(encoding="latin-1").splitlines():
        if raw.startswith(";;;") or not raw.strip():
            continue
        head, _, phones = raw.partition("  ")
        word = head.strip().lower()
        if word.endswith(")"):  # alternate pronunciation e.g. WORD(2) — keep primary only
            continue
        if not WORD_RE.match(word):
            continue
        lines.append(f"{word}\t{phones.strip()}")
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"cmudict: {len(lines)} words -> {out}")


def build_pos(src: Path, out: Path) -> None:
    text = src.read_text(encoding="utf-8", errors="replace")
    text = text[text.index("{"):]           # strip "module.exports = "
    text = text.rstrip().rstrip(";")
    text = text.replace("\\'", "'")         # JS escape that is invalid JSON
    lexicon = json.loads(text)
    merged: dict[str, set[str]] = {}
    for word, tags in lexicon.items():
        w = word.lower()
        if not WORD_RE.match(w):
            continue
        cats = {TAG_MAP[t] for t in tags if t in TAG_MAP}
        if cats:
            merged.setdefault(w, set()).update(cats)
    lines = [f"{w}\t{''.join(sorted(cs))}" for w, cs in sorted(merged.items())]
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"pos: {len(lines)} words -> {out}")


def build_concreteness(src: Path, out: Path) -> None:
    lines = []
    for raw in src.read_text(encoding="utf-8", errors="replace").splitlines()[1:]:
        parts = raw.split("\t")
        if len(parts) < 3 or parts[1] != "0":   # skip bigrams
            continue
        word = parts[0].lower()
        if not WORD_RE.match(word):
            continue
        try:
            rating = round(float(parts[2]) * 100)
        except ValueError:
            continue
        lines.append(f"{word}\t{rating}")
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"concreteness: {len(lines)} words -> {out}")


def build_freq(src: Path, out: Path) -> None:
    words = []
    seen = set()
    for raw in src.read_text(encoding="utf-8", errors="replace").splitlines():
        word = raw.split(" ", 1)[0].lower()
        if word in seen or not WORD_RE.match(word):
            continue
        seen.add(word)
        words.append(word)
        if len(words) >= FREQ_TOP_N:
            break
    out.write_text("\n".join(words) + "\n", encoding="utf-8")
    print(f"freq: {len(words)} words -> {out}")


def main() -> None:
    repo = Path(__file__).resolve().parent.parent
    src_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else repo / "tools" / "sources"
    fetch_sources(src_dir)
    data = repo / "data"
    data.mkdir(exist_ok=True)
    build_cmudict(src_dir / "cmudict-0.7b", data / "cmudict.txt")
    build_pos(src_dir / "lexicon.js", data / "pos.txt")
    build_concreteness(src_dir / "concreteness.txt", data / "conc.txt")
    build_freq(src_dir / "en_full.txt", data / "freq.txt")


if __name__ == "__main__":
    main()
