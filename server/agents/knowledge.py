"""What the game agent knows, kept on this server only:

- Kit KG (per player): nodes Item, Role, Game, Rule, Source, Set; edges can_be (Item->Role),
  needs (Game->Role), fits (Item->Game), variant_of (Game->Game), cites (Game->Source).
  GraphRAG: a *local* query hops from the player's items to the games they can play; a
  *global* query summarises what the kit supports.
- Passage index (shared, not personal): cached Rule Cards and the researched page text,
  searched by a small open embedding model (BAAI/bge-small-en-v1.5 via fastembed, local)
  blended with keyword overlap; keyword-only if the model is not available.
- Memory (per player): kit, sets, games played, rules they changed, preferences.
  "Delete my data" erases the player's KG and memory.
"""

from __future__ import annotations

import json
import math
import re
import sqlite3
import threading
from pathlib import Path

from .analyst import analyse, shape_fits
from .referee import TEMPLATES, VOCAB
from .schemas import KitDescriptor

WORD = re.compile(r"[a-z0-9]{3,}")


def words(text: str) -> set[str]:
    return set(WORD.findall(text.lower()))


class PassageIndex:
    def __init__(self, path: Path, model_dir: Path, use_model: bool = True):
        self._lock = threading.Lock()
        self._db = sqlite3.connect(str(path), check_same_thread=False)
        self._db.execute("CREATE TABLE IF NOT EXISTS passages (id INTEGER PRIMARY KEY, source TEXT, title TEXT, text TEXT, vec TEXT)")
        self._db.commit()
        self._model = None
        self._model_dir = model_dir
        self._use_model = use_model

    def _embedder(self):
        if self._model is None and self._use_model:
            try:
                from fastembed import TextEmbedding

                self._model = TextEmbedding("BAAI/bge-small-en-v1.5", cache_dir=str(self._model_dir))
            except Exception:  # offline or not installed: keyword search only
                self._use_model = False
        return self._model

    def add(self, source: str, title: str, text: str) -> None:
        chunks = [c.strip() for c in re.split(r"\n\s*\n", text) if len(c.strip()) > 40][:30]
        m = self._embedder()
        vecs = [list(map(float, v)) for v in m.embed(chunks)] if m and chunks else [None] * len(chunks)
        with self._lock:
            self._db.execute("DELETE FROM passages WHERE source = ?", (source,))
            for c, v in zip(chunks, vecs):
                self._db.execute("INSERT INTO passages (source, title, text, vec) VALUES (?, ?, ?, ?)", (source, title, c, json.dumps(v) if v else None))
            self._db.commit()

    def search(self, query: str, k: int = 4) -> list[dict]:
        with self._lock:
            rows = self._db.execute("SELECT source, title, text, vec FROM passages").fetchall()
        if not rows:
            return []
        m = self._embedder()
        q = list(map(float, next(iter(m.query_embed(query))))) if m else None
        qw = words(query)
        scored = []
        for source, title, text, vec in rows:
            kw = len(qw & words(text)) / max(1, len(qw))
            cos = 0.0
            if q and vec:
                v = json.loads(vec)
                cos = sum(a * b for a, b in zip(q, v)) / (math.sqrt(sum(a * a for a in q)) * math.sqrt(sum(b * b for b in v)) or 1)
            scored.append((cos + 0.5 * kw, {"source": source, "title": title, "text": text}))
        scored.sort(key=lambda x: -x[0])
        return [p for _, p in scored[:k]]


