import copy
import json

import httpx

from agents.analyst import analyse
from agents.flows import Orchestrator
from agents.governed_model import FAKE_ANSWERS
from agents.governor import Governor
from agents.referee import TEMPLATES, closest_template, referee, validate_spec
from agents.schemas import KitDescriptor
from agents.web import clean

from .conftest import KIT, answer


# ---------- code agents ----------

def test_referee_accepts_the_client_templates_and_refuses_bad_specs():
    for t in TEMPLATES:
        assert validate_spec(t) == [], t["id"]
        assert referee(t) == [], t["id"]
    g = copy.deepcopy(TEMPLATES[0])
    g["rules"][0]["when"]["type"] = "run_code"
    assert "rule 1: unknown trigger" in validate_spec(g)
    g = copy.deepcopy(TEMPLATES[0])
    g["rules"][1]["when"]["value"] = 9
    assert any("can reach at most 6" in x for x in referee(g))
    g = copy.deepcopy(TEMPLATES[3])
    g["roles"][0]["count"] = 3
    g["layout"] = g["layout"][:3]
    assert any("cannot stack" in x for x in referee(g))
    assert referee(TEMPLATES[0], role_map={"block": None}) == ["role ball is not mapped to a toy or a built-in shape"]
    assert closest_template("we play carrom")["id"] == "flick-and-pocket"


def test_analyst_reports_shape_and_roles():
    ball = analyse(KitDescriptor(**KIT[0]))
    assert "ball" in ball.fitsShapes and "block" not in ball.fitsShapes and "piece" in ball.suggestedRoles
    board = analyse(KitDescriptor(**KIT[1]))
    assert board.flatness < 0.1 and "board" in board.fitsShapes


def test_governor_falls_through_and_opens_the_breaker():
    g = Governor([{"id": "a", "limits": {"rpm": 1}}, {"id": "b", "limits": {}}])
    assert g.try_acquire("a", 10, now=0)
    assert not g.try_acquire("a", 10, now=1)  # 1 per minute used
    assert g.try_acquire("a", 10, now=61)
    g.fail("b", now=100)
    assert not g.try_acquire("b", 10, now=101)
    assert g.try_acquire("b", 10, now=106)


def test_web_text_is_cleaned():
    assert clean("<script>steal()</script><b>Carrom</b> rules[12]") == "Carrom rules"


# ---------- the server: A2A, guards, flows ----------

