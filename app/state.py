"""ContestEngine — owns Contest mutations and is the single source of truth.

All routes, the polling worker, the pre-check worker, and the mock worker call
into this class. It enforces:
- state-machine transitions
- contest-time gating on scoring
- "at most one score per (user, problem)" invariant
- snapshot publishing + persistence

Frontends never compute scores or rank.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
from collections import OrderedDict
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Tuple

from .config import Settings
from .models import (
    Contest,
    ContestStatus,
    Difficulty,
    Participant,
    PollingStatus,
    PrecheckResult,
    Problem,
    SubmissionEvent,
    SubmissionStatus,
    SystemEvent,
)
from .scoring import compute_beat_bonus
from .sse import Broadcaster
from .storage import ContestStore

log = logging.getLogger("gdg.engine")

_MAX_EVENTS = 500
_MAX_SYSTEM_EVENTS = 200
_SHORT_LABELS = {
    "Accepted": "AC",
    "Wrong Answer": "WA",
    "Time Limit Exceeded": "TLE",
    "Runtime Error": "RE",
    "Compile Error": "CE",
    "Memory Limit Exceeded": "MLE",
    "Output Limit Exceeded": "OLE",
}


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _short_label(status: str) -> str:
    return _SHORT_LABELS.get(status, status[:3].upper() if status else "??")


def _extract_beat_pct(sub: dict) -> Optional[float]:
    """Try known field names for the runtime beat percentile (0–100)."""
    for key in ("runtimePercentile", "runtime_percentile", "beatPercentile", "beat_percentile"):
        v = sub.get(key)
        if v is not None:
            try:
                f = float(v)
                if 0.0 <= f <= 100.0:
                    return f
            except (TypeError, ValueError):
                pass
    return None


def _hash_color(username: str) -> str:
    """Stable colour from username; same algorithm used on frontend.
    Returns CSS oklch() string."""
    h = int(hashlib.sha1(username.encode("utf-8")).hexdigest(), 16)
    hue = h % 360
    return f"oklch(72% 0.18 {hue})"


class StartLockError(RuntimeError):
    """Raised when an admin tries to mutate locked config after contest started."""


class ContestEngine:
    def __init__(self, store: ContestStore, broadcaster: Broadcaster, settings: Settings):
        self._store = store
        self._bc = broadcaster
        self._cfg = settings
        self._lock = asyncio.Lock()

    # -------- helpers --------

    @property
    def contest(self) -> Contest:
        return self._store.contest

    def _flag_dirty_and_broadcast(self, event: str, data: dict, audience: str = "all") -> None:
        self._store.mark_dirty()
        self._bc.broadcast(event, data, audience=audience)

    def snapshot_dict(self, audience: str = "public") -> dict:
        """Full state for new SSE subscribers."""
        c = self.contest
        payload = {
            "status": c.status.value,
            "start_time": c.start_time.isoformat() if c.start_time else None,
            "end_time": c.end_time.isoformat() if c.end_time else None,
            "server_time": _utcnow().isoformat(),
            "problems": [p.model_dump(mode="json") for p in sorted(c.problems, key=lambda p: p.order)],
            "leaderboard": self._leaderboard_snapshot(),
            "events": [e.model_dump(mode="json") for e in c.events[-200:]],
        }
        if audience == "admin":
            payload["participants_admin"] = {
                k: v.model_dump(mode="json") for k, v in c.participants.items()
            }
            payload["precheck_results"] = [
                r.model_dump(mode="json") for r in c.precheck_results
            ]
            payload["polling_status"] = {
                u: s.model_dump(mode="json") for u, s in c.polling_status.items()
            }
            payload["system_events"] = [
                e.model_dump(mode="json") for e in c.system_events[-100:]
            ]
        return payload

    def _push_leaderboard(self) -> None:
        self._bc.broadcast("leaderboard_update", {"leaderboard": self._leaderboard_snapshot()})

    def _leaderboard_snapshot(self) -> List[dict]:
        ranked = self._compute_ranks()
        out: List[dict] = []
        for p in ranked:
            out.append(
                {
                    "rank": p.rank,
                    "username": p.username,
                    "student_id": p.student_id,
                    "avatar_url": p.avatar_url,
                    "color": p.color or _hash_color(p.username),
                    "score": p.score,
                    "solved_problems": sorted(p.solved_problems),
                    "reached_current_score_at": p.reached_current_score_at.isoformat()
                    if p.reached_current_score_at
                    else None,
                    # In-contest counts (only for tracked problems).
                    "easy_solved": self._count_solved_by_diff(p, Difficulty.easy),
                    "medium_solved": self._count_solved_by_diff(p, Difficulty.medium),
                    "hard_solved": self._count_solved_by_diff(p, Difficulty.hard),
                    # Pre-game info (LeetCode global stats).
                    "lc_ranking": p.lc_ranking,
                    "lc_easy_total": p.lc_easy_total,
                    "lc_medium_total": p.lc_medium_total,
                    "lc_hard_total": p.lc_hard_total,
                }
            )
        return out

    def _count_solved_by_diff(self, p: Participant, diff: Difficulty) -> int:
        diffs = {prob.title_slug: prob.difficulty for prob in self.contest.problems}
        return sum(1 for slug in p.solved_problems if diffs.get(slug) == diff)

    def _compute_ranks(self) -> List[Participant]:
        # Sort: -score, reached_current_score_at asc (never None for >0 score),
        # then username for stability.
        sentinel = datetime.max.replace(tzinfo=timezone.utc)
        plist = list(self.contest.participants.values())
        plist.sort(
            key=lambda p: (
                -p.score,
                p.reached_current_score_at or sentinel,
                p.username.lower(),
            )
        )

        # Dense-style ranking that ties only on score==0 (per spec).
        rank = 0
        last_score: Optional[int] = None
        last_rank = 0
        for idx, p in enumerate(plist, start=1):
            if p.score == 0 and last_score == 0:
                p.rank = last_rank
            else:
                rank = idx
                p.rank = rank
                last_rank = rank
            last_score = p.score
        return plist

    def _system_event(self, kind: str, message: str, level: str = "info", **detail: str) -> None:
        evt = SystemEvent(kind=kind, message=message, level=level, detail=detail or None)
        self.contest.system_events.append(evt)
        if len(self.contest.system_events) > _MAX_SYSTEM_EVENTS:
            del self.contest.system_events[:-_MAX_SYSTEM_EVENTS]
        self._bc.broadcast("system_event", evt.model_dump(mode="json"), audience="admin")

    # -------- state transitions --------

    def _ensure_unlocked(self, what: str) -> None:
        if self.contest.status in (ContestStatus.running, ContestStatus.ended):
            raise StartLockError(f"{what} cannot be modified after contest has started")

    def _ensure_unlocked_problems(self) -> None:
        # Problems & times stay locked once running. Per user feedback,
        # participants are intentionally allowed to change mid-contest.
        if self.contest.status in (ContestStatus.running, ContestStatus.ended):
            raise StartLockError("Problems cannot be modified after contest has started")

    async def set_problems(self, problems: List[Problem]) -> Tuple[List[str], List[str]]:
        """Returns (added_slugs, removed_slugs) so the caller can fire pre-check
        only on newly added problems."""
        async with self._lock:
            self._ensure_unlocked_problems()
            seen_slugs = set()
            for p in problems:
                if p.title_slug in seen_slugs:
                    raise ValueError(f"Duplicate problem slug: {p.title_slug}")
                seen_slugs.add(p.title_slug)
            old_slugs = {p.title_slug for p in self.contest.problems}
            new_slugs = {p.title_slug for p in problems}
            added = sorted(new_slugs - old_slugs)
            removed = sorted(old_slugs - new_slugs)
            self.contest.problems = sorted(problems, key=lambda p: p.order)
            self._system_event(
                "problems_updated",
                f"{len(problems)} problems · +{len(added)} -{len(removed)}",
            )
            self._flag_dirty_and_broadcast(
                "problems_updated",
                {"problems": [p.model_dump(mode="json") for p in self.contest.problems]},
            )
        return added, removed

    async def upsert_participants(self, rows: List[Tuple[str, str]]) -> Tuple[int, int, List[str], List[str]]:
        """Bulk add/update; returns (created, updated, errors, new_usernames).
        Participants are intentionally NOT locked during running."""
        created = 0
        updated = 0
        errors: List[str] = []
        new_usernames: List[str] = []
        async with self._lock:
            for username, sid in rows:
                u = (username or "").strip()
                s = (sid or "").strip()
                if not u or not s:
                    errors.append(f"Empty username or student id: '{username}','{sid}'")
                    continue
                if u in self.contest.participants:
                    self.contest.participants[u].student_id = s
                    updated += 1
                else:
                    self.contest.participants[u] = Participant(
                        username=u, student_id=s, color=_hash_color(u)
                    )
                    created += 1
                    new_usernames.append(u)
            self._system_event(
                "participants_updated",
                f"{created} created, {updated} updated, {len(errors)} errors",
            )
            self._flag_dirty_and_broadcast(
                "participants_updated",
                {"count": len(self.contest.participants)},
                audience="admin",
            )
            self._push_leaderboard()
        return created, updated, errors, new_usernames

    async def remove_participant(self, username: str) -> bool:
        async with self._lock:
            existed = self.contest.participants.pop(username, None) is not None
            if existed:
                self._system_event("participant_removed", f"removed {username}")
                self._flag_dirty_and_broadcast(
                    "participants_updated",
                    {"count": len(self.contest.participants)},
                    audience="admin",
                )
                self._push_leaderboard()
            return existed

    async def update_profile(self, username: str, *, avatar_url: Optional[str], lc_ranking: Optional[int],
                              easy_total: int, medium_total: int, hard_total: int) -> None:
        async with self._lock:
            p = self.contest.participants.get(username)
            if not p:
                return
            p.avatar_url = avatar_url or p.avatar_url
            p.lc_ranking = lc_ranking
            p.lc_easy_total = easy_total
            p.lc_medium_total = medium_total
            p.lc_hard_total = hard_total
            p.profile_fetched_at = _utcnow()
            self._store.mark_dirty()
        self._push_leaderboard()

    async def set_times(self, start: Optional[datetime], end: Optional[datetime]) -> None:
        async with self._lock:
            self._ensure_unlocked("Times")
            if start and end and end <= start:
                raise ValueError("End time must be strictly after start time")
            self.contest.start_time = start
            self.contest.end_time = end
            self._system_event(
                "times_updated",
                f"start={start.isoformat() if start else 'null'} "
                f"end={end.isoformat() if end else 'null'}",
            )
            self._flag_dirty_and_broadcast(
                "times_updated",
                {
                    "start_time": start.isoformat() if start else None,
                    "end_time": end.isoformat() if end else None,
                },
            )

    async def set_status(self, status: ContestStatus) -> None:
        """Used internally for transitions; routes go through start/end/precheck."""
        async with self._lock:
            self.contest.status = status
            self._flag_dirty_and_broadcast(
                "contest_status",
                {
                    "status": status.value,
                    "start_time": self.contest.start_time.isoformat()
                    if self.contest.start_time
                    else None,
                    "end_time": self.contest.end_time.isoformat()
                    if self.contest.end_time
                    else None,
                },
            )

    async def start_contest(self) -> None:
        async with self._lock:
            if self.contest.status not in (ContestStatus.setup, ContestStatus.precheck):
                raise ValueError(f"Cannot start from status {self.contest.status.value}")
            if not self.contest.start_time or not self.contest.end_time:
                raise ValueError("Start and end times must be set before starting")
            if not self.contest.problems:
                raise ValueError("At least one problem must be configured")
            if not self.contest.participants:
                raise ValueError("At least one participant must be added")
            self.contest.status = ContestStatus.running
            self.contest.last_started_at = _utcnow()
            self._system_event("contest_started", "running")
        await self.set_status(ContestStatus.running)
        await self._store.flush_now()

    async def end_contest(self) -> None:
        async with self._lock:
            self.contest.status = ContestStatus.ended
            self.contest.last_ended_at = _utcnow()
            self._system_event("contest_ended", "ended")
        await self.set_status(ContestStatus.ended)
        await self._store.flush_now()

    async def begin_precheck(self) -> None:
        async with self._lock:
            if self.contest.status != ContestStatus.setup:
                # idempotent re-runs allowed only from setup; still allow re-run from precheck
                if self.contest.status != ContestStatus.precheck:
                    raise ValueError(f"Pre-check only valid from setup/precheck, "
                                     f"not {self.contest.status.value}")
            self.contest.status = ContestStatus.precheck
            self._system_event("precheck_started", "running pre-check")
        await self.set_status(ContestStatus.precheck)

    async def reset_contest(self, *, keep_config: bool) -> None:
        async with self._lock:
            problems = list(self.contest.problems) if keep_config else []
            participants = (
                {
                    u: Participant(
                        username=u,
                        student_id=p.student_id,
                        color=p.color,
                        avatar_url=p.avatar_url,
                        lc_ranking=p.lc_ranking,
                        lc_easy_total=p.lc_easy_total,
                        lc_medium_total=p.lc_medium_total,
                        lc_hard_total=p.lc_hard_total,
                        profile_fetched_at=p.profile_fetched_at,
                    )
                    for u, p in self.contest.participants.items()
                }
                if keep_config
                else {}
            )
            self._store._contest = Contest(
                status=ContestStatus.setup,
                problems=problems,
                participants=participants,
                start_time = None,
                end_time = None,
                # start_time=self.contest.start_time, if keep_config else None,
                # end_time=self.contest.end_time if keep_config else None,
                last_reset_at=_utcnow(),
            )
            self._system_event("reset", f"keep_config={keep_config}")
        # Send reset to BOTH audiences with audience-specific snapshots so the
        # admin dashboard doesn't lose its admin-only fields.
        self._store.mark_dirty()
        self._bc.broadcast(
            "contest_reset",
            {"keep_config": keep_config, "snapshot": self.snapshot_dict("public")},
            audience="public",
        )
        self._bc.broadcast(
            "contest_reset",
            {"keep_config": keep_config, "snapshot": self.snapshot_dict("admin")},
            audience="admin",
        )
        self._push_leaderboard()
        await self._store.flush_now()

    # -------- precheck ingestion --------

    async def add_precheck_results(self, results: List[PrecheckResult]) -> None:
        async with self._lock:
            existing_keys = {(r.username, r.title_slug) for r in self.contest.precheck_results}
            for r in results:
                key = (r.username, r.title_slug)
                if key in existing_keys:
                    # replace previous entry rather than duplicating
                    self.contest.precheck_results = [
                        x for x in self.contest.precheck_results if (x.username, x.title_slug) != key
                    ]
                self.contest.precheck_results.append(r)
            self._system_event("precheck_update", f"{len(results)} results recorded")
        self._flag_dirty_and_broadcast(
            "precheck_update",
            {"results": [r.model_dump(mode="json") for r in self.contest.precheck_results]},
            audience="admin",
        )

    # -------- polling status --------

    async def update_polling(self, username: str, **fields) -> None:
        async with self._lock:
            cur = self.contest.polling_status.get(username) or PollingStatus(username=username)
            data = cur.model_dump()
            data.update(fields)
            self.contest.polling_status[username] = PollingStatus(**data)
            self._store.mark_dirty()
        self._bc.broadcast(
            "polling_status",
            {
                "username": username,
                **{k: v.isoformat() if isinstance(v, datetime) else v for k, v in fields.items()},
            },
            audience="admin",
        )

    # -------- submission ingestion (the scoring path) --------

    async def ingest_submissions(self, username: str, raw_submissions: List[dict]) -> None:
        """Apply scoring rules to a batch of LeetCode-shaped submissions.

        `raw_submissions` is the list returned by `/user/{username}/submissions`,
        each containing at least: id, statusDisplay, titleSlug, timestamp.
        """

        if not raw_submissions:
            return
        async with self._lock:
            participant = self.contest.participants.get(username)
            if not participant:
                return  # ignore submissions for unknown users (defensive)

            tracked = {p.title_slug: p for p in self.contest.problems}
            new_events: List[SubmissionEvent] = []

            for sub in raw_submissions:
                sub_id = str(sub.get("id") or "")
                if not sub_id or sub_id in self.contest.seen_submission_ids:
                    continue
                slug = sub.get("titleSlug") or sub.get("title_slug")
                status_disp = sub.get("statusDisplay") or sub.get("status") or "Other"
                ts_raw = sub.get("timestamp")
                if not slug or ts_raw is None:
                    self.contest.seen_submission_ids.add(sub_id)
                    continue
                try:
                    submitted_at = datetime.fromtimestamp(int(ts_raw), tz=timezone.utc)
                except (TypeError, ValueError):
                    self.contest.seen_submission_ids.add(sub_id)
                    continue

                # Always mark seen so we don't reprocess on next poll.
                self.contest.seen_submission_ids.add(sub_id)

                problem = tracked.get(slug)
                if not problem:
                    continue  # untracked problem → not even an event

                is_accepted = status_disp == SubmissionStatus.accepted.value
                is_scoring = False
                points_delta = 0
                bonus_delta = 0
                beat_pct: Optional[float] = None
                note: Optional[str] = None

                # Time-window gating — even AC outside window does not score.
                in_window = (
                    self.contest.start_time is not None
                    and self.contest.end_time is not None
                    and self.contest.start_time <= submitted_at <= self.contest.end_time
                )

                if is_accepted:
                    # Always read beat % so the event feed can display it,
                    # even when the submission doesn't end up scoring.
                    beat_pct = _extract_beat_pct(sub)
                    new_bonus = compute_beat_bonus(beat_pct, problem.beat_bonus_tiers)

                    if not in_window:
                        note = "outside contest window"
                    elif slug not in participant.solved_problems:
                        # First AC — base points + initial bonus.
                        is_scoring = True
                        bonus_delta = new_bonus
                        points_delta = problem.points + bonus_delta
                        participant.solved_problems.add(slug)
                        participant.problem_first_ac_at[slug] = submitted_at
                        participant.problem_bonus_pts[slug] = new_bonus
                        if beat_pct is not None:
                            participant.problem_best_beat_pct[slug] = beat_pct
                        participant.score += points_delta
                        participant.reached_current_score_at = submitted_at
                    else:
                        # Already solved — re-AC may upgrade the bonus if beat % improved.
                        old_bonus = participant.problem_bonus_pts.get(slug, 0)
                        if new_bonus > old_bonus:
                            is_scoring = True
                            bonus_delta = new_bonus - old_bonus
                            points_delta = bonus_delta
                            participant.problem_bonus_pts[slug] = new_bonus
                            if beat_pct is not None:
                                participant.problem_best_beat_pct[slug] = max(
                                    participant.problem_best_beat_pct.get(slug, 0.0), beat_pct,
                                )
                            participant.score += bonus_delta
                            participant.reached_current_score_at = submitted_at
                            note = f"bonus +{old_bonus}→+{new_bonus}"
                        else:
                            note = f"already scored (+{old_bonus} bonus)"

                evt = SubmissionEvent(
                    submission_id=sub_id,
                    username=username,
                    student_id=participant.student_id,
                    title_slug=slug,
                    title=problem.title or slug,
                    status=status_disp,
                    short_label=_short_label(status_disp),
                    submitted_at=submitted_at,
                    points_delta=points_delta,
                    bonus_delta=bonus_delta,
                    beat_pct=beat_pct,
                    is_accepted=is_accepted,
                    is_scoring=is_scoring,
                    note=note,
                )
                self.contest.events.append(evt)
                new_events.append(evt)

            if len(self.contest.events) > _MAX_EVENTS:
                self.contest.events = self.contest.events[-_MAX_EVENTS:]

            if new_events:
                self._store.mark_dirty()

        if not new_events:
            return

        # Push events + refreshed leaderboard *outside* the lock.
        for evt in new_events:
            self._bc.broadcast("submission_event", evt.model_dump(mode="json"))
        if any(e.is_scoring for e in new_events):
            self._push_leaderboard()

    # -------- contest-time helpers used by routes / workers --------

    def is_polling_window(self) -> bool:
        c = self.contest
        if c.status == ContestStatus.running:
            return True
        if c.status == ContestStatus.ended and c.last_ended_at:
            return _utcnow() - c.last_ended_at < timedelta(seconds=self._cfg.post_end_grace_sec)
        return False

    def is_within_contest_window(self, t: datetime) -> bool:
        c = self.contest
        return bool(c.start_time and c.end_time and c.start_time <= t <= c.end_time)

    def usernames(self) -> List[str]:
        return list(self.contest.participants.keys())
