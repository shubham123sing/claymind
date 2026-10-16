"""What the agents answer (strict JSON, checked with Pydantic) and what the client sends."""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field

RoleTag = Literal["board", "piece", "launcher", "target", "obstacle", "container", "other"]


class KitDescriptor(BaseModel):
    """One Play Kit item as the client measured it (geometry, never pictures)."""

    id: str = Field(max_length=60)
    name: str = Field(max_length=40)
    role: RoleTag
    sizeCm: list[float] = Field(min_length=3, max_length=3)
    massKg: float = Field(ge=0, le=100)
    materials: list[str] = Field(default_factory=list, max_length=8)
    parts: int = Field(default=1, ge=1, le=8)
    fill: float = Field(default=1.0, ge=0, le=1)
    #: optional extras the client may add later
    holes: int = Field(default=0, ge=0, le=20)
    rimCm: float = Field(default=0, ge=0, le=50)
    #: what the optional vision check saw in the game's own pictures of it ("" when off)
    looksLike: str = Field(default="", max_length=40)


class ShapeReport(BaseModel):
    id: str
    name: str
    flatness: float
    roundness: float
    elongation: float
    cavity: bool
    holes: int
    rimCm: float
    massKg: float
    materials: list[str]
    role: RoleTag
    suggestedRoles: list[RoleTag]
    fitsShapes: list[str]


# ---------- Researcher ----------

class Source(BaseModel):
    title: str = Field(max_length=120)
    url: str = Field(max_length=300)


class RuleCard(BaseModel):
    game: str = Field(max_length=60)
    goal: str = Field(max_length=300)
    pieces: list[str] = Field(max_length=12)
    setup: str = Field(max_length=400)
    turns: str = Field(max_length=300)
    scoring: str = Field(max_length=400)
    variants: list[str] = Field(default_factory=list, max_length=6)
    sizes: str = Field(default="", max_length=300)
    sources: list[Source] = Field(default_factory=list, max_length=6)
    #: which parts came from the web (the player's own rules always win)
    from_web: list[str] = Field(default_factory=list, max_length=8)
    guessed: bool = Field(default=False, description="true when no source said it and this is a best guess")


# ---------- Game Designer ----------

class Adapt(BaseModel):
    """Changes to a built-in template (applied by code): the reliable way to play the player's rules."""

    players: Optional[int] = Field(default=None, ge=1, le=4)
    shotsPerTurn: Optional[int] = Field(default=None, ge=0, le=20, description="throws / flicks per turn, 0 = no turns")
    maxTurns: Optional[int] = Field(default=None, ge=0, le=30, description="turns per player, 0 = until a rule ends it")
    timerSec: Optional[int] = Field(default=None, ge=0, le=600)
    counts: dict[str, int] = Field(default_factory=dict, description="role id -> how many pieces (at most the template's count)")
    target: Optional[int] = Field(default=None, ge=1, le=50, description="new value for the win counter (count_reached)")
    name: Optional[str] = Field(default=None, max_length=40)


class DesignOut(BaseModel):
    template_id: Optional[str] = Field(default=None, description="a built-in template id when one fits")
    adapt: Optional[Adapt] = Field(default=None, description="changes to that template that apply the player's rules")
    spec: Optional[dict] = Field(default=None, description="a full Game Spec when no template fits")
    missing: list[str] = Field(default_factory=list, max_length=8, description="what the kit lacks, plainly")
    adjustments: list[str] = Field(default_factory=list, max_length=8, description="size / mass changes that would help")
    cannot: list[str] = Field(default_factory=list, max_length=8, description="rules that cannot be expressed, with the closest alternative")
    how_to_play: list[str] = Field(default_factory=list, max_length=4)


# ---------- Point + Say: the Intent Resolver ----------

RoleWord = Literal["ball", "target", "goal", "board", "tool", "launcher"]


class IntentRole(BaseModel):
    ref: str = Field(max_length=4, description="a tag from the INPUT items, e.g. A")
    role: RoleWord


class IntentOut(BaseModel):
    roles: list[IntentRole] = Field(default_factory=list, max_length=12)
    game: Optional[str] = Field(default=None, max_length=60, description="the game the player names or clearly means, else null")
    goal_is_marked_zone: bool = Field(default=False, description="the words say a marked area is where pieces must go")
    unsure: list[str] = Field(default_factory=list, max_length=8, description="tags whose role the words do not make clear")
