"""ClayMind AI server: a small, stateless-ish proxy in front of AI providers.

  GET  /health                 providers, mock flag, spend
  POST /vlm/describe           sculpt renders -> {name, category, confidence, material[], ...}
  POST /image/refine           render + prompt -> cleaner reference image (data URL)
  POST /model/generate         image -> image-to-3D job (or an immediate cached result)
  GET  /model/jobs/{id}        job status / progress / result_url
  GET  /model/files/{key}.glb  generated model

Every call is cached by content hash, rate-limited per session (X-Session
header) and counted against a global spending cap. API keys stay here.
Run: uvicorn app.main:app --port 8787
"""
from __future__ import annotations

import base64

import httpx
from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from .cache import Cache, cache_key
from .config import Settings
from .guards import Guards, decode_data_url
from .jobs import JobRunner
from .providers import ProviderError, make_image, make_model, make_vlm
from .schemas import DescribeRequest, DescribeResponse, GenerateRequest, Health, Job, RefineRequest, RefineResponse


def create_app(settings: Settings | None = None) -> FastAPI:
    s = settings or Settings()
    app = FastAPI(title="ClayMind AI", version="0.4.0")
    app.add_middleware(
        CORSMiddleware, allow_origins=s.cors_origins, allow_methods=["GET", "POST"], allow_headers=["Content-Type", "X-Session"],
    )
    cache = Cache(s.data_dir)
    guards = Guards(s)
    jobs = JobRunner(cache)
    vlm, image, model = make_vlm(s), make_image(s), make_model(s)
    app.state.settings, app.state.jobs = s, jobs

    def cost(provider: object | None, usd: float) -> float:
        return 0.0 if provider is None or getattr(provider, "name", "").startswith("mock") else usd

    @app.get("/health", response_model=Health)
    async def health() -> Health:
        return Health(
            ok=True,
            mock=s.mock,
            providers={"vlm": getattr(vlm, "name", "none"), "image": getattr(image, "name", "none"), "model": getattr(model, "name", "none")},
            spend_usd=guards.spend_usd,
            spend_cap_usd=s.spend_cap_usd,
        )

    @app.post("/vlm/describe", response_model=DescribeResponse)
    async def describe(req: DescribeRequest, x_session: str = Header(default="anon")) -> DescribeResponse:
        if vlm is None:
            raise HTTPException(503, "no VLM provider configured")
        if len(req.images) > s.max_images:
            raise HTTPException(413, "too many images")
        for img in req.images:
            decode_data_url(img, s.max_image_bytes, allowed=("image/png", "image/jpeg", "image/webp"))
        key = cache_key("describe", vlm.version, req.model_dump())
        hit = cache.get_json(key)
        if hit:
            return DescribeResponse(**hit, cached=True, provider=vlm.name)
        c = cost(vlm, s.cost_vlm)
        guards.check(x_session, "describe", c, s.session_describe_limit)
        try:
            result = await vlm.describe(req)
        except ProviderError as e:
            raise HTTPException(502, str(e)) from e
        guards.charge(x_session, "describe", c)
        cache.put_json(key, result.model_dump())
        return DescribeResponse(**result.model_dump(), cached=False, provider=vlm.name)

    @app.post("/image/refine", response_model=RefineResponse)
    async def refine(req: RefineRequest, x_session: str = Header(default="anon")) -> RefineResponse:
        if image is None:
            raise HTTPException(503, "no image provider configured")
        decode_data_url(req.image, s.max_image_bytes)
        key = cache_key("refine", image.version, req.model_dump())
        hit = cache.get_json(key)
        if hit:
            return RefineResponse(**hit, cached=True, provider=image.name)
        c = cost(image, s.cost_image)
        guards.check(x_session, "refine", c, s.session_generate_limit)
        try:
            out = await image.refine(req.image, req.prompt)
        except ProviderError as e:
            raise HTTPException(502, str(e)) from e
        if out.startswith("https://"):
            # hand the browser a data URL, never a third-party link
            async with httpx.AsyncClient(timeout=60) as cl:
                r = await cl.get(out)
            if r.status_code >= 400 or len(r.content) > s.max_image_bytes * 4:
                raise HTTPException(502, "refined image download failed")
            mime = r.headers.get("content-type", "image/png").split(";")[0]
            out = f"data:{mime};base64,{base64.b64encode(r.content).decode()}"
        guards.charge(x_session, "refine", c)
        cache.put_json(key, {"image": out})
        return RefineResponse(image=out, cached=False, provider=image.name)

    @app.post("/model/generate", response_model=Job)
    async def generate(req: GenerateRequest, x_session: str = Header(default="anon")) -> Job:
        if model is None:
            raise HTTPException(503, "no image-to-3D provider configured")
        decode_data_url(req.image, s.max_image_bytes * 2)
        key = cache_key("model", model.version, {"image": req.image, "category": req.category})
        if cache.has_file(key):
            return jobs.done_job(key, model.name)
        c = cost(model, s.cost_model)
        guards.check(x_session, "generate", c, s.session_generate_limit)
        guards.charge(x_session, "generate", c)
        return jobs.start(model, key, req.image, req.category, req.name)

    @app.get("/model/jobs/{job_id}", response_model=Job)
    async def job_status(job_id: str) -> Job:
        job = jobs.jobs.get(job_id)
        if not job:
            raise HTTPException(404, "unknown job")
        return job

    @app.get("/model/files/{name}")
    async def model_file(name: str) -> FileResponse:
        if not name.endswith(".glb"):
            raise HTTPException(404, "not found")
        p = cache.file_path(name[:-4])
        if not p.exists():
            raise HTTPException(404, "not found")
        return FileResponse(p, media_type="model/gltf-binary", headers={"Cache-Control": "public, max-age=31536000, immutable"})

    return app


app = create_app()
