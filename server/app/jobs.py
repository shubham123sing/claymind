"""Image-to-3D jobs: submitted to the provider, polled in the background,
results stored in the content cache. The game polls GET /model/jobs/{id};
it never blocks on generation."""
from __future__ import annotations

import asyncio
import time
import uuid

from .cache import Cache
from .providers.base import ModelProvider, ProviderError
from .schemas import Job

POLL_SECONDS = 1.0
TIMEOUT_SECONDS = 600


class JobRunner:
    def __init__(self, cache: Cache):
        self.cache = cache
        self.jobs: dict[str, Job] = {}
        self._tasks: set[asyncio.Task] = set()

    def done_job(self, key: str, provider: str) -> Job:
        job = Job(id=uuid.uuid4().hex[:16], status="done", progress=1.0, result_url=f"/model/files/{key}.glb", cached=True, provider=provider)
        self.jobs[job.id] = job
        return job

    def start(self, provider: ModelProvider, key: str, image: str, category: str, name: str) -> Job:
        job = Job(id=uuid.uuid4().hex[:16], status="queued", provider=provider.name)
        self.jobs[job.id] = job
        task = asyncio.create_task(self._run(job, provider, key, image, category, name))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        return job

    async def _run(self, job: Job, provider: ModelProvider, key: str, image: str, category: str, name: str) -> None:
        t0 = time.time()
        try:
            handle = await provider.submit(image, category, name)
            job.status = "running"
            while time.time() - t0 < TIMEOUT_SECONDS:
                p = await provider.poll(handle)
                job.progress = max(job.progress, min(0.99, p.progress))
                if p.status == "done" and p.glb:
                    self.cache.put_file(key, p.glb)
                    job.result_url = f"/model/files/{key}.glb"
                    job.progress = 1.0
                    job.status = "done"
                    return
                if p.status == "error":
                    job.status, job.error = "error", p.error or "generation failed"
                    return
                await asyncio.sleep(POLL_SECONDS)
            job.status, job.error = "error", "timeout"
        except ProviderError as e:
            job.status, job.error = "error", str(e)
        except Exception as e:  # noqa: BLE001 - a job must never crash the server
            job.status, job.error = "error", f"unexpected: {type(e).__name__}"
