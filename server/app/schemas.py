"""Request / response models. AI output is validated here before it reaches the game."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator


class LocalHints(BaseModel):
    """What the game already knows locally (offline matcher). Lets mocks behave realistically
    and gives a real VLM useful context without sending anything but renders."""

    best_template: str | None = None
    best_similarity: float = 0.0
    size_cm: list[float] = Field(default_factory=list)
    open_top: float = 0.0
    holes: int = 0


class DescribeRequest(BaseModel):
    # PNG data URLs of the clay sculpt rendered from fixed angles (no camera images)
    images: list[str] = Field(min_length=1, max_length=4)
    materials: list[str] = Field(min_length=1, description="allowed material ids (from materials.json)")
    categories: list[str] = Field(default_factory=list, description="known concept ids (templates)")
    hints: LocalHints = Field(default_factory=LocalHints)


class MaterialGuess(BaseModel):
    name: str
    prob: float = Field(ge=0, le=1)


class DescribeResult(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    category: str = Field(min_length=1, max_length=40)
    confidence: float = Field(ge=0, le=1)
    material: list[MaterialGuess] = Field(min_length=1, max_length=5)
    parts: list[str] = Field(default_factory=list, max_length=8)
    notes: str = Field(default="", max_length=200)

    @field_validator("material")
    @classmethod
    def normalise(cls, v: list[MaterialGuess]) -> list[MaterialGuess]:
        total = sum(m.prob for m in v) or 1.0
        return [MaterialGuess(name=m.name, prob=round(m.prob / total, 4)) for m in v]


class DescribeResponse(DescribeResult):
    cached: bool = False
    provider: str = ""


class RefineRequest(BaseModel):
    image: str
    prompt: str = Field(max_length=400)


class RefineResponse(BaseModel):
    image: str
    cached: bool = False
    provider: str = ""


class GenerateRequest(BaseModel):
    image: str
    category: str = ""
    name: str = ""
    size_cm: list[float] = Field(default_factory=list)


JobStatus = Literal["queued", "running", "done", "error"]


class Job(BaseModel):
    id: str
    status: JobStatus
    progress: float = 0.0
    result_url: str | None = None
    error: str | None = None
    cached: bool = False
    provider: str = ""


class Health(BaseModel):
    ok: bool
    mock: bool
    providers: dict[str, str]
    spend_usd: float
    spend_cap_usd: float
