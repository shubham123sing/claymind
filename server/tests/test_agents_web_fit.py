"""Step 5 fixes: the Researcher reads the game's own page first, and an over-long answer is
trimmed to the schema instead of being thrown away."""

import asyncio

import httpx

from agents.flows import fit_to_schema
from agents.schemas import RuleCard
from agents.web import search_pages

PAGES = {
    "Kubb": "Kubb is a lawn game where the objective is to knock over wooden blocks by throwing batons.",
    "Kubb (disambiguation)": "Kubb may refer to: a game, a block.",
    "Throwing sports": "Throwing sports are sports where players throw things.",
    "List of sports": "A list of sports and games.",
    "Nothingball": "Nothingball is a town in a valley.",
}


def _handler(request: httpx.Request) -> httpx.Response:
    q = dict(request.url.params)
    if q.get("list") == "search":
        hits = ["Throwing sports", "Kubb", "List of sports"]
        return httpx.Response(200, json={"query": {"search": [{"title": t} for t in hits]}})
    t = q["titles"]
    return httpx.Response(200, json={"query": {"pages": {"1": {"title": t, "extract": PAGES.get(t, "")}}}})


def _search(name: str) -> list[str]:
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(_handler)) as c:
            return [p["title"] for p in await search_pages(f"{name} game rules", c, exact=name)]

    return asyncio.run(run())


def test_the_games_own_page_comes_first():
    assert _search("Kubb") == ["Kubb", "Throwing sports"]


def test_a_page_with_that_name_that_is_not_a_game_is_skipped():
    assert _search("Nothingball") == ["Throwing sports", "Kubb"]


def test_over_long_answers_are_trimmed_to_the_schema():
    data = {"game": "Kubb", "goal": "g" * 500, "pieces": ["block"] * 20, "setup": "s" * 900, "turns": "t", "scoring": "c",
            "sources": [{"title": "T" * 300, "url": "https://en.wikipedia.org/wiki/Kubb"}]}
    card = RuleCard.model_validate(fit_to_schema(RuleCard, data))
    assert len(card.goal) == 300 and card.goal.endswith("…")
    assert len(card.pieces) == 12
    assert len(card.setup) == 400
