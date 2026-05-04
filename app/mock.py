"""Mock mode — replays a scripted JSON file of submissions instead of polling.

Designed so the projector / UI / animations can be exercised end-to-end
without ever touching the LeetCode API.

Script schema (`mock/sample.json`):
{
  "speed": 1.0,
  "submissions": [
    {"username": "alice", "title_slug": "two-sum", "status": "Accepted",
     "offset_sec": 5},
    {"username": "alice", "title_slug": "valid-parentheses",
     "status": "Wrong Answer", "offset_sec": 12},
    ...
  ]
}

`offset_sec` is wall time relative to the contest start time. The mock replays
items with `submitted_at = start_time + offset_sec`. When an event fires after
the wall-clock time elapses, it's ingested through the same `ingest_submissions`
path so scoring + dedupe + broadcasting all behave identically.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from datetime import timedelta
from pathlib import Path
from typing import List, Optional

from .config import Settings
from .state import ContestEngine

log = logging.getLogger("gdg.mock")


class MockSubmissionWorker:
    def __init__(self, engine: ContestEngine, settings: Settings):
        self._engine = engine
        self._cfg = settings
        self._task: Optional[asyncio.Task] = None
        self._stop = asyncio.Event()

    async def start(self) -> None:
        self._stop.clear()
        self._task = asyncio.create_task(self._run(), name="mock-worker")

    async def stop(self) -> None:
        self._stop.set()
        if self._task:
            try:
                await asyncio.wait_for(self._task, timeout=5)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                self._task.cancel()
        self._task = None

    async def _run(self) -> None:
        path = self._cfg.mock_script_path
        if not path.exists():
            log.warning("Mock script %s missing — mock worker idle", path)
            return
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as exc:
            log.error("Failed to read mock script %s: %s", path, exc)
            return

        items: List[dict] = list(data.get("submissions", []))
        speed = float(data.get("speed", 1.0)) or 1.0

        items.sort(key=lambda x: float(x.get("offset_sec", 0)))
        next_id = int(time.time()) * 1000  # unique seed for fake submission ids

        log.info("Mock worker loaded %d scripted submissions (speed=%.2f)", len(items), speed)

        # Wait until the contest starts. Once running, replay items.
        while not self._stop.is_set():
            if self._engine.contest.status.value != "running":
                await asyncio.sleep(0.5)
                continue
            start_time = self._engine.contest.start_time
            if not start_time:
                await asyncio.sleep(0.5)
                continue
            break

        for item in items:
            if self._stop.is_set():
                break
            if self._engine.contest.status.value not in ("running", "ended"):
                break

            offset = float(item.get("offset_sec", 0)) / speed
            target = start_time + timedelta(seconds=offset)
            now = _utcnow()
            if target > now:
                await asyncio.sleep(min((target - now).total_seconds(), 60))

            sub = {
                "id": str(next_id),
                "statusDisplay": item.get("status", "Accepted"),
                "titleSlug": item.get("title_slug"),
                "timestamp": int((start_time + timedelta(seconds=float(item.get("offset_sec", 0)))).timestamp()),
                "title": item.get("title", item.get("title_slug")),
            }
            next_id += 1
            await self._engine.ingest_submissions(item.get("username", ""), [sub])

        log.info("Mock worker finished script")


def _utcnow():
    from datetime import datetime, timezone
    return datetime.now(timezone.utc)
