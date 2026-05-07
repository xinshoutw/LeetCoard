"""Time-based contest scheduler.

Watches `start_time` / `end_time` and auto-fires `start_contest()` /
`end_contest()` when the wall clock crosses them, so the admin doesn't have to
hover over the dashboard at the exact second.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional

from ..domain.models import ContestStatus
from ..domain.state import ContestEngine

log = logging.getLogger("gdg.scheduler")


class ContestScheduler:
    def __init__(self, engine: ContestEngine):
        self._engine = engine
        self._task: Optional[asyncio.Task] = None
        self._stop = asyncio.Event()

    async def start(self) -> None:
        self._stop.clear()
        self._task = asyncio.create_task(self._loop(), name="contest-scheduler")

    async def stop(self) -> None:
        self._stop.set()
        if self._task:
            try:
                await asyncio.wait_for(self._task, timeout=3)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                self._task.cancel()
        self._task = None

    async def _loop(self) -> None:
        log.info("Contest scheduler running")
        while not self._stop.is_set():
            try:
                now = datetime.now(timezone.utc)
                contest = self._engine.contest
                start = contest.start_time
                end = contest.end_time

                # Auto-start: status setup and start_time has arrived
                if (
                    contest.status == ContestStatus.setup
                    and start is not None
                    and end is not None
                    and contest.problems
                    and contest.participants
                    and now >= start
                ):
                    log.info("Auto-starting contest at scheduled start_time")
                    try:
                        await self._engine.start_contest()
                    except Exception:
                        log.exception("Auto-start failed")

                # Auto-end: status running and end_time has passed
                if (
                    contest.status == ContestStatus.running
                    and end is not None
                    and now >= end
                ):
                    log.info("Auto-ending contest at scheduled end_time")
                    try:
                        await self._engine.end_contest()
                    except Exception:
                        log.exception("Auto-end failed")

                await asyncio.sleep(1.0)
            except asyncio.CancelledError:
                break
            except Exception:
                log.exception("Scheduler tick failed")
                await asyncio.sleep(2.0)
