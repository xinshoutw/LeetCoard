"""LeetCode API client (wraps leetcode-api-pied) with:
- async httpx
- multi-session rotation
- per-session cooldown after 429 / network errors
- everything logged but never raises beyond `LeetCodeError` to callers
"""

from __future__ import annotations

import asyncio
import logging
import random
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import List, Optional

import httpx

log = logging.getLogger("gdg.leetcode")


class LeetCodeError(RuntimeError):
    """Caller-visible error. Workers should catch this and continue."""


@dataclass
class _SessionState:
    cookie: str
    cooled_until: Optional[datetime] = None
    consecutive_failures: int = 0


@dataclass
class LeetCodeClient:
    api_base: str
    sessions: List[str]
    timeout: float = 10.0
    _client: Optional[httpx.AsyncClient] = None
    _states: List[_SessionState] = field(default_factory=list)
    _idx: int = 0
    _lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    def __post_init__(self) -> None:
        self._states = [_SessionState(cookie=c) for c in self.sessions]

    async def __aenter__(self) -> "LeetCodeClient":
        self._client = httpx.AsyncClient(timeout=self.timeout, follow_redirects=True)
        return self

    async def __aexit__(self, *exc) -> None:
        if self._client:
            await self._client.aclose()
            self._client = None

    async def aclose(self) -> None:
        if self._client:
            await self._client.aclose()
            self._client = None

    # -------- session picker --------

    async def _pick_session(self) -> Optional[_SessionState]:
        if not self._states:
            return None
        async with self._lock:
            now = datetime.now(timezone.utc)
            n = len(self._states)
            for _ in range(n):
                cand = self._states[self._idx % n]
                self._idx = (self._idx + 1) % n
                if cand.cooled_until is None or cand.cooled_until <= now:
                    return cand
            # All cooling — return the one with earliest cooldown anyway.
            return min(self._states, key=lambda s: s.cooled_until or now)

    def _cool(self, sess: Optional[_SessionState], seconds: float) -> None:
        if not sess:
            return
        sess.cooled_until = datetime.now(timezone.utc) + timedelta(seconds=seconds)
        sess.consecutive_failures += 1

    def _ok(self, sess: Optional[_SessionState]) -> None:
        if not sess:
            return
        sess.cooled_until = None
        sess.consecutive_failures = 0

    # -------- low-level GET --------

    async def _get(
        self,
        path: str,
        *,
        params: Optional[dict] = None,
        with_session: bool = False,
    ) -> dict | list:
        if not self._client:
            raise LeetCodeError("client not started")
        url = f"{self.api_base.rstrip('/')}{path}"
        params = dict(params or {})
        sess: Optional[_SessionState] = None
        if with_session:
            sess = await self._pick_session()
            if sess:
                params.setdefault("x_leetcode_session", sess.cookie)

        try:
            resp = await self._client.get(url, params=params)
        except (httpx.RequestError, asyncio.TimeoutError) as exc:
            self._cool(sess, 30)
            raise LeetCodeError(f"{path}: network {type(exc).__name__}: {exc}") from exc

        if resp.status_code == 429:
            self._cool(sess, 60)
            raise LeetCodeError(f"{path}: rate limited (429)")
        if resp.status_code >= 500:
            self._cool(sess, 30)
            raise LeetCodeError(f"{path}: upstream {resp.status_code}")
        if resp.status_code == 404:
            raise LeetCodeError(f"{path}: not found")
        if resp.status_code >= 400:
            raise LeetCodeError(f"{path}: client error {resp.status_code}")

        try:
            data = resp.json()
        except ValueError as exc:
            raise LeetCodeError(f"{path}: invalid JSON") from exc

        self._ok(sess)
        return data

    # -------- high-level wrappers --------

    async def health(self) -> bool:
        try:
            await self._get("/health")
            return True
        except LeetCodeError:
            return False

    async def get_user_profile(self, username: str) -> dict:
        data = await self._get(f"/user/{username}")
        if not isinstance(data, dict):
            raise LeetCodeError(f"unexpected user profile shape for {username}")
        return data

    async def get_problem(self, slug: str) -> dict:
        data = await self._get(f"/problem/{slug}")
        if not isinstance(data, dict):
            raise LeetCodeError(f"unexpected problem shape for {slug}")
        return data

    async def get_recent_submissions(self, username: str, limit: int = 5) -> List[dict]:
        """Returns the most recent N submissions across all problems for `username`."""
        data = await self._get(f"/user/{username}/submissions", params={"limit": limit})
        return _coerce_submission_list(data)

    async def get_solved_slugs(self, username: str) -> tuple[set[str], bool]:
        """Returns (solved_slug_set, is_full).

        leetcode-api-pied shape: {username, total_solved, solved_slugs:[...], solved:[{title_slug,...}]}
        `is_full` is True only when a session cookie was used; without one the
        upstream caps the response at ~20 most-recent.
        """
        data = await self._get(f"/user/{username}/solved", with_session=bool(self._states))
        slugs: set[str] = set()
        if isinstance(data, dict):
            raw = data.get("solved_slugs")
            if isinstance(raw, list):
                slugs.update(s for s in raw if isinstance(s, str))
            raw2 = data.get("solved")
            if isinstance(raw2, list):
                for item in raw2:
                    if isinstance(item, dict):
                        s = item.get("title_slug") or item.get("titleSlug")
                        if isinstance(s, str):
                            slugs.add(s)
        elif isinstance(data, list):
            for item in data:
                if isinstance(item, dict):
                    s = item.get("title_slug") or item.get("titleSlug")
                    if isinstance(s, str):
                        slugs.add(s)
        return slugs, bool(self._states)


def _coerce_submission_list(data) -> List[dict]:
    """leetcode-api-pied returns either a list or a wrapping object — accept both."""

    if isinstance(data, list):
        return [x for x in data if isinstance(x, dict)]
    if isinstance(data, dict):
        for key in ("submissions", "data", "recentSubmissions", "recentAcSubmissionList"):
            v = data.get(key)
            if isinstance(v, list):
                return [x for x in v if isinstance(x, dict)]
        # leetcode-api-pied sometimes inlines a single submission
        if "id" in data and "statusDisplay" in data:
            return [data]
    return []