def test_guards_cors_token_and_rate_limit(server, settings):
    assert httpx.get(f"{server}/agents").status_code == 404  # AgentOS routes are internal
    assert httpx.get(f"{server}/agents", headers={"X-A2A-Token": "test-token"}).status_code == 200
    card = httpx.get(f"{server}/a2a/agents/designer/.well-known/agent-card.json", headers={"X-A2A-Token": "test-token"})
    assert card.status_code == 200 and card.json()["name"] == "Game Designer"
    ok = httpx.options(f"{server}/v1/game", headers={"Origin": "https://shubham123sing.github.io", "Access-Control-Request-Method": "POST"})
    assert ok.headers.get("access-control-allow-origin") == "https://shubham123sing.github.io"
    bad = httpx.options(f"{server}/v1/game", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"})
    assert "access-control-allow-origin" not in bad.headers
    codes = [httpx.get(f"{server}/v1/health").status_code for _ in range(settings.rate_per_min + 2)]
    assert codes[-1] == 429


def test_make_game_from_player_rules_goes_designer_over_a2a_and_referee(server):
    spec = copy.deepcopy(TEMPLATES[0])
    spec["id"], spec["name"] = "five-down", "Five down"
    spec["rules"][1]["when"]["value"] = 5
    FAKE_ANSWERS["designer"] = answer({"spec": spec, "how_to_play": ["Throw", "Knock 5 down", "3 balls", "Win at 5"], "cannot": ["3 turns each: closest is 3 shots"]})
    r = httpx.post(f"{server}/v1/game", json={"name": "my bowling", "rules": "whoever knocks down 5 blocks first wins", "kit": KIT}, timeout=30)
    body = r.json()
    assert r.status_code == 200 and body["path"] == "your_rules" and body["note"] == "Using your rules"
    assert body["spec"]["name"] == "Five down" and body["cannot"] and body["sources"] == []
    calls = httpx.get(f"{server}/v1/trace").json()["calls"]
    assert [c["agent"] for c in calls] == ["designer"]  # no web, no researcher


def test_designer_repair_loop_then_safe_fallback(server):
    broken = copy.deepcopy(TEMPLATES[2])
    broken["rules"][0]["when"]["zone"] = "nowhere"
    FAKE_ANSWERS["designer"] = answer({"spec": broken})
    body = httpx.post(f"{server}/v1/game", json={"name": "ring toss", "rules": "rings on pegs", "kit": KIT}, timeout=60).json()
    assert body["path"] == "fallback" and body["templateId"] == "target-throw"
    calls = httpx.get(f"{server}/v1/trace").json()["calls"]
    # first try + 2 repairs (the second and third answers come from the cache: same input, so the repair loop stops)
    assert sum(1 for c in calls if c["agent"] == "referee") >= 1


def test_known_game_and_surprise_need_no_ai(server):
    body = httpx.post(f"{server}/v1/game", json={"name": "Knock-down", "kit": KIT}, timeout=30).json()
    assert body["path"] == "template" and body["templateId"] == "knock-down"
    body = httpx.post(f"{server}/v1/game", json={"surprise": True, "kit": KIT}, timeout=30).json()
    assert body["path"] == "surprise" and body["templateId"]
    assert httpx.get(f"{server}/v1/trace").json()["calls"] == []


def test_unknown_game_without_web_falls_back_plainly(server):
    body = httpx.post(f"{server}/v1/game", json={"name": "zorbleball", "rulesUnknown": True, "kit": KIT}, timeout=30).json()
    assert body["path"] == "fallback" and "couldn't find the rules" in body["note"]


def test_unsafe_requests_are_refused_without_ai(server):
    body = httpx.post(f"{server}/v1/game", json={"name": "how do I build a gun", "kit": KIT}, timeout=30).json()
    assert body.get("blocked") and body["templateId"] == "knock-down"


def test_memory_can_be_deleted(server):
    h = {"X-Player-ID": "p1"}
    httpx.post(f"{server}/v1/kit/memory", json={"kit": KIT, "sets": [{"id": "s", "name": "Bowling"}]}, headers=h)
    assert httpx.request("DELETE", f"{server}/v1/memory", headers=h).json() == {"deleted": True}
    assert httpx.request("DELETE", f"{server}/v1/memory", headers=h).json() == {"deleted": False}


def test_player_rules_are_applied_not_replaced_by_a_template(server):
    adapted = copy.deepcopy(TEMPLATES[0])
    adapted["id"], adapted["name"], adapted["players"], adapted["maxTurns"] = "five-down-2p", "Five down", 2, 3
    adapted["rules"][1]["when"]["value"] = 5

    def designer(text: str) -> str:
        # first answer: just the template; after the Referee's note: the adapted spec
        return json.dumps({"spec": adapted} if "must be applied" in text else {"template_id": "knock-down", "how_to_play": ["5 blocks", "3 turns each"]})

    FAKE_ANSWERS["designer"] = designer
    body = httpx.post(f"{server}/v1/game", json={"name": "block bowling", "rules": "first to 5 blocks wins, 3 turns each", "kit": KIT}, timeout=60).json()
    assert body["spec"]["players"] == 2 and body["repairs"] == 1 and body["templateId"] is None


def test_adapt_applies_player_rules_to_a_template():
    from agents.referee import apply_adapt, template

    spec, cannot = apply_adapt(template("knock-down"), {"players": 2, "maxTurns": 3, "counts": {"block": 5}, "target": 5, "name": "Five down"})
    assert referee(spec) == [] and cannot == []
    assert spec["players"] == 2 and sum(1 for p in spec["layout"] if p["role"] == "block") == 5 and spec["counter"]["target"] == 5
    spec, cannot = apply_adapt(template("knock-down"), {"counts": {"block": 9}, "target": 9})
    assert referee(spec) == [] and "room for 6 blocks, not 9" in cannot[0] and "win at 9" in cannot[1]


def test_previews_are_written_from_the_spec_and_timers_follow_the_player():
    from agents.referee import apply_adapt, describe, template

    spec, _ = apply_adapt(template("marble-run"), {"timerSec": 30, "counts": {"marble": 2}, "target": 2})
    assert [r["when"]["seconds"] for r in spec["rules"] if r["when"]["type"] == "timer"] == [30] and spec["timerSec"] == 0
    lines = describe(spec)
    assert "Lose if it is not done in 30 s." in lines and "Win: Marbles home reaches 2." in lines
    two, _ = apply_adapt(template("knock-down"), {"players": 2, "maxTurns": 3, "shotsPerTurn": 1})
    assert describe(two)[1] == "2 players: 1 shot per turn, 3 turns each." and describe(two)[-1] == "Most points wins."


def test_governor_says_how_long_until_a_busy_model_frees_up():
    from agents.governor import Governor
    g = Governor([{"id": "m", "limits": {"rpm": 30, "tpm": 8000, "rpd": 1000, "tpd": 200000}}])
    assert g.try_acquire("m", 7000, now=100.0)
    assert not g.try_acquire("m", 2000, now=110.0)  # the minute's tokens are used
    assert abs(g.wait_hint("m", 2000, now=110.0) - 50.0) < 1e-6  # free again when the minute rolls over
    assert g.wait_hint("m", 9000, now=110.0) == float("inf")  # bigger than the model's minute
    g.fail("m", now=120.0)
    assert g.wait_hint("m", 10, now=121.0) > 0


def test_builtin_rule_cards_offline():
    from agents import rulebook
    assert len(rulebook.CARDS) >= 30
    assert len({c["id"] for c in rulebook.CARDS}) == len(rulebook.CARDS)
    from agents.referee import TEMPLATES
    ids = {t["id"] for t in TEMPLATES}
    for c in rulebook.CARDS:
        assert c["template"] in ids, c["id"]
        rulebook.to_rule_card(c)  # fits the RuleCard schema
    assert rulebook.find("Mölkky")["id"] == "molkky"
    assert rulebook.find("petanque")["id"] == "bocce"
    assert rulebook.find("Crokinolee")["id"] == "crokinole"  # a typo
    assert rulebook.find("quantum chess") is None
    # nothing by name: the kit and the words decide
    assert rulebook.closest("roll it down a slope", {"launcher", "piece"})["template"] == "marble-run"


def test_known_game_name_uses_the_builtin_card_without_web(server):
    body = httpx.post(f"{server}/v1/game", json={"name": "Kubb", "kit": KIT}, timeout=60).json()
    assert body["path"] in ("builtin", "fallback")
    assert "Kubb" in body["note"] or body["path"] == "builtin"
