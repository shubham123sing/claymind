"""Multiplayer room relay (Update 3, Step C): codes, joining, order of edits, late joiners,
limits, host leaving. Real server, real WebSockets, no AI."""

import json

import httpx
import pytest
from websockets.exceptions import ConnectionClosed, InvalidStatus
from websockets.sync.client import connect

ORIGIN = "http://localhost:5190"


def ws(server):
    return connect(server.replace("http", "ws") + "/v1/rooms", origin=ORIGIN, open_timeout=5)


def recv(c, kind, limit=20):
    """Next message of this type (others are skipped)."""
    for _ in range(limit):
        m = json.loads(c.recv(timeout=5))
        if m["t"] == kind:
            return m
    raise AssertionError(f"no {kind}")


def send(c, **msg):
    c.send(json.dumps(msg))


def make_room(server, name="Ana"):
    c = ws(server)
    send(c, t="create", name=name)
    j = recv(c, "joined")
    return c, j


def join(server, code, name="Ben"):
    c = ws(server)
    send(c, t="join", code=code, name=name)
    return c, recv(c, "joined")


def test_create_join_and_roster(server):
    host, j = make_room(server)
    assert len(j["code"]) == 5 and all(ch in "ABCDEFGHJKMNPQRSTUVWXYZ23456789" for ch in j["code"])
    assert j["host"] == j["you"]["id"] and j["you"]["name"] == "Ana"
    guest, g = join(server, j["code"].lower())  # codes are not case sensitive
    assert g["host"] == j["you"]["id"] and len(g["players"]) == 2
    assert {p["color"] for p in g["players"]} == {"#e2733b", "#5aa9e6"}
    roster = recv(host, "players")
    if len(roster["players"]) == 1:  # the roster from creating the room comes first
        roster = recv(host, "players")
    assert [p["name"] for p in roster["players"]] == ["Ana", "Ben"]
    assert recv(host, "need_snapshot")["for"] == g["you"]["id"]
    host.close(), guest.close()


def test_edits_arrive_in_the_same_order_for_everyone(server):
    host, j = make_room(server)
    guest, _ = join(server, j["code"])
    for i in range(5):
        send(host, t="op", op={"brush": "add", "i": i})
        send(guest, t="op", op={"brush": "carve", "i": i})
    a = [recv(host, "op") for _ in range(10)]
    b = [recv(guest, "op") for _ in range(10)]
    assert [m["seq"] for m in a] == list(range(1, 11))
    assert [(m["seq"], m["op"]) for m in a] == [(m["seq"], m["op"]) for m in b]
    host.close(), guest.close()


def test_late_joiner_gets_the_snapshot_and_the_edits_after_it(server):
    host, j = make_room(server)
    for i in range(3):
        send(host, t="op", op={"i": i})
    for _ in range(3):
        recv(host, "op")
    late, _ = join(server, j["code"], "Cy")
    ask = recv(host, "need_snapshot")
    send(host, t="snapshot", to=ask["for"], seq=1, data={"grid": "...", "bodies": []})
    snap = recv(late, "snapshot")
    assert snap["data"]["grid"] == "..." and [o["seq"] for o in snap["ops"]] == [2, 3]
    host.close(), late.close()


def test_relay_rules_host_only_and_to_host(server):
    host, j = make_room(server)
    guest, g = join(server, j["code"])
    send(guest, t="state", data={"fake": True})  # only the host sends physics state
    send(guest, t="input", data={"throw": 1})      # inputs go to the host only
    assert recv(host, "input")["data"] == {"throw": 1}
    send(host, t="state", data={"bodies": [1]})
    assert recv(guest, "state")["data"] == {"bodies": [1]}
    send(guest, t="presence", data={"head": [0, 1, 0]})
    assert recv(host, "presence")["from"] == g["you"]["id"]
    host.close(), guest.close()


def test_plain_errors_full_not_found_names_and_size(server):
    c = ws(server)
    send(c, t="join", code="ZZZZZ", name="X")
    assert recv(c, "error")["message"] == "No room with that code"
    host, j = make_room(server, name="<b>Bad</b> fuck")
    assert j["you"]["name"] == "Player 1"  # filtered
    others = [join(server, j["code"], f"P{i}")[0] for i in range(3)]
    fifth = ws(server)
    send(fifth, t="join", code=j["code"], name="Five")
    assert recv(fifth, "error")["message"] == "That room is full (4 players)"
    send(host, t="presence", data="x" * 70000)
    assert recv(host, "error")["message"] == "Message too large"
    for o in others:
        o.close()
    host.close()


def test_kick_host_leaving_and_rooms_expire(server):
    host, j = make_room(server)
    guest, g = join(server, j["code"])
    third, t = join(server, j["code"], "Cy")
    send(host, t="kick", id=t["you"]["id"])
    assert recv(third, "kicked")
    host.close()  # the host leaves: the next player carries on as host
    assert recv(guest, "host")["id"] == g["you"]["id"]
    assert httpx.get(f"{server}/v1/rooms/health").json()["rooms"] == 1
    guest.close()
    import time
    time.sleep(0.3)
    assert httpx.get(f"{server}/v1/rooms/health").json()["rooms"] == 0  # empty rooms are gone


def test_other_origins_are_refused(server):
    with pytest.raises((InvalidStatus, ConnectionClosed)):
        c = connect(server.replace("http", "ws") + "/v1/rooms", origin="https://evil.example", open_timeout=5)
        send(c, t="create", name="x")
        c.recv(timeout=5)
