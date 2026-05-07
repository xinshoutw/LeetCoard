"""Polling worker.

Schedules per-user submission fetches with jittered intervals so requests
spread evenly across the global window. Errors on any single user are
isolated — a failure for `alice` never stops polling for `bob`.

Also runs a low-priority profile-fetch loop (avatar, LC ranking, AC totals
by difficulty), exposed via `enqueue_profile_fetch()`.
"""

from __future__ import annotations

import asyncio
import logging
import random
from datetime import datetime, timedelta, timezone
from typing import Optional, Set

from ..core.config import Settings
from ..domain.state import ContestEngine
from ..integrations.leetcode import LeetCodeClient, LeetCodeError

log = logging.getLogger("gdg.polling")

PROFILE_REFRESH_SEC = 600  # refresh every 10 min while contest is live


class PollingWorker:
    def __init__(self, engine: ContestEngine, client: LeetCodeClient, settings: Settings) -> None:
        self._engine = engine
        self._client = client
        self._cfg = settings
        self._task: Optional[asyncio.Task] = None
        self._profile_task: Optional[asyncio.Task] = None
        self._stop = asyncio.Event()
        self._profile_queue: asyncio.Queue[str] = asyncio.Queue()
        self._enqueued: Set[str] = set()

    async def start(self) -> None:
        self._stop.clear()
        # Seed profile fetches for participants already loaded from disk.
        for u in self._engine.usernames():
            self.enqueue_profile_fetch(u)
        self._task = asyncio.create_task(self._loop(), name="polling-worker")
        self._profile_task = asyncio.create_task(self._profile_loop(), name="polling-profile")

    async def stop(self) -> None:
        self._stop.set()
        for t in (self._task, self._profile_task):
            if t is None:
                continue
            try:
                await asyncio.wait_for(t, timeout=5)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                t.cancel()
        self._task = None
        self._profile_task = None

    def enqueue_profile_fetch(self, username: str) -> None:
        """Schedule a profile/avatar fetch for `username`. Idempotent per pending."""
        if username in self._enqueued:
            return
        self._enqueued.add(username)
        try:
            self._profile_queue.put_nowait(username)
        except asyncio.QueueFull:
            self._enqueued.discard(username)

    async def _profile_loop(self) -> None:
        log.info("Polling profile loop started")
        next_refresh = datetime.now(timezone.utc) + timedelta(seconds=PROFILE_REFRESH_SEC)
        while not self._stop.is_set():
            try:
                now = datetime.now(timezone.utc)
                if now >= next_refresh:
                    for u in self._engine.usernames():
                        self.enqueue_profile_fetch(u)
                    next_refresh = now + timedelta(seconds=PROFILE_REFRESH_SEC)
                try:
                    username = await asyncio.wait_for(self._profile_queue.get(), timeout=1.0)
                except asyncio.TimeoutError:
                    continue
                self._enqueued.discard(username)
                await self._fetch_profile(username)
            except asyncio.CancelledError:
                break
            except Exception:
                log.exception("Profile loop hiccup")
                await asyncio.sleep(2)

    async def _fetch_profile(self, username: str) -> None:
        try:
            data = await self._client.get_user_profile(username)
        except LeetCodeError as exc:
            log.warning("Profile fetch failed for %s: %s", username, exc)
            return
        profile = data.get("profile") or {}
        stats = (data.get("submitStats") or {}).get("acSubmissionNum") or []
        easy = medium = hard = 0
        for row in stats:
            d = (row.get("difficulty") or "").lower()
            c = int(row.get("count") or 0)
            if d == "easy":
                easy = c
            elif d == "medium":
                medium = c
            elif d == "hard":
                hard = c
        await self._engine.update_profile(
            username,
            avatar_url=profile.get("userAvatar"),
            lc_ranking=profile.get("ranking"),
            easy_total=easy,
            medium_total=medium,
            hard_total=hard,
        )

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

                for i, u in enumerate(usernames):
                    if u not in next_due:
                        offset = (i * base / max(1, len(usernames))) + random.uniform(0, base * jitter)
                        next_due[u] = now + timedelta(seconds=offset)

                due = [u for u, t in next_due.items() if t <= now]
                if not due:
                    sleep_for = max(0.1, min((next_due[u] - now).total_seconds() for u in usernames))
                    await asyncio.sleep(min(sleep_for, 1.0))
                    continue

                tasks = [self._poll_one(u) for u in due]
                await asyncio.gather(*tasks, return_exceptions=True)

                for u in due:
                    delay = base * (1 + random.uniform(-jitter, jitter))
                    next_due[u] = datetime.now(timezone.utc) + timedelta(seconds=max(0.5, delay))

                stale = set(next_due) - set(usernames)
                for u in stale:
                    next_due.pop(u, None)

            except Exception:
                log.exception("Polling loop hiccup; sleeping 2s")
                await asyncio.sleep(2)

    async def _enrich_runtime_percentile(self, subs: list[dict]) -> None:
        """Best-effort: inject `runtimePercentile` into new AC submissions.

        leetcode-api-pied's submission list lacks beat-%; we fetch each new AC's
        detail via LeetCode GraphQL. Skips already-seen ids to bound API load.
        Any failure is silent — beat-% bonus simply doesn't apply for that submission.
        """
        seen = self._engine.contest.seen_submission_ids
        targets = [
            s for s in subs
            if (s.get("statusDisplay") or s.get("status")) == "Accepted"
            and "runtimePercentile" not in s
            and str(s.get("id") or "") not in seen
            and s.get("id") is not None
        ]
        for s in targets:
            sub_id = str(s["id"])
            pct = await self._client.get_submission_runtime_percentile(sub_id)
            if pct is not None:
                s["runtimePercentile"] = pct

    async def _poll_one(self, username: str) -> None:
        try:
            subs = await self._client.get_recent_submissions(
                username, limit=self._cfg.poll_recent_limit
            )
            await self._enrich_runtime_percentile(subs)
            await self._engine.ingest_submissions(username, subs)
        except LeetCodeError as exc:
            log.warning("Poll failed for %s: %s", username, exc)
        except Exception:
            log.exception("Unexpected polling error for %s", username)
