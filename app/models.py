"""Pydantic models for contest state, persisted as JSON.

Time policy: every datetime stored here is timezone-aware UTC.
The frontend converts to the projector's local timezone for display.
"""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Dict, List, Optional, Set
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class ContestStatus(str, Enum):
    setup = "setup"
    precheck = "precheck"
    running = "running"
    ended = "ended"


class Difficulty(str, Enum):
    easy = "easy"
    medium = "medium"
    hard = "hard"


class Problem(BaseModel):
    title_slug: str
    difficulty: Difficulty
    points: int = Field(ge=0)
    order: int = Field(ge=0)
    title: Optional[str] = None  # cached display name from /problem/{slug}
    color: Optional[str] = None  # css colour for status pip; defaults from difficulty


class Participant(BaseModel):
    username: str
    student_id: str
    avatar_url: Optional[str] = None
    color: Optional[str] = None  # frontend uses username hash if absent
    score: int = 0
    rank: int = 0
    solved_problems: Set[str] = Field(default_factory=set)
    problem_first_ac_at: Dict[str, datetime] = Field(default_factory=dict)
    reached_current_score_at: Optional[datetime] = None
    added_at: datetime = Field(default_factory=_utcnow)

    # LeetCode profile snapshot (refreshed by polling worker / on add).
    lc_ranking: Optional[int] = None
    lc_easy_total: int = 0
    lc_medium_total: int = 0
    lc_hard_total: int = 0
    profile_fetched_at: Optional[datetime] = None

    model_config = ConfigDict(arbitrary_types_allowed=True)


class SubmissionStatus(str, Enum):
    accepted = "Accepted"
    wrong_answer = "Wrong Answer"
    time_limit_exceeded = "Time Limit Exceeded"
    runtime_error = "Runtime Error"
    compile_error = "Compile Error"
    memory_limit_exceeded = "Memory Limit Exceeded"
    output_limit_exceeded = "Output Limit Exceeded"
    other = "Other"


class SubmissionEvent(BaseModel):
    """Anything that should appear in the right-side event feed."""

    id: str = Field(default_factory=lambda: uuid4().hex)
    submission_id: Optional[str] = None  # provider-side id, e.g. LeetCode submission id
    username: str
    student_id: str
    title_slug: str
    title: Optional[str] = None
    status: str  # raw provider string ("Accepted", "Wrong Answer", ...)
    short_label: str  # AC, WA, TLE, RE, CE, MLE, OLE, ...
    submitted_at: datetime
    detected_at: datetime = Field(default_factory=_utcnow)
    points_delta: int = 0
    is_accepted: bool = False
    is_scoring: bool = False  # True only if it actually awarded points (first valid AC)
    note: Optional[str] = None  # e.g. "outside contest window", "duplicate"


class PrecheckResult(BaseModel):
    username: str
    student_id: str
    title_slug: str
    detected: bool
    checked_at: datetime = Field(default_factory=_utcnow)
    confidence: str  # "full" if session cookie used, "partial" otherwise
    note: Optional[str] = None


class PollingStatus(BaseModel):
    username: str
    last_checked_at: Optional[datetime] = None
    last_success_at: Optional[datetime] = None
    last_error: Optional[str] = None
    next_check_at: Optional[datetime] = None
    consecutive_errors: int = 0


class SystemEvent(BaseModel):
    """Operator-visible system events (contest start/stop, API errors, etc.)."""

    id: str = Field(default_factory=lambda: uuid4().hex)
    at: datetime = Field(default_factory=_utcnow)
    level: str = "info"  # info | warn | error
    kind: str  # contest_started | contest_ended | api_error | reset | ...
    message: str
    detail: Optional[Dict[str, str]] = None


class Contest(BaseModel):
    """Full persistent contest state. Mirrored to disk as JSON on every change."""

    status: ContestStatus = ContestStatus.setup
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None

    problems: List[Problem] = Field(default_factory=list)
    participants: Dict[str, Participant] = Field(default_factory=dict)  # keyed by username

    seen_submission_ids: Set[str] = Field(default_factory=set)

    events: List[SubmissionEvent] = Field(default_factory=list)
    system_events: List[SystemEvent] = Field(default_factory=list)
    precheck_results: List[PrecheckResult] = Field(default_factory=list)
    polling_status: Dict[str, PollingStatus] = Field(default_factory=dict)

    last_started_at: Optional[datetime] = None
    last_ended_at: Optional[datetime] = None
    last_reset_at: Optional[datetime] = None

    model_config = ConfigDict(arbitrary_types_allowed=True)


def default_contest() -> Contest:
    """Default factory — used on cold-boot when no JSON file exists."""

    default_problems = [
        Problem(title_slug="two-sum", difficulty=Difficulty.easy, points=1, order=0),
        Problem(title_slug="valid-parentheses", difficulty=Difficulty.easy, points=1, order=1),
        Problem(title_slug="3sum", difficulty=Difficulty.medium, points=3, order=2),
        Problem(title_slug="trapping-rain-water", difficulty=Difficulty.hard, points=5, order=3),
    ]
    return Contest(problems=default_problems)
