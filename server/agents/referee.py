"""Referee (code, no AI): checks a Game Spec before it is offered to the player.

`validate_spec` is a line-by-line port of the client's validateSpec
(client/src/playkit/game-spec.ts). On top, `referee` checks the game can be played:
every role is mapped to a kit item or a built-in shape, counters the win needs can be
reached with the pieces there are, a tower height can be stacked. The vocabulary and the
five templates come from data/game-templates.json, exported from the client.
A physics dry run happens in the client (it has the physics engine), not here.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

DATA = json.loads((Path(__file__).resolve().parent / "data" / "game-templates.json").read_text(encoding="utf-8"))
SPEC_VERSION: int = DATA["specVersion"]
VOCAB: dict = DATA["vocabulary"]
TEMPLATES: list[dict] = DATA["templates"]
REACH = 0.8


def _num(x) -> bool:
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)


def _int(x) -> bool:
    return isinstance(x, int) and not isinstance(x, bool)


def _vec(x) -> bool:
    return isinstance(x, list) and len(x) == 3 and all(_num(v) for v in x)


def _text(x, n: int) -> bool:
    return isinstance(x, str) and x.strip() != "" and len(x) <= n


def validate_spec(g: object) -> list[str]:
    e: list[str] = []
    if not isinstance(g, dict):
        return ["not a game spec"]
    if g.get("specVersion") != SPEC_VERSION:
        e.append(f"specVersion must be {SPEC_VERSION}")
    if not _text(g.get("id"), 40):
        e.append("id missing")
    if not _text(g.get("name"), 40):
        e.append("name missing")
    if not isinstance(g.get("summary"), str) or len(g["summary"]) > 120:
        e.append("summary too long")
    h = g.get("howToPlay")
    if not isinstance(h, list) or not 1 <= len(h) <= 6 or not all(_text(l, 90) for l in h):
        e.append("howToPlay needs 1-6 short lines")
    if not _int(g.get("players")) or not 1 <= g["players"] <= 4:
        e.append("players must be 1-4")
    if not _int(g.get("shotsPerTurn")) or not 0 <= g["shotsPerTurn"] <= 20:
        e.append("shotsPerTurn must be 0-20")
    if not _int(g.get("maxTurns")) or not 0 <= g["maxTurns"] <= 30:
        e.append("maxTurns must be 0-30")
    if not _num(g.get("timerSec")) or not 0 <= g["timerSec"] <= 600:
        e.append("timerSec must be 0-600")
    aa = g.get("allowedActions")
    if not isinstance(aa, list) or not all(a in VOCAB["handActions"] for a in aa):
        e.append("unknown hand action")

    roles: dict[str, dict] = {}
    rl = g.get("roles")
    if not isinstance(rl, list) or not 1 <= len(rl) <= 6:
        e.append("roles must be 1-6")
    else:
        total = 0
        for r in rl:
            rid = r.get("id") if isinstance(r, dict) else None
            if not _text(rid, 24) or rid in roles:
                e.append("role id missing or repeated")
                continue
            roles[rid] = r
            if not _text(r.get("label"), 30):
                e.append(f"role {rid}: label missing")
            if not _int(r.get("count")) or not 1 <= r["count"] <= 12:
                e.append(f"role {rid}: count must be 1-12")
            total += r.get("count") if _int(r.get("count")) else 0
            if not isinstance(r.get("tags"), list) or not all(t in VOCAB["roleTags"] for t in r["tags"]):
                e.append(f"role {rid}: unknown tag")
            if r.get("fallback") not in VOCAB["fallbackShapes"]:
                e.append(f"role {rid}: unknown built-in shape")
            if not isinstance(r.get("material"), str):
                e.append(f"role {rid}: material missing")
            if "respawnAt" in r and r["respawnAt"] is not None and not _vec(r["respawnAt"]):
                e.append(f"role {rid}: bad respawn point")
            if "handHeld" in r and r["handHeld"] is not None and not isinstance(r["handHeld"], bool):
                e.append(f"role {rid}: handHeld must be true or false")
        if total > 30:
            e.append("at most 30 pieces")

    zones: set[str] = set()
    zone_values: dict[str, float] = {}
    zl = g.get("zones")
    if not isinstance(zl, list) or len(zl) > 8:
        e.append("zones must be 0-8")
    else:
        for z in zl:
            zid = z.get("id") if isinstance(z, dict) else None
            if not _text(zid, 24) or zid in zones:
                e.append("zone id missing or repeated")
                continue
            zones.add(zid)
            if z.get("shape") not in ("box", "cylinder"):
                e.append(f"zone {zid}: shape must be box or cylinder")
            c = z.get("center")
            if not _vec(c) or math.hypot(c[0], c[2]) > REACH:
                e.append(f"zone {zid}: centre off the table")
            sz = z.get("size")
            if not _vec(sz) or sz[0] <= 0 or sz[1] <= 0:
                e.append(f"zone {zid}: bad size")
            if z.get("value") is not None:
                if not _num(z["value"]) or abs(z["value"]) > 100:
                    e.append(f"zone {zid}: value must be -100 to 100")
                else:
                    zone_values[zid] = z["value"]

    lay = g.get("layout")
    if not isinstance(lay, list):
        e.append("layout missing")
    else:
        placed: dict[str, int] = {}
        for p in lay:
            role = p.get("role") if isinstance(p, dict) else None
            if role not in roles:
                e.append(f"layout: unknown role {role}")
                continue
            at = p.get("at")
            if not _vec(at) or math.hypot(at[0], at[2]) > REACH or at[1] < 0 or at[1] > 0.5:
                e.append(f"layout: {role} placed off the table")
            placed[role] = placed.get(role, 0) + 1
        for rid, r in roles.items():
            if placed.get(rid, 0) != r.get("count"):
                e.append(f"layout: {rid} needs exactly {r.get('count')} place(s)")

    counters: set[str] = set()
    rules = g.get("rules")
    if not isinstance(rules, list) or not 1 <= len(rules) <= 24:
        e.append("rules must be 1-24")
    else:
        for rule in rules:
            for a in (rule.get("do") or []) if isinstance(rule, dict) else []:
                if isinstance(a, dict) and a.get("type") == "add_score" and a.get("counter"):
                    counters.add(a["counter"])
        ends = (g.get("maxTurns") or 0) > 0 or (g.get("timerSec") or 0) > 0
        for i, rule in enumerate(rules, 1):
            t = rule.get("when") if isinstance(rule, dict) else None
            if not isinstance(t, dict) or t.get("type") not in VOCAB["triggers"]:
                e.append(f"rule {i}: unknown trigger")
                continue
            tt = t["type"]
            if "role" in t and t["role"] is not None and t["role"] not in roles:
                e.append(f"rule {i}: unknown role {t['role']}")
            if tt in ("enters_zone", "leaves_zone") and t.get("zone") not in zones:
                e.append(f"rule {i}: unknown zone {t.get('zone')}")
            if tt == "hit_by" and t.get("by") not in roles:
                e.append(f"rule {i}: unknown role {t.get('by')}")
            if tt in ("falls_below_height", "stack_height_reached") and (not _num(t.get("height")) or not 0 <= t["height"] <= 1):
                e.append(f"rule {i}: bad height")
            if tt == "timer" and (not _num(t.get("seconds")) or not 0 < t["seconds"] <= 600):
                e.append(f"rule {i}: bad timer")
            if tt == "tilt_exceeded" and (not _num(t.get("degrees")) or not 5 <= t["degrees"] <= 90):
                e.append(f"rule {i}: tilt must be 5-90 degrees")
            zone_valued = tt in ("enters_zone", "leaves_zone") and t.get("zone") in zone_values
            if tt == "count_reached" and (t.get("counter") not in counters or not _int(t.get("value")) or t["value"] < 1):
                e.append(f"rule {i}: counter {t.get('counter')} is never counted")
            acts = rule.get("do")
            if not isinstance(acts, list) or not 1 <= len(acts) <= 6:
                e.append(f"rule {i}: needs 1-6 actions")
                continue
            for a in acts:
                at = a.get("type") if isinstance(a, dict) else None
                if at not in VOCAB["actions"]:
                    e.append(f"rule {i}: unknown action")
                elif at == "add_score" and ((a.get("points") is not None and (not _num(a["points"]) or abs(a["points"]) > 100)) or (a.get("points") is None and not a.get("counter") and not zone_valued)):
                    e.append(f"rule {i}: add_score needs points, a counter or a zone with a value")
                elif at == "show_message" and not _text(a.get("text"), 60):
                    e.append(f"rule {i}: message missing or too long")
                elif at in ("respawn", "reset_piece") and tt in ("timer", "count_reached", "stack_height_reached"):
                    e.append(f"rule {i}: {at} needs a piece trigger")
                if at in ("win", "lose"):
                    ends = True
        if not ends:
            e.append("the game can never end (add a win/lose rule, turns or a time limit)")
    pl = g.get("paths")
    if pl is not None:
        if not isinstance(pl, list) or len(pl) > 4:
            e.append("paths must be 0-4")
        else:
            for p in pl:
                pts = p.get("points") if isinstance(p, dict) else None
                if not _text(p.get("id") if isinstance(p, dict) else None, 24) or not isinstance(pts, list) or not 2 <= len(pts) <= 12:
                    e.append("a path needs an id and 2-12 points")
                elif any(not _vec(q) or math.hypot(q[0], q[2]) > REACH for q in pts):
                    e.append(f"path {p['id']}: off the table")
    c = g.get("counter")
    if c is not None and (not isinstance(c, dict) or not _text(c.get("id"), 24) or not _text(c.get("label"), 30)):
        e.append("counter needs an id and a label")
    return e


def referee(spec: dict, role_map: dict[str, str | None] | None = None, kit_ids: set[str] | None = None) -> list[str]:
    """validate_spec plus playability: role mapping, reachable counters and heights."""
    e = validate_spec(spec)
    if e:
        return e
    roles = {r["id"]: r for r in spec["roles"]}
    if role_map is not None:
        for rid in roles:
            if rid not in role_map:
                e.append(f"role {rid} is not mapped to a toy or a built-in shape")
            elif role_map[rid] is not None and kit_ids is not None and role_map[rid] not in kit_ids:
                e.append(f"role {rid}: the kit has no item {role_map[rid]}")
    # how often can each counter go up? once per piece of the counted role, unless that piece respawns
    for rule in spec["rules"]:
        t = rule["when"]
        if t["type"] == "count_reached":
            best = 0
            for r2 in spec["rules"]:
                for a in r2["do"]:
                    if a["type"] == "add_score" and a.get("counter") == t["counter"]:
                        role = r2["when"].get("role")
                        repeats = any(x["type"] in ("respawn", "reset_piece") for x in r2["do"])
                        best = 10_000 if repeats or role is None else best + roles[role]["count"]
            if best < t["value"]:
                e.append(f"counter {t['counter']} can reach at most {best}, the rule needs {t['value']}")
        if t["type"] == "stack_height_reached":
            size = VOCAB["fallbackSizeM"][roles[t["role"]]["fallback"]]
            if roles[t["role"]]["count"] * size < t["height"]:
                e.append(f"{roles[t['role']]['count']} {t['role']} pieces cannot stack {t['height']} m high")
    return e


def apply_adapt(t: dict, adapt: dict) -> tuple[dict, list[str]]:
    """A template with the Designer's changes (players, turns, counts, win target). Returns the
    new spec and what could not be done (e.g. more pieces than the layout has places for)."""
    import copy

    g = copy.deepcopy(t)
    cannot: list[str] = []
    for k in ("players", "shotsPerTurn", "maxTurns"):
        if adapt.get(k) is not None:
            g[k] = adapt[k]
    if adapt.get("timerSec") is not None:
        timers = [r["when"] for r in g["rules"] if r["when"]["type"] == "timer"]
        if timers and adapt["timerSec"] > 0:
            for w in timers:  # the template's own clock (e.g. "lose at 60 s") becomes the player's
                w["seconds"] = adapt["timerSec"]
        else:
            g["timerSec"] = adapt["timerSec"]
    counts = dict(adapt.get("counts") or {})
    target = adapt.get("target")
    if target and g.get("counter"):
        # the player's win target outranks a piece count they did not ask for: pieces that score on
        # the win counter are kept up to the template's own number
        cid = g["counter"]["id"]
        for rule in g["rules"]:
            role = rule["when"].get("role")
            if role in counts and any(a["type"] == "add_score" and a.get("counter") == cid for a in rule["do"]):
                full = next(r["count"] for r in g["roles"] if r["id"] == role)
                counts[role] = max(counts[role], min(target, full))
    for rid, n in counts.items():
        role = next((r for r in g["roles"] if r["id"] == rid), None)
        if role is None:
            cannot.append(f"no part called {rid} in {t['name']}")
            continue
        if n > role["count"]:
            cannot.append(f"{t['name']} has room for {role['count']} {role['label'].lower()}, not {n}")
            n = role["count"]
        keep, seen = [], 0
        for p in g["layout"]:
            if p["role"] == rid:
                seen += 1
                if seen > n:
                    continue
            keep.append(p)
        g["layout"], role["count"] = keep, max(1, n)
    win_rule = False
    for rule in g["rules"]:
        w = rule["when"]
        if w["type"] == "count_reached":
            win_rule = win_rule or any(a["type"] == "win" for a in rule["do"])
            if adapt.get("target") is not None:
                w["value"] = adapt["target"]
            if g.get("counter", {}).get("id") == w["counter"]:
                g["counter"]["target"] = w["value"]
    if adapt.get("target") and not win_rule and g.get("counter"):
        # a points game with no "win at": its own counter reaching the target wins (said plainly)
        n, c = adapt["target"], g["counter"]
        g["rules"].append({"when": {"type": "count_reached", "counter": c["id"], "value": n},
                           "do": [{"type": "show_message", "text": f"{n} {c['label'].lower()}: you win!"}, {"type": "win"}]})
        c["target"] = n
        cannot.append(f"win at {n} counts {c['label'].lower()}, not points")
    # a counter cannot need more than there are pieces of the counted role
    for rule in g["rules"]:
        w = rule["when"]
        if w["type"] == "count_reached":
            for r2 in g["rules"]:
                role = r2["when"].get("role")
                if role and any(a["type"] == "add_score" and a.get("counter") == w["counter"] for a in r2["do"]) and not any(a["type"] in ("respawn", "reset_piece") for a in r2["do"]):
                    cnt = next(r["count"] for r in g["roles"] if r["id"] == role)
                    if w["value"] > cnt:
                        cannot.append(f"win at {w['value']} needs more {role} pieces: now {cnt}")
                        w["value"] = cnt
    if adapt.get("name"):
        g["name"] = adapt["name"][:40]
    g["id"] = f"{t['id']}-custom"
    return g, cannot


def describe(g: dict) -> list[str]:
    """How to play, written from the spec itself (so it is always true), 4 lines at most."""
    lines = [g["howToPlay"][0]]
    who = f"{g['players']} players" if g["players"] > 1 else "1 player"
    if g["shotsPerTurn"] > 0:
        turns = f", {g['maxTurns']} turn{'s' if g['maxTurns'] != 1 else ''} each" if g["maxTurns"] else ""
        lines.append(f"{who}: {g['shotsPerTurn']} shot{'s' if g['shotsPerTurn'] != 1 else ''} per turn{turns}.")
    else:
        lines.append(f"{who}, no turns.")
    roles = {r["id"]: r for r in g["roles"]}
    for rule in g["rules"]:
        w, acts = rule["when"], [a["type"] for a in rule["do"]]
        if w["type"] == "count_reached" and "win" in acts:
            label = (g.get("counter") or {}).get("label", w["counter"]) if (g.get("counter") or {}).get("id") == w["counter"] else w["counter"]
            lines.append(f"Win: {label} reaches {w['value']}.")
        elif w["type"] == "timer" and "lose" in acts:
            lines.append(f"Lose if it is not done in {w['seconds']:g} s.")
        elif w["type"] == "stack_height_reached" and "win" in acts:
            lines.append(f"Win: stack {roles[w['role']]['label'].lower()} {round(w['height'] * 100)} cm high.")
        elif w["type"] == "leaves_zone" and "lose" in acts:
            lines.append("Lose if a piece falls out.")
    if g["timerSec"]:
        lines.append(f"The game ends after {g['timerSec']:g} s.")
    if g["players"] > 1:
        lines.append("Most points wins.")
    return lines[:4]


def template(tid: str) -> dict | None:
    return next((t for t in TEMPLATES if t["id"] == tid), None)


def closest_template(words: str) -> dict:
    """The safe fallback: the built-in game whose name / summary shares most words."""
    w = {x for x in words.lower().replace("-", " ").split() if len(x) > 2}
    hints = {
        "knock-down": {"bowling", "skittles", "knock", "tower", "throw", "topple", "pins"},
        "flick-and-pocket": {"carrom", "flick", "pocket", "billiards", "pool", "snooker", "shuffleboard", "coins"},
        "target-throw": {"ring", "toss", "cup", "cups", "pong", "basket", "target", "darts", "cornhole"},
        "tower-balance": {"jenga", "stack", "stacking", "balance", "tower", "blocks"},
        "marble-run": {"marble", "marbles", "ramp", "roll", "race", "track"},
    }
    best = max(TEMPLATES, key=lambda t: len(w & (hints.get(t["id"], set()) | set(t["name"].lower().split()) | set(t["summary"].lower().split()))))
    return best
