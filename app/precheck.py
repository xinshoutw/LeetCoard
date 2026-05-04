"""Pre-check worker.

Goal: surface participants who appear to have already AC'd one of the
configured contest problems before the contest started. This is a HINT for
admins, not an automatic disqualification.

Strategy:
- Iterate (username, problem) pairs that haven't been checked yet.
- Use `/user/{username}/solved` (passes session cookie when available).
- Mark every result `confidence=full` if any session cookie was used,
  otherwise `confidence=partial` and warn the admin.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Iterable, List, Optional, Tuple

from .config import Settings
from .leetcode import LeetCodeClient, LeetCodeError
from .models import PrecheckResult
from .state import ContestEngine

log = logging.getLogger("gdg.precheck")


class PrecheckWorker:
    def __init__(self, engine: ContestEngine, client: LeetCodeClient, settings: Settings):
        self._engine = engine
        self._client = client
        self._cfg = settings
        self._task: Optional[asyncio.Task] = None
        self._stop = asyncio.Event()
        self._has_session = bool(settings.session_list)

    async def start(self, *, only_new_problems_for: Optional[Iterable[Tuple[str, str]]] = None) -> None:
        """Spawn pre-check. If `only_new_problems_for` provided, only those
        (username, slug) pairs are re-checked. Otherwise full sweep over
        unchecked pairs."""
        if self._task and not self._task.done():
            log.info("Pre-check already running; ignoring re-trigger")
            return
        self._stop.clear()
        targets = list(only_new_problems_for) if only_new_problems_for is not None else None
        self._task = asyncio.create_task(self._run(targets), name="precheck-worker")

    async def stop(self) -> None:
        self._stop.set()
        if self._task:
            try:
                await asyncio.wait_for(self._task, timeout=5)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                self._task.cancel()
        self._task = None

    async def _run(self, explicit: Optional[List[Tuple[str, str]]]) -> None:
        try:
            await self._engine.begin_precheck()
            slugs = [p.title_slug for p in self._engine.contest.problems]
            usernames = self._engine.usernames()

            already = {(r.username, r.title_slug) for r in self._engine.contest.precheck_results}
            if explicit is not None:
                pairs = [(u, s) for (u, s) in explicit if (u, s) not in already]
            else:
                pairs = [
                    (u, s)
                    for u in usernames
                    for s in slugs
                    if (u, s) not in already
                ]

            log.info("Pre-check sweeping %d pairs (%d users x %d problems)",
                     len(pairs), len(usernames), len(slugs))

            # Group by username so we only call /solved once per user.
            by_user: dict[str, List[str]] = {}
            for u, s in pairs:
                by_user.setdefault(u, []).append(s)

            for username, slug_list in by_user.items():
                if self._stop.is_set():
                    break
                results: List[PrecheckResult] = []
                try:
                    items, full = await self._client.get_solved_problems(username)
                    solved_slugs = {item.get("titleSlug") for item in items if isinstance(item, dict)}
                    confidence = "full" if full else "partial"
                    note = None if full else "Result is partial: no LEETCODE_SESSION configured."
                    for s in slug_list:
                        results.append(
                            PrecheckResult(
                                username=username,
                                student_id=self._engine.contest.participants[username].student_id,
                                title_slug=s,
                                detected=s in solved_slugs,
                                confidence=confidence,
                                note=note,
                                checked_at=datetime.now(timezone.utc),
                            )
                        )
                except LeetCodeError as exc:
                    for s in slug_list:
                        results.append(
                            PrecheckResult(
                                username=username,
                                student_id=self._engine.contest.participants[username].student_id,
                                title_slug=s,
                                detected=False,
                                confidence="partial",
                                note=f"Pre-check error: {exc}",
                                checked_at=datetime.now(timezone.utc),
                            )
                        )
                    log.warning("Pre-check error for %s: %s", username, exc)
                except KeyError:
                    # participant disappeared mid-sweep
                    continue

                await self._engine.add_precheck_results(results)

            log.info("Pre-check sweep finished")
        except Exception:
            log.exception("Pre-check worker crashed")
