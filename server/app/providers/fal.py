"""fal.ai providers via the queue REST API (submit -> poll status -> fetch result).

Model ids are configuration (FAL_3D_MODEL, FAL_IMAGE_MODEL) because hosted
names and output fields change; verify them on fal.ai before enabling.
The result parser accepts the common GLB fields (model_mesh / model_glb / mesh).
"""
from __future__ import annotations

import httpx

from .base import ModelProgress, ProviderError


def _glb_url(result: dict) -> str | None:
    for key in ("model_mesh", "model_glb", "mesh", "glb", "model"):
        v = result.get(key)
        if isinstance(v, dict) and isinstance(v.get("url"), str):
            return v["url"]
        if isinstance(v, str) and v.startswith("http"):
            return v
    return None


class _FalQueue:
    def __init__(self, key: str | None, base: str):
        if not key:
            raise ProviderError("FAL_KEY is not set")
        self.base = base.rstrip("/")
        self.headers = {"Authorization": f"Key {key}", "Content-Type": "application/json"}

    async def submit(self, model: str, payload: dict) -> dict:
        async with httpx.AsyncClient(timeout=60) as c:
            r = await c.post(f"{self.base}/{model}", json=payload, headers=self.headers)
        if r.status_code >= 400:
            raise ProviderError(f"fal submit {r.status_code}")
        return r.json()

    async def get(self, url: str) -> dict:
        async with httpx.AsyncClient(timeout=60) as c:
            r = await c.get(url, headers=self.headers)
        if r.status_code >= 400:
            raise ProviderError(f"fal get {r.status_code}")
        return r.json()


class FalModel:
    name = "fal-3d"

    def __init__(self, key: str | None, model: str, base: str):
        self.q = _FalQueue(key, base)
        self.model = model
        self.version = f"{model}:1"
        self._urls: dict[str, tuple[str, str]] = {}

    async def submit(self, image_data_url: str, category: str, name: str) -> str:
        res = await self.q.submit(self.model, {"image_url": image_data_url})
        handle = res.get("request_id")
        if not handle:
            raise ProviderError("fal: no request id")
        self._urls[handle] = (res.get("status_url", ""), res.get("response_url", ""))
        return handle

    async def poll(self, handle: str) -> ModelProgress:
        status_url, response_url = self._urls.get(handle, ("", ""))
        if not status_url:
            raise ProviderError("unknown job")
        st = await self.q.get(status_url)
        status = st.get("status", "")
        if status in ("IN_QUEUE", "IN_PROGRESS"):
            # the queue API reports no percentage; estimate from queue position
            pos = st.get("queue_position") or 0
            return ModelProgress("running", 0.1 if pos else 0.5)
        if status != "COMPLETED":
            return ModelProgress("error", 1.0, error=f"fal status {status}")
        result = await self.q.get(response_url)
        url = _glb_url(result)
        if not url:
            return ModelProgress("error", 1.0, error="fal: no GLB in result")
        async with httpx.AsyncClient(timeout=120) as c:
            r = await c.get(url)
        if r.status_code >= 400 or r.content[:4] != b"glTF":
            return ModelProgress("error", 1.0, error="fal: GLB download failed")
        return ModelProgress("done", 1.0, glb=r.content)


class FalImage:
    name = "fal-image"

    def __init__(self, key: str | None, model: str, base: str):
        self.q = _FalQueue(key, base)
        self.model = model
        self.version = f"{model}:1"

    async def refine(self, image_data_url: str, prompt: str) -> str:
        import asyncio

        res = await self.q.submit(self.model, {"image_url": image_data_url, "prompt": prompt, "strength": 0.75})
        status_url, response_url = res.get("status_url"), res.get("response_url")
        if not status_url:
            raise ProviderError("fal image: no status url")
        for _ in range(60):
            st = await self.q.get(status_url)
            if st.get("status") == "COMPLETED":
                out = await self.q.get(response_url)
                images = out.get("images") or []
                if images and isinstance(images[0], dict) and images[0].get("url"):
                    return images[0]["url"]
                raise ProviderError("fal image: no image in result")
            await asyncio.sleep(1.0)
        raise ProviderError("fal image: timeout")
