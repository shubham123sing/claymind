"""ClayMind's own Rule Cards (V5): about 30 common physical games written for ClayMind, used
offline before any web search (priority 2 after the player's own rules).

- find(name): the card for a game name or one of its aliases (accents, case and spelling slips
  ignored).
- closest(text, kit_roles): the card that fits best when nothing matches by name: name
  similarity, the card's description (local embeddings when available, else words) and how many
  of the roles it needs the kit can play. So "something similar" works with no network.
"""

from __future__ import annotations

import difflib
import json
import re
import unicodedata
from pathlib import Path

from .schemas import RuleCard, Source

CARDS: list[dict] = json.loads((Path(__file__).parent / "data" / "rule-cards.json").read_text(encoding="utf-8"))["cards"]
BUILTIN = "ClayMind built-in Rule Card"


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()


def _names(card: dict) -> list[str]:
    return [norm(card["game"]), norm(card["id"].replace("-", " "))] + [norm(a) for a in card.get("aliases", [])]


def find(name: str) -> dict | None:
    n = norm(name or "")
    if not n:
        return None
    best, best_r = None, 0.0
    for c in CARDS:
        for alias in _names(c):
            if n == alias:
                return c
            r = difflib.SequenceMatcher(None, n, alias).ratio()
            if r > best_r:
                best, best_r = c, r
    return best if best_r >= 0.86 else None


def card_text(c: dict) -> str:
    return f"{c['game']}. {c['goal']} Pieces: {', '.join(c['pieces'])}. {c['setup']} {c['turns']} {c['scoring']}"


def closest(text: str, kit_roles: set[str], semantic: dict[str, float] | None = None) -> dict:
    """The best-fitting card for a name or description and a kit (never None)."""
    n = norm(text or "")
    words = set(n.split())

    def score(c: dict) -> float:
        name = max((difflib.SequenceMatcher(None, n, a).ratio() for a in _names(c)), default=0.0) if n else 0.0
        desc = len(words & set(norm(card_text(c)).split())) / max(1, len(words))
        fit = sum(1 for r in c.get("needs", []) if r in kit_roles) / max(1, len(c.get("needs", []))) if kit_roles else 0.5
        return name + 0.6 * desc + 0.5 * fit + (semantic or {}).get(c["id"], 0.0)

    return max(CARDS, key=score)


def to_rule_card(c: dict) -> RuleCard:
    return RuleCard(
        game=c["game"], goal=c["goal"], pieces=c["pieces"][:12], setup=c["setup"], turns=c["turns"], scoring=c["scoring"],
        variants=c.get("variants", [])[:6], sizes=c.get("sizes", ""), sources=[Source(title=BUILTIN, url=f"builtin:{c['id']}")],
    )
