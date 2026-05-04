"""Tiny in-process SSE broadcaster.

Each subscriber gets its own bounded asyncio.Queue. The broadcaster fans out
events without ever blocking on a slow consumer — slow queues drop the oldest
events. This keeps a wedged client from holding up the entire scoreboard.
"""

from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Dict, Set
from uuid import uuid4

log = logging.getLogger("gdg.sse")

_QUEUE_MAX = 64


@dataclass
class _Subscriber:
    sid: str
    queue: asyncio.Queue
    audience: str = "public"  # "public" or "admin"
    dropped: int = 0


@dataclass
class Broadcaster:
    subs: Set[_Subscriber] = field(default_factory=set)
    _lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    async def subscribe(self, audience: str = "public") -> _Subscriber:
        sub = _Subscriber(sid=uuid4().hex, queue=asyncio.Queue(maxsize=_QUEUE_MAX), audience=audience)
        async with self._lock:
            self.subs.add(sub)
        log.info("SSE subscribe sid=%s audience=%s total=%d", sub.sid, audience, len(self.subs))
        return sub

    async def unsubscribe(self, sub: _Subscriber) -> None:
        async with self._lock:
            self.subs.discard(sub)
        log.info("SSE unsubscribe sid=%s total=%d", sub.sid, len(self.subs))

    def broadcast(self, event: str, data: Any, audience: str = "public") -> None:
        """Non-blocking fanout. `audience='admin'` reaches admin subscribers only;
        `audience='public'` reaches everyone."""

        payload = {"event": event, "data": data}
        for sub in list(self.subs):
            if audience == "admin" and sub.audience != "admin":
                continue
            try:
                sub.queue.put_nowait(payload)
            except asyncio.QueueFull:
                # Drop the oldest message and retry — never block the producer.
                try:
                    sub.queue.get_nowait()
                except asyncio.QueueEmpty:
                    pass
                try:
                    sub.queue.put_nowait(payload)
                    sub.dropped += 1
                except asyncio.QueueFull:
                    sub.dropped += 1

    async def stream(self, sub: _Subscriber) -> AsyncIterator[Dict[str, str]]:
        """Yield SSE-shaped dicts (sse-starlette consumes `{event, data}`)."""

        try:
            while True:
                try:
                    item = await asyncio.wait_for(sub.queue.get(), timeout=15.0)
                    yield {
                        "event": item["event"],
                        "data": json.dumps(item["data"], ensure_ascii=False, default=str),
                    }
                except asyncio.TimeoutError:
                    # Heartbeat — keeps proxies from killing the connection.
                    yield {"event": "ping", "data": json.dumps({"ts": _now_iso()})}
        finally:
            await self.unsubscribe(sub)


def _now_iso() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()


# A single process-wide broadcaster. Bound at app startup.
broadcaster = Broadcaster()
