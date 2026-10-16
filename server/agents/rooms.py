"""Multiplayer rooms (Update 3, Step C): a small WebSocket relay, memory only.

- Create a room (a 5-character code of easy letters and digits) or join one by code; 2-4
  players; name tag and colour per player; the creator is the host; the host can kick.
- Host-authoritative: the host runs the physics and the game rules. The relay only orders and
  forwards messages; it never runs anything a client sends and keeps nothing after a room
  empties (rooms also expire after 30 idle minutes).
- Shared building: edit operations get a room sequence number and go to everyone (the sender
  too), so every client applies them in the same order. A late joiner gets the host's
  snapshot plus the logged operations after it.
- If the host leaves, the next player becomes host (the clients carry on from their last
  snapshot); an empty room is gone.
- Limits: 4 players, message size caps (snapshots larger), messages per second per socket,
  sockets and new rooms per IP, names filtered (no account, nothing personal needed).

Messages are JSON objects with a type `t`:
  client -> relay: create {name} · join {code, name} · leave · kick {id} · op {op}
                   state {data} (host) · check {data} (host: the clay's checksum) ·
                   presence {data} · input {data} (to the host) ·
                   game {data} (host) · vote {data} (to the host) · emote {data} ·
                   kit {data} · snapshot {to, seq, data} (host) · resync (ask the host)
  relay -> client: joined {code, you, host, players, seq} · players {players, host} ·
                   op {seq, from, op} · state / presence / input / game / vote / emote / kit
                   {from, data} · need_snapshot {for} (to the host) · snapshot {seq, data, ops} ·
                   host {id} · error {message} · kicked
"""

from __future__ import annotations

import asyncio
import json
import random
import re
import time
from collections import defaultdict, deque
from dataclasses import dataclass, field

from fastapi import WebSocket, WebSocketDisconnect

CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"  # no 0/O, 1/I/L
CODE_LEN = 5
MAX_PLAYERS = 4
COLORS = ["#e2733b", "#5aa9e6", "#5fbf72", "#b48cf2"]
MAX_MSG = 64 * 1024
MAX_SNAPSHOT = 4 * 1024 * 1024
MSGS_PER_SEC = 250
SOCKETS_PER_IP = 8
ROOMS_PER_IP_PER_MIN = 10
OP_LOG = 4000
IDLE_S = 30 * 60
JOIN_TIMEOUT_S = 15
NAME_RE = re.compile(r"[^A-Za-z0-9 _\-]")
BAD_NAME = re.compile(r"(fuck|shit|bitch|cunt|nigg|fag|rape|nazi|porn|sex|kill)", re.I)
RELAY_TYPES = {"state", "presence", "input", "game", "vote", "emote", "kit", "check"}
TO_HOST = {"input", "vote"}
HOST_ONLY = {"state", "game", "check"}


def clean_name(raw: object, fallback: str) -> str:
    name = NAME_RE.sub("", str(raw or ""))[:16].strip()
    if not name or BAD_NAME.search(name):
        return fallback
    return name


@dataclass
class Player:
    id: str
    name: str
    color: str
    ws: WebSocket
    ip: str
    joined: float = field(default_factory=time.monotonic)
    stamps: deque = field(default_factory=deque)

    def public(self) -> dict:
        return {"id": self.id, "name": self.name, "color": self.color}


@dataclass
class Room:
    code: str
    players: list[Player] = field(default_factory=list)
    host: str = ""
    seq: int = 0
    log: deque = field(default_factory=lambda: deque(maxlen=OP_LOG))
    touched: float = field(default_factory=time.monotonic)

    def player(self, pid: str) -> Player | None:
        return next((p for p in self.players if p.id == pid), None)


