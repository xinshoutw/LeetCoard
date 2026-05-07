"""Admin endpoints — gated by `require_admin`.

All write/control surfaces live here. The public router is read-only.
"""

from __future__ import annotations

import csv
import io
import json
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from ..core.auth import admin_token_for_sse, require_admin
from ..core.sse import broadcaster
from ..domain.models import Difficulty, Problem
from ..domain.state import StartLockError


router = APIRouter()


# ---- Request / Response models ----------------------------------------------

class TimesIn(BaseModel):
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None


class BonusTierIn(BaseModel):
    min_beat_pct: float = Field(ge=0.0, le=100.0)
    bonus_pts: int = Field(ge=0)


class ProblemIn(BaseModel):
    title_slug: str
    difficulty: Difficulty
    points: int = Field(ge=0)
    order: int = Field(ge=0)
    title: Optional[str] = None
    frontend_id: Optional[str] = None
    color: Optional[str] = None
    beat_bonus_tiers: List[BonusTierIn] = Field(default_factory=list)


class ProblemsIn(BaseModel):
    problems: List[ProblemIn]


class ParticipantsBulkIn(BaseModel):
    text: str = Field(description="CSV-ish: lines of `username,student_id`")


class ResetIn(BaseModel):
    keep_config: bool = True
    confirm: str = Field(default="")


# ---- Auth ping --------------------------------------------------------------

@router.get("/auth/check")
async def auth_check(_: None = Depends(require_admin)) -> dict:
    return {"ok": True}


# ---- LeetCode problem search (proxy) ---------------------------------------

@router.get("/leetcode/search")
async def leetcode_search(
    request: Request,
    q: str = Query(default="", min_length=0, max_length=80),
    _: None = Depends(require_admin),
) -> dict:
    """Proxy to leetcode-api-pied /search so the dashboard can autocomplete
    title slugs without dealing with CORS."""
    query = (q or "").strip()
    if len(query) < 2:
        return {"results": []}
    client = request.app.state.lc_client
    results = await client.search_problems(query)
    return {"results": results}


@router.get("/leetcode/problem/{slug}")
async def leetcode_problem(
    slug: str,
    request: Request,
    _: None = Depends(require_admin),
) -> dict:
    """Lightweight proxy returning just the bits the dashboard needs to
    auto-fill a problem row (difficulty + canonical title)."""
    client = request.app.state.lc_client
    try:
        data = await client.get_problem(slug)
    except Exception:
        raise HTTPException(status_code=404, detail="problem not found")
    raw_diff = (data.get("difficulty") or "").strip().lower()
    if raw_diff not in ("easy", "medium", "hard"):
        raise HTTPException(status_code=502, detail=f"unexpected difficulty: {raw_diff!r}")
    raw_fid = (
        data.get("questionFrontendId")
        or data.get("frontend_id")
        or data.get("questionId")
        or data.get("id")
    )
    return {
        "title_slug": slug,
        "title": data.get("title") or slug,
        "difficulty": raw_diff,
        "frontend_id": str(raw_fid) if raw_fid is not None else None,
    }


# ---- Snapshot + stream ------------------------------------------------------

@router.get("/snapshot")
async def admin_snapshot(request: Request, _: None = Depends(require_admin)) -> dict:
    engine = request.app.state.engine
    return engine.snapshot_dict(audience="admin")


@router.get("/stream")
async def admin_stream(request: Request, _: bool = Depends(admin_token_for_sse)):
    engine = request.app.state.engine
    sub = await broadcaster.subscribe(audience="admin")

    async def event_gen():
        yield {
            "event": "snapshot",
            "data": json.dumps(engine.snapshot_dict(audience="admin"), ensure_ascii=False, default=str),
        }
        async for item in broadcaster.stream(sub):
            if await request.is_disconnected():
                break
            yield item

    return EventSourceResponse(event_gen(), ping=15)


# ---- Times ------------------------------------------------------------------

