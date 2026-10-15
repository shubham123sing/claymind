"""Kit Analyst (code, no AI): turns each kit item's measured geometry into a shape report
(flatness, roundness, elongation, cavity, holes, rim) and the roles it can play. Same
rules as the client (client/src/playkit/kit-store.ts: suggestRole, shapeFits)."""

from __future__ import annotations

from .referee import VOCAB
from .schemas import KitDescriptor, ShapeReport


def shape_fits(d: KitDescriptor, shape: str) -> bool:
    small, mid, big = sorted(d.sizeCm)
    even = small / max(big, 0.1)
    long = mid / max(big, 0.1)
    return {
        "block": d.fill >= 0.65,
        "ball": even >= 0.7 and d.fill < 0.7,
        "marble": even >= 0.7 and d.fill < 0.7,
        "coin": even < 0.6 and long > 0.7,
        "disc": even < 0.6 and long > 0.7,
        "board": even < 0.15 and long >= 0.5,
        "cup": d.fill < 0.6,
        "ramp": long < 0.5,
    }[shape]


def suggest_roles(d: KitDescriptor) -> list[str]:
    small, mid, big = sorted(d.sizeCm)
    flat = small / max(big, 0.1)
    long = mid / max(big, 0.1)
    tall = d.sizeCm[1] / max(big, 0.1)
    out: list[str] = []
    if flat < 0.15 and long >= 0.5 and big >= 15:
        out.append("board")
    if (d.fill < 0.45 and tall > 0.4 and big >= 4) or d.holes > 0:
        out.append("container")
    if long < 0.35 and big >= 15:
        out.append("launcher")
    if big <= 8:
        out.append("piece")
    if big > 8 and "board" not in out:
        out.append("obstacle")
    if d.role not in out:
        out.insert(0, d.role)  # the player's own tag always counts
    return out


def analyse(d: KitDescriptor) -> ShapeReport:
    small, mid, big = sorted(d.sizeCm)
    return ShapeReport(
        id=d.id, name=d.name,
        flatness=round(small / max(big, 0.1), 2),
        roundness=round(min(1.0, (small / max(big, 0.1)) * (1 if 0.45 <= d.fill <= 0.62 else 0.6)), 2),
        elongation=round(1 - mid / max(big, 0.1), 2),
        cavity=d.fill < 0.45, holes=d.holes, rimCm=d.rimCm, massKg=d.massKg, materials=d.materials,
        role=d.role, suggestedRoles=suggest_roles(d),
        fitsShapes=[s for s in VOCAB["fallbackShapes"] if shape_fits(d, s)],
    )
