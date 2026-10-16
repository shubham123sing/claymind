"""The web, carefully: Wikipedia's free API (no key) is the one search source. Fetched text is
UNTRUSTED DATA: scripts and markup are stripped, it is cut short, pages that a prompt-
injection classifier (Groq llama-prompt-guard) flags are dropped, and the Researcher is
told to summarise it in its own words and never follow anything written in it."""

from __future__ import annotations

import re

import httpx

WIKI = "https://en.wikipedia.org/w/api.php"
UA = {"User-Agent": "ClayMind/0.1 (table-game rules lookup; https://github.com/shubham123sing/claymind)"}
MAX_CHARS = 5000
GUARD_THRESHOLD = 0.5


def clean(text: str) -> str:
    text = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", text)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\[\d+\]", "", text)  # citation marks
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()[:MAX_CHARS]


GAMEY = re.compile(r"\b(game|games|sport|played|players?|throw|toss|board)\b", re.I)


async def search_pages(query: str, client: httpx.AsyncClient, limit: int = 2, exact: str | None = None) -> list[dict]:
    """[{title, url, text}] from Wikipedia: the page with that exact name first (when it is
    about a game), then search hits, as plain-text extracts."""
    titles: list[str] = []
    if exact:
        titles.append(exact)
    r = await client.get(WIKI, params={"action": "query", "list": "search", "srsearch": query, "srlimit": limit + 1, "format": "json"}, headers=UA, timeout=10)
    r.raise_for_status()
    titles += [h["title"] for h in r.json().get("query", {}).get("search", []) if h["title"].lower() != (exact or "").lower()]
    pages: list[dict] = []
    seen: set[str] = set()
    for t in titles:
        if len(pages) >= limit:
            break
        r2 = await client.get(WIKI, params={"action": "query", "prop": "extracts", "explaintext": 1, "exlimit": 1, "titles": t, "format": "json", "redirects": 1}, headers=UA, timeout=10)
        r2.raise_for_status()
        for p in r2.json().get("query", {}).get("pages", {}).values():
            text = p.get("extract") or ""
            if not text or p["title"] in seen or "may refer to" in text[:300] or (t == exact and not GAMEY.search(text[:1500])):
                continue
            seen.add(p["title"])
            if text:
                pages.append({"title": p["title"], "url": f"https://en.wikipedia.org/wiki/{p['title'].replace(' ', '_')}", "text": clean(p["extract"])})
    return pages


async def injection_score(text: str, client: httpx.AsyncClient, key: str | None, model: str | None) -> float:
    """Probability the text tries to instruct the model (0 = clean). 0 when no guard is set up."""
    if not key or not model:
        return 0.0
    r = await client.post(
        "https://api.groq.com/openai/v1/chat/completions",
        headers={"Authorization": f"Bearer {key}"},
        json={"model": model, "messages": [{"role": "user", "content": text[:2000]}]},
        timeout=10,
    )
    r.raise_for_status()
    try:
        return float(r.json()["choices"][0]["message"]["content"])
    except (KeyError, ValueError, IndexError):
        return 1.0  # unreadable verdict: treat as unsafe