@router.put("/times")
async def set_times(body: TimesIn, request: Request, _: None = Depends(require_admin)) -> dict:
    engine = request.app.state.engine
    try:
        await engine.set_times(body.start_time, body.end_time)
    except (ValueError, StartLockError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"ok": True}


# ---- Problems ---------------------------------------------------------------

@router.put("/problems")
async def set_problems(body: ProblemsIn, request: Request, _: None = Depends(require_admin)) -> dict:
    engine = request.app.state.engine
    client = request.app.state.lc_client
    problems: list[Problem] = []
    for p in body.problems:
        prob = Problem(**p.model_dump())
        if not prob.frontend_id:
            try:
                data = await client.get_problem(prob.title_slug)
                raw_fid = (
                    data.get("questionFrontendId")
                    or data.get("frontend_id")
                    or data.get("questionId")
                    or data.get("id")
                )
                if raw_fid is not None:
                    prob.frontend_id = str(raw_fid)
                if not prob.title:
                    prob.title = data.get("title") or prob.title_slug
            except Exception:
                pass  # best-effort; missing id is OK
        problems.append(prob)
    try:
        added, removed = await engine.set_problems(problems)
    except (ValueError, StartLockError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    return {"ok": True, "count": len(problems), "added": added, "removed": removed}


# ---- Participants -----------------------------------------------------------

@router.put("/participants/bulk")
async def bulk_upsert(body: ParticipantsBulkIn, request: Request, _: None = Depends(require_admin)) -> dict:
    engine = request.app.state.engine
    rows: list[tuple[str, str]] = []
    line_errors: list[str] = []
    reader = csv.reader(io.StringIO(body.text))
    for idx, row in enumerate(reader, start=1):
        cleaned = [c.strip() for c in row if c is not None]
        if not cleaned or all(not c for c in cleaned):
            continue
        if cleaned[0].lower() in ("username", "user", "user_name"):  # header row
            continue
        if len(cleaned) < 2:
            line_errors.append(f"line {idx}: needs `username,student_id`")
            continue
        rows.append((cleaned[0], cleaned[1]))
    try:
        created, updated, errors, new_users = await engine.upsert_participants(rows)
    except StartLockError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    # Auto-trigger profile fetch for new users.
    polling = request.app.state.polling_worker
    if polling is not None:
        for u in new_users:
            polling.enqueue_profile_fetch(u)

    return {
        "ok": True,
        "created": created,
        "updated": updated,
        "errors": line_errors + errors,
    }


@router.delete("/participants/{username}")
async def delete_participant(username: str, request: Request, _: None = Depends(require_admin)) -> dict:
    engine = request.app.state.engine
    try:
        existed = await engine.remove_participant(username)
    except StartLockError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if not existed:
        raise HTTPException(status_code=404, detail="participant not found")
    return {"ok": True}


# ---- Lifecycle controls -----------------------------------------------------

@router.post("/contest/start")
async def start_contest(request: Request, _: None = Depends(require_admin)) -> dict:
    engine = request.app.state.engine
    try:
        await engine.start_contest()
    except (ValueError, StartLockError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"ok": True, "status": engine.contest.status.value}


@router.post("/contest/end")
async def end_contest(request: Request, _: None = Depends(require_admin)) -> dict:
    engine = request.app.state.engine
    try:
        await engine.end_contest()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"ok": True, "status": engine.contest.status.value}


@router.post("/contest/reset")
async def reset_contest(body: ResetIn, request: Request, _: None = Depends(require_admin)) -> dict:
    if body.confirm != "RESET":
        raise HTTPException(status_code=400, detail='must POST {"confirm":"RESET"}')
    engine = request.app.state.engine
    await engine.reset_contest(keep_config=body.keep_config)

    # Re-queue profile fetch so any participants that hadn't yet received their
    # LC ranking / E-M-H counts get refreshed cleanly after reset.
    polling = request.app.state.polling_worker
    if polling is not None:
        for u in engine.contest.participants:
            polling.enqueue_profile_fetch(u)

    return {"ok": True, "status": engine.contest.status.value, "keep_config": body.keep_config}
