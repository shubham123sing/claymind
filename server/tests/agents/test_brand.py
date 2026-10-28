"""No brand names in anything the game shows (V6): the filter, and every built-in text."""

import json
from pathlib import Path

from agents import brand

DATA = Path(__file__).resolve().parents[2] / "agents" / "data"


def test_scrub_replaces_brands_with_generic_names():
    out = brand.scrub({"preview": {"name": "Jenga", "howToPlay": ["Play it like Skee-ball", "no brand here"]}, "n": 3})
    assert out == {"preview": {"name": "Block tower", "howToPlay": ["Play it like Roll-ball ramp", "no brand here"]}, "n": 3}
    assert brand.scrub_text("unobtainium and a unicorn") == "unobtainium and a unicorn"  # whole words only


def test_rule_cards_show_generic_names_only():
    cards = json.loads((DATA / "rule-cards.json").read_text(encoding="utf-8"))
    cards = cards if isinstance(cards, list) else cards["cards"]
    for c in cards:
        shown = {k: v for k, v in c.items() if k not in ("id", "aliases")}
        assert not brand.find(json.dumps(shown, ensure_ascii=False)), c["id"]
    # a branded request is still understood (as an alias of the generic game)
    assert any("jenga" in c["aliases"] and c["game"] == "Block tower" for c in cards)


def test_templates_show_generic_names_only():
    text = (DATA / "game-templates.json").read_text(encoding="utf-8")
    assert not brand.find(text)
