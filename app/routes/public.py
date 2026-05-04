"""Public, read-only endpoints for the projector scoreboard."""

from __future__ import annotations

from fastapi import APIRouter, Request
from sse_starlette.sse import EventSourceResponse

from ..sse import broadcaster

router = APIRouter()


@router.get("/snapshot")
async def snapshot(request: Request) -> dict:
    engine = request.app.state.engine
    return engine.snapshot_dict(audience="public")


@router.get("/stream")
async def stream(request: Request):
    engine = request.app.state.engine
    sub = await broadcaster.subscribe(audience="public")

    async def event_gen():
        # Push current snapshot first.
        yield {
            "event": "snapshot",
            "data": _json(engine.snapshot_dict(audience="public")),
        }
        async for item in broadcaster.stream(sub):
            if await request.is_disconnected():
                break
            yield item

    return EventSourceResponse(event_gen(), ping=15)


def _json(obj) -> str:
    import json

    return json.dumps(obj, ensure_ascii=False, default=str)


@router.get("/health")
async def health() -> dict:
    return {"ok": True}
