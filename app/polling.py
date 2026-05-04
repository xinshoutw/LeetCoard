"""Polling worker.

Schedules per-user submission fetches with jittered intervals so requests
spread evenly across the global window. Errors on any single user are
isolated — a failure for `alice` never stops polling for `bob`.
"""

from __future__ import annotations

import asyncio
import logging
import random
from datetime import datetime, timedelta, timezone
from typing import Optional

from .config import Settings
from .leetcode import LeetCodeClient, LeetCodeError
from .state import ContestEngine

log = logging.getLogger("gdg.polling")


class PollingWorker:
    def __init__(self, engine: ContestEngine, client: LeetCodeClient, settings: Settings):
        self._engine = engine
        self._client = client
        self._cfg = settings
        self._task: Optional[asyncio.Task] = None
        self._stop = asyncio.Event()

    async def start(self) -> None:
        self._stop.clear()
        self._task = asyncio.create_task(self._loop(), name="polling-worker")

    async def stop(self) -> None:
        self._stop.set()
        if self._task:
            try:
                await asyncio.wait_for(self._task, timeout=5)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                self._task.cancel()
        self._task = None

    async def _loop(self) -> None:
        # Per-user next-due times. Initialised on first sight.
        next_due: dict[str, datetime] = {}
        log.info("Polling worker started")
        while not self._stop.is_set():
            try:
                if not self._engine.is_polling_window():
                    await asyncio.sleep(2)
                    continue

                usernames = self._engine.usernames()
                if not usernames:
                    await asyncio.sleep(2)
                    continue

                now = datetime.now(timezone.utc)
                base = self._cfg.poll_interval_sec
                jitter = self._cfg.poll_jitter

                # Initialise stagger: spread first-due times across one base window.
                for i, u in enumerate(usernames):
                    if u not in next_due:
                        offset = (i * base / max(1, len(usernames))) + random.uniform(0, base * jitter)
                        next_due[u] = now + timedelta(seconds=offset)

                # Pick all due users; this batch runs concurrently.
                due = [u for u, t in next_due.items() if t <= now]
                if not due:
                    sleep_for = max(0.1, min((next_due[u] - now).total_seconds() for u in usernames))
                    await asyncio.sleep(min(sleep_for, 1.0))
                    continue

                tasks = [self._poll_one(u) for u in due]
                await asyncio.gather(*tasks, return_exceptions=True)

                # Reschedule polled users.
                for u in due:
                    delay = base * (1 + random.uniform(-jitter, jitter))
                    next_due[u] = datetime.now(timezone.utc) + timedelta(seconds=max(0.5, delay))

                # Drop next_due entries for participants that no longer exist.
                stale = set(next_due) - set(usernames)
                for u in stale:
                    next_due.pop(u, None)

            except Exception:
                log.exception("Polling loop hiccup; sleeping 2s")
                await asyncio.sleep(2)

    async def _poll_one(self, username: str) -> None:
        try:
            subs = await self._client.get_recent_submissions(
                username, limit=self._cfg.poll_recent_limit
            )
            await self._engine.ingest_submissions(username, subs)
            await self._engine.update_polling(
                username,
                last_checked_at=datetime.now(timezone.utc),
                last_success_at=datetime.now(timezone.utc),
                last_error=None,
                consecutive_errors=0,
                next_check_at=None,
            )
        except LeetCodeError as exc:
            await self._engine.update_polling(
                username,
                last_checked_at=datetime.now(timezone.utc),
                last_error=str(exc),
                consecutive_errors=(self._engine.contest.polling_status.get(username).consecutive_errors + 1)
                if self._engine.contest.polling_status.get(username)
                else 1,
            )
            log.warning("Poll failed for %s: %s", username, exc)
        except Exception:
            log.exception("Unexpected polling error for %s", username)
            await self._engine.update_polling(
                username,
                last_checked_at=datetime.now(timezone.utc),
                last_error="internal error",
            )
