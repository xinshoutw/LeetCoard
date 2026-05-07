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
    running = "running"
    ended = "ended"


class Difficulty(str, Enum):
    easy = "easy"
    medium = "medium"
    hard = "hard"


class BonusTier(BaseModel):
    """One bracket in the runtime-beat-% bonus table.

    Example: BonusTier(min_beat_pct=95.0, bonus_pts=3) awards +3 points
    when the submission beats ≥ 95 % of LeetCode runtime submissions.
    """

    min_beat_pct: float = Field(ge=0.0, le=100.0)
    bonus_pts: int = Field(ge=0)


class Problem(BaseModel):
    title_slug: str
    difficulty: Difficulty
    points: int = Field(ge=0)
    order: int = Field(ge=0)
    title: Optional[str] = None  # cached display name from /problem/{slug}
    frontend_id: Optional[str] = None  # LeetCode official problem number, e.g. "1", "1768"
    color: Optional[str] = None  # css colour for status pip; defaults from difficulty
    beat_bonus_tiers: List[BonusTier] = Field(default_factory=list)


class Participant(BaseModel):
    username: str
    student_id: str
    avatar_url: Optional[str] = None
    color: Optional[str] = None  # frontend uses username hash if absent
    score: int = 0
    rank: int = 0
    solved_problems: Set[str] = Field(default_factory=set)
    problem_first_ac_at: Dict[str, datetime] = Field(default_factory=dict)
    problem_bonus_pts: Dict[str, int] = Field(default_factory=dict)  # current bonus per problem (upgradable)
    problem_best_beat_pct: Dict[str, float] = Field(default_factory=dict)  # best beat% seen so far
    problem_ac_count: Dict[str, int] = Field(default_factory=dict)  # in-window AC count per problem
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
    points_delta: int = 0       # total points awarded (base + bonus)
    bonus_delta: int = 0        # bonus portion of points_delta (from beat-% tiers)
    beat_pct: Optional[float] = None  # runtime beat percentile reported by LeetCode
    is_accepted: bool = False
    is_scoring: bool = False  # True only if it actually awarded points (first valid AC)
    is_overflow: bool = False  # True for AC #4+ on a problem (not counted toward bonus)
    is_tracked: bool = True    # False for submissions to non-contest problems
    note: Optional[str] = None  # e.g. "outside contest window", "duplicate"


class Contest(BaseModel):
    """Full persistent contest state. Mirrored to disk as JSON on every change."""

    status: ContestStatus = ContestStatus.setup
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None

    problems: List[Problem] = Field(default_factory=list)
    participants: Dict[str, Participant] = Field(default_factory=dict)  # keyed by username

    seen_submission_ids: Set[str] = Field(default_factory=set)

    events: List[SubmissionEvent] = Field(default_factory=list)

    last_started_at: Optional[datetime] = None
    last_ended_at: Optional[datetime] = None
    last_reset_at: Optional[datetime] = None

    model_config = ConfigDict(arbitrary_types_allowed=True)


def default_contest() -> Contest:
    """Cold-boot factory — empty contest in setup state."""

    return Contest()
