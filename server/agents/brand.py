"""No brands or real people in what the game shows (V6, competition rules).

Players may name a branded game ("Jenga"): the Rule Cards keep such names only as aliases, so the
request is understood, and the game is made and shown under a generic name. Anything the agents
write (a game name, its summary, how to play, notes) goes through `scrub` before it reaches the game:
a known brand becomes its generic name. The same list drives a test over every built-in text.
"""

from __future__ import annotations

import re
from typing import Any

#: brand (lower case) -> the generic name shown instead
GENERIC: dict[str, str] = {
    "jenga": "Block tower",
    "skee-ball": "Roll-ball ramp",
    "skeeball": "Roll-ball ramp",
    "skee ball": "Roll-ball ramp",
    "mölkky": "Throwing pins",
    "molkky": "Throwing pins",
    "kerplunk": "Falling marbles",
    "hungry hungry hippos": "Marble grab",
    "connect four": "Four in a row",
    "connect 4": "Four in a row",
    "monopoly": "Property game",
    "scrabble": "Word tiles",
    "twister": "Spot game",
    "uno": "Colour cards",
    "lego": "building bricks",
    "nerf": "foam darts",
    "hot wheels": "toy cars",
    "beer pong": "Cup pong",
}

_PATTERN = re.compile(r"(?<![\w-])(" + "|".join(re.escape(b) for b in sorted(GENERIC, key=len, reverse=True)) + r")(?![\w-])", re.IGNORECASE)


def find(text: str) -> list[str]:
    """The brand names in a text (lower case), for tests and logs."""
    return [m.group(1).lower() for m in _PATTERN.finditer(text or "")]


def scrub_text(text: str) -> str:
    return _PATTERN.sub(lambda m: GENERIC[m.group(1).lower()], text) if text else text


def scrub(value: Any) -> Any:
    """Every string in a JSON-like answer, brands replaced by their generic names."""
    if isinstance(value, str):
        return scrub_text(value)
    if isinstance(value, list):
        return [scrub(v) for v in value]
    if isinstance(value, dict):
        return {k: scrub(v) for k, v in value.items()}
    return value
