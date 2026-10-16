import base64
import time

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app

PNG = "data:image/png;base64," + base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"0" * 64).decode()
REQ = {
    "images": [PNG],
    "materials": ["ceramic", "glass", "plastic", "rubber", "wood", "clay", "stone", "foam", "steel", "aluminium"],
    "categories": ["mug", "ball", "bowl"],
    "hints": {"best_template": "mug", "best_similarity": 0.62, "size_cm": [11, 10, 8], "open_top": 0.9, "holes": 1},
}


@pytest.fixture()
def settings(tmp_path):
    samples = tmp_path / "samples"
    samples.mkdir()
    (samples / "mug.glb").write_bytes(b"glTF" + b"\0" * 32)
    return Settings(data_dir=tmp_path / "data", samples_dir=samples, mock_vlm_seconds=0.01, mock_model_seconds=0.3,
                    session_describe_limit=3, session_generate_limit=2)


@pytest.fixture()
def client(settings):
    with TestClient(create_app(settings)) as c:
        yield c


def test_health_reports_mock(client):
    h = client.get("/health").json()
    assert h["ok"] and h["mock"] and h["providers"]["vlm"] == "mock-vlm"


def test_describe_mock_is_valid_and_cached(client):
    r = client.post("/vlm/describe", json=REQ, headers={"X-Session": "s1"})
    assert r.status_code == 200
    d = r.json()
    assert d["category"] == "mug" and not d["cached"]
    assert abs(sum(m["prob"] for m in d["material"]) - 1) < 1e-3
    assert all(m["name"] in REQ["materials"] for m in d["material"])
    again = client.post("/vlm/describe", json=REQ, headers={"X-Session": "s1"}).json()
    assert again["cached"] and again["category"] == "mug"


def test_rejects_bad_and_oversized_images(client):
    bad = {**REQ, "images": ["https://example.com/x.png"]}
    assert client.post("/vlm/describe", json=bad).status_code == 400
    big = {**REQ, "images": ["data:image/png;base64," + "A" * 3_000_000]}
    assert client.post("/vlm/describe", json=big).status_code == 413
    gif = {**REQ, "images": ["data:image/gif;base64,R0lGOD"]}
    assert client.post("/vlm/describe", json=gif).status_code == 415


def test_session_quota(client):
    for i in range(3):
        req = {**REQ, "hints": {**REQ["hints"], "best_similarity": 0.1 * i}}  # distinct -> not cached
        assert client.post("/vlm/describe", json=req, headers={"X-Session": "q"}).status_code == 200
    req = {**REQ, "hints": {**REQ["hints"], "best_similarity": 0.9}}
    assert client.post("/vlm/describe", json=req, headers={"X-Session": "q"}).status_code == 429
    assert client.post("/vlm/describe", json=req, headers={"X-Session": "other"}).status_code == 200


def test_spending_cap_blocks_paid_calls(settings, tmp_path):
    from app.guards import Guards
    settings.spend_cap_usd = 0.05
    g = Guards(settings)
    g.check("s", "describe", 0.03, 10)
    g.charge("s", "describe", 0.03)
    with pytest.raises(Exception) as e:
        g.check("s", "describe", 0.03, 10)
    assert "cap" in str(e.value.detail)
    # persisted across restarts
    assert Guards(settings).spend_usd == pytest.approx(0.03)


def _wait(client, job_id, timeout=5.0):
    t0 = time.time()
    while time.time() - t0 < timeout:
        j = client.get(f"/model/jobs/{job_id}").json()
        if j["status"] in ("done", "error"):
            return j
        time.sleep(0.05)
    raise AssertionError("job did not finish")


def test_generate_job_progress_result_and_cache(client):
    job = client.post("/model/generate", json={"image": PNG, "category": "mug", "name": "Mug"}).json()
    assert job["status"] in ("queued", "running")
    done = _wait(client, job["id"])
    assert done["status"] == "done" and done["result_url"].endswith(".glb")
    glb = client.get(done["result_url"])
    assert glb.status_code == 200 and glb.content[:4] == b"glTF"
    again = client.post("/model/generate", json={"image": PNG, "category": "mug", "name": "Mug"}).json()
    assert again["status"] == "done" and again["cached"]


def test_generate_without_sample_fails_cleanly(client):
    job = client.post("/model/generate", json={"image": PNG, "category": "spaceship"}).json()
    done = _wait(client, job["id"])
    assert done["status"] == "error" and "no sample" in done["error"]


def test_model_file_route_cannot_escape_cache(client):
    assert client.get("/model/files/..%2F..%2Fspend.json").status_code == 404
    assert client.get("/model/files/deadbeef.glb").status_code == 404