class RoomHub:
    def __init__(self, allowed_origins: list[str]):
        self.allowed = set(allowed_origins)
        self.rooms: dict[str, Room] = {}
        self.sockets_by_ip: dict[str, int] = defaultdict(int)
        self.creates_by_ip: dict[str, deque] = defaultdict(deque)
        self.next_id = 1

    # ---------- helpers ----------

    def new_code(self) -> str:
        while True:
            code = "".join(random.choice(CODE_ALPHABET) for _ in range(CODE_LEN))
            if code not in self.rooms:
                return code

    @staticmethod
    async def send(p: Player, msg: dict) -> None:
        try:
            await p.ws.send_text(json.dumps(msg, separators=(",", ":")))
        except Exception:  # a closed socket: its own handler cleans up
            pass

    async def broadcast(self, room: Room, msg: dict, skip: str | None = None) -> None:
        await asyncio.gather(*(self.send(p, msg) for p in room.players if p.id != skip))

    async def roster(self, room: Room) -> None:
        await self.broadcast(room, {"t": "players", "players": [p.public() for p in room.players], "host": room.host})

    def sweep(self) -> None:
        now = time.monotonic()
        for code in [c for c, r in self.rooms.items() if not r.players or now - r.touched > IDLE_S]:
            del self.rooms[code]

    def rate_ok(self, p: Player) -> bool:
        now = time.monotonic()
        while p.stamps and now - p.stamps[0] > 1:
            p.stamps.popleft()
        if len(p.stamps) >= MSGS_PER_SEC:
            return False
        p.stamps.append(now)
        return True

    # ---------- the socket ----------

    async def handle(self, ws: WebSocket) -> None:
        origin = ws.headers.get("origin")
        if origin and origin not in self.allowed:
            await ws.close(code=4403)
            return
        ip = ws.client.host if ws.client else "?"
        if self.sockets_by_ip[ip] >= SOCKETS_PER_IP:
            await ws.close(code=4429)
            return
        await ws.accept()
        self.sockets_by_ip[ip] += 1
        room: Room | None = None
        me: Player | None = None
        try:
            room, me = await self.enter(ws, ip)
            if not room or not me:
                return
            while True:
                raw = await ws.receive_text()
                if len(raw) > MAX_SNAPSHOT:
                    await self.send(me, {"t": "error", "message": "Message too large"})
                    continue
                try:
                    msg = json.loads(raw)
                except ValueError:
                    continue
                if not isinstance(msg, dict):
                    continue
                kind = msg.get("t")
                if kind not in ("snapshot", "game") and len(raw) > MAX_MSG:  # a game may carry players' own toys
                    await self.send(me, {"t": "error", "message": "Message too large"})
                    continue
                if not self.rate_ok(me):
                    continue
                room.touched = time.monotonic()
                if kind == "leave":
                    break
                await self.on_message(room, me, kind, msg)
                if me not in room.players:  # kicked meanwhile
                    break
        except (WebSocketDisconnect, RuntimeError):
            pass
        finally:
            self.sockets_by_ip[ip] -= 1
            if room and me:
                await self.drop(room, me)
            self.sweep()

    async def enter(self, ws: WebSocket, ip: str) -> tuple[Room | None, Player | None]:
        async def fail(message: str):
            await ws.send_text(json.dumps({"t": "error", "message": message}))
            await ws.close()
            return None, None

        try:
            raw = await asyncio.wait_for(ws.receive_text(), JOIN_TIMEOUT_S)
            msg = json.loads(raw) if len(raw) <= MAX_MSG else {}
        except (asyncio.TimeoutError, ValueError):
            return await fail("Create or join a room first")
        self.sweep()
        kind = msg.get("t") if isinstance(msg, dict) else None
        if kind == "create":
            q, now = self.creates_by_ip[ip], time.monotonic()
            while q and now - q[0] > 60:
                q.popleft()
            if len(q) >= ROOMS_PER_IP_PER_MIN:
                return await fail("Too many new rooms: wait a minute")
            q.append(now)
            room = Room(self.new_code())
            self.rooms[room.code] = room
        elif kind == "join":
            code = str(msg.get("code", "")).upper().replace(" ", "")[:CODE_LEN + 2]
            room = self.rooms.get(code)
            if not room or not room.players:
                return await fail("No room with that code")
            if len(room.players) >= MAX_PLAYERS:
                return await fail("That room is full (4 players)")
        else:
            return await fail("Create or join a room first")
        used = {p.color for p in room.players}
        color = next(c for c in COLORS if c not in used)
        pid = f"p{self.next_id}"
        self.next_id += 1
        me = Player(pid, clean_name(msg.get("name"), f"Player {len(room.players) + 1}"), color, ws, ip)
        room.players.append(me)
        if not room.host:
            room.host = pid
        await self.send(me, {"t": "joined", "code": room.code, "you": me.public(), "host": room.host, "players": [p.public() for p in room.players], "seq": room.seq})
        await self.roster(room)
        if pid != room.host:
            host = room.player(room.host)
            if host:
                await self.send(host, {"t": "need_snapshot", "for": pid})
        return room, me

    async def on_message(self, room: Room, me: Player, kind: str | None, msg: dict) -> None:
        is_host = me.id == room.host
        if kind == "op":
            room.seq += 1
            out = {"t": "op", "seq": room.seq, "from": me.id, "op": msg.get("op")}
            room.log.append(out)
            await self.broadcast(room, out)
        elif kind == "kick" and is_host:
            target = room.player(str(msg.get("id")))
            if target and target is not me:
                await self.send(target, {"t": "kicked"})
                await self.drop(room, target)
                try:
                    await target.ws.close()
                except Exception:
                    pass
        elif kind == "snapshot" and is_host:
            target = room.player(str(msg.get("to")))
            if target:
                seq = int(msg.get("seq", 0))
                ops = [o for o in room.log if o["seq"] > seq]
                await self.send(target, {"t": "snapshot", "seq": seq, "data": msg.get("data"), "ops": ops})
        elif kind == "resync" and not is_host:
            host = room.player(room.host)
            if host:
                await self.send(host, {"t": "need_snapshot", "for": me.id})
        elif kind in RELAY_TYPES:
            if kind in HOST_ONLY and not is_host:
                return
            out = {"t": kind, "from": me.id, "data": msg.get("data")}
            if kind in TO_HOST:
                host = room.player(room.host)
                if host and not is_host:
                    await self.send(host, out)
            else:
                await self.broadcast(room, out, skip=me.id)

    async def drop(self, room: Room, me: Player) -> None:
        if me not in room.players:
            return
        room.players.remove(me)
        if not room.players:
            self.rooms.pop(room.code, None)
            return
        if room.host == me.id:
            room.host = room.players[0].id  # the longest-present player carries on
            await self.broadcast(room, {"t": "host", "id": room.host})
        await self.roster(room)