class KitGraph:
    """One player's knowledge graph, rebuilt from their kit and the known games."""

    def __init__(self, kit: list[KitDescriptor], rule_cards: list[dict], sets: list[dict]):
        self.nodes: dict[str, dict] = {}
        self.edges: list[tuple[str, str, str]] = []
        for tag in VOCAB["roleTags"]:
            self._node(f"role:{tag}", "Role", name=tag)
        for item in kit:
            rep = analyse(item)
            self._node(f"item:{item.id}", "Item", name=item.name, sizeCm=item.sizeCm, massKg=item.massKg, materials=item.materials)
            for r in rep.suggestedRoles:
                self.edges.append((f"item:{item.id}", "can_be", f"role:{r}"))
        for t in TEMPLATES:
            gid = f"game:{t['id']}"
            self._node(gid, "Game", name=t["name"], summary=t["summary"], builtin=True)
            for role in t["roles"]:
                for tag in role["tags"][:1]:
                    self.edges.append((gid, "needs", f"role:{tag}"))
                for item in kit:
                    if role["tags"] and item.role in role["tags"] and shape_fits(item, role["fallback"]):
                        self.edges.append((f"item:{item.id}", "fits", gid))
            for i, rule in enumerate(t["rules"]):
                self._node(f"rule:{t['id']}:{i}", "Rule", text=json.dumps(rule["when"]))
                self.edges.append((gid, "has_rule", f"rule:{t['id']}:{i}"))
        for card in rule_cards:
            gid = f"game:card:{card['game'].lower()}"
            self._node(gid, "Game", name=card["game"], summary=card.get("goal", ""), builtin=False)
            for s in card.get("sources", []):
                self._node(f"source:{s['url']}", "Source", title=s["title"], url=s["url"])
                self.edges.append((gid, "cites", f"source:{s['url']}"))
            from .referee import closest_template

            self.edges.append((gid, "variant_of", f"game:{closest_template(card['game'] + ' ' + card.get('goal', ''))['id']}"))
        for st in sets:
            self._node(f"set:{st.get('id')}", "Set", name=st.get("name"), game=st.get("game"))

    def _node(self, nid: str, kind: str, **props) -> None:
        self.nodes[nid] = {"id": nid, "kind": kind, **props}

    def local_games(self) -> list[dict]:
        """Local query: from the player's items to the games they could play, best first."""
        out = []
        for t in TEMPLATES:
            gid = f"game:{t['id']}"
            mine = sorted({s.split(":", 1)[1] for s, rel, d in self.edges if rel == "fits" and d == gid})
            out.append({"id": t["id"], "name": t["name"], "summary": t["summary"], "yourItems": mine, "roles": len(t["roles"])})
        out.sort(key=lambda g: (-len(g["yourItems"]), g["name"]))
        return out

    def global_summary(self) -> dict:
        """Global query: what the kit supports overall."""
        items = [n for n in self.nodes.values() if n["kind"] == "Item"]
        roles: dict[str, int] = {}
        for s, rel, d in self.edges:
            if rel == "can_be":
                roles[d.split(":", 1)[1]] = roles.get(d.split(":", 1)[1], 0) + 1
        playable = [g["name"] for g in self.local_games() if g["yourItems"]]
        return {"items": len(items), "roles": roles, "gamesUsingYourToys": playable, "knownGames": sum(1 for n in self.nodes.values() if n["kind"] == "Game")}


class Memory:
    """Per-player memory (JSON files on this server). Never sent anywhere."""

    def __init__(self, folder: Path):
        self.folder = folder
        folder.mkdir(parents=True, exist_ok=True)

    def _path(self, user: str) -> Path:
        safe = re.sub(r"[^A-Za-z0-9_-]", "", user)[:40] or "local"
        return self.folder / f"{safe}.json"

    def get(self, user: str) -> dict:
        p = self._path(user)
        if p.exists():
            return json.loads(p.read_text(encoding="utf-8"))
        return {"kit": [], "sets": [], "gamesPlayed": [], "rulesChanged": [], "preferences": {}}

    def update(self, user: str, **changes) -> dict:
        m = self.get(user)
        for k, v in changes.items():
            if isinstance(m.get(k), list) and isinstance(v, list) and k in ("gamesPlayed", "rulesChanged"):
                m[k] = (m[k] + v)[-50:]
            else:
                m[k] = v
        self._path(user).write_text(json.dumps(m, ensure_ascii=False), encoding="utf-8")
        return m

    def delete(self, user: str) -> bool:
        p = self._path(user)
        if p.exists():
            p.unlink()
            return True
        return False
