import json
import socket
import threading
import time

import httpx
import pytest
import uvicorn

from agents.config import load_settings
from agents.governed_model import FAKE_ANSWERS


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture
def settings(tmp_path, monkeypatch):
    monkeypatch.setenv("CLAYMIND_FAKE_LLM", "1")
    monkeypatch.setenv("CLAYMIND_DATA_DIR", str(tmp_path / "agents"))
    monkeypatch.setenv("A2A_TOKEN", "test-token")
    monkeypatch.setenv("CLAYMIND_WEB", "0")
    s = load_settings()
    s.port = free_port()
    FAKE_ANSWERS.clear()
    yield s
    FAKE_ANSWERS.clear()


@pytest.fixture
def server(settings):
    """The real app on a real port (A2A calls go over HTTP to it)."""
    from agents.app import create_app

    app = create_app(settings)
    config = uvicorn.Config(app, host="127.0.0.1", port=settings.port, log_level="warning")
    srv = uvicorn.Server(config)
    t = threading.Thread(target=srv.run, daemon=True)
    t.start()
    for _ in range(100):
        try:
            if httpx.get(f"http://127.0.0.1:{settings.port}/v1/health", timeout=1).status_code == 200:
                break
        except httpx.HTTPError:
            time.sleep(0.05)
    yield f"http://127.0.0.1:{settings.port}"
    srv.should_exit = True
    t.join(timeout=5)


KIT = [
    {"id": "kit_ball", "name": "Ball", "role": "piece", "sizeCm": [4, 4, 4], "massKg": 0.08, "materials": ["clay"], "fill": 0.52},
    {"id": "kit_board", "name": "Board", "role": "board", "sizeCm": [36, 1.5, 36], "massKg": 1.2, "materials": ["wood"], "fill": 0.9},
]


def answer(obj) -> callable:
    return lambda _text: json.dumps(obj)
