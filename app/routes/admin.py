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

from ..auth import admin_token_for_sse, require_admin
from ..models import ContestStatus, Difficulty, Problem
from ..state import StartLockError
from ..sse import broadcaster

router = APIRouter()


# ---- Request / Response models ----------------------------------------------

class TimesIn(BaseModel):
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None


class ProblemIn(BaseModel):
    title_slug: str
    difficulty: Difficulty
    points: int = Field(ge=0)
    order: int = Field(ge=0)
    title: Optional[str] = None
    color: Optional[str] = None


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
    try:
        problems = [Problem(**p.model_dump()) for p in body.problems]
        added, removed = await engine.set_problems(problems)
    except (ValueError, StartLockError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    # Auto re-run pre-check for every participant against newly added problems.
    pre = request.app.state.precheck_worker
    if pre is not None and added and engine.contest.participants:
        pairs = [(u, s) for u in engine.contest.participants for s in added]
        await pre.start(only_new_problems_for=pairs)

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

    # Auto-run pre-check for new users against all current problems.
    pre = request.app.state.precheck_worker
    if pre is not None and new_users and engine.contest.problems:
        pairs = [(u, p.title_slug) for u in new_users for p in engine.contest.problems]
        await pre.start(only_new_problems_for=pairs)

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
    return {"ok": True, "status": engine.contest.status.value, "keep_config": body.keep_config}


@router.post("/precheck/run")
async def run_precheck(request: Request, _: None = Depends(require_admin)) -> dict:
    pre = request.app.state.precheck_worker
    if pre is None:
        raise HTTPException(status_code=503, detail="precheck worker not running (mock mode?)")
    await pre.start(transition_status=True)
    return {"ok": True}


@router.post("/broadcast/refresh")
async def force_rebroadcast(request: Request, _: None = Depends(require_admin)) -> dict:
    engine = request.app.state.engine
    broadcaster.broadcast("snapshot", engine.snapshot_dict(audience="public"))
    broadcaster.broadcast("snapshot", engine.snapshot_dict(audience="admin"), audience="admin")
    return {"ok": True}
