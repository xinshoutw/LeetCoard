"""Tests for the beat-% bonus scoring feature."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from app.core.config import Settings
from app.core.scoring import compute_beat_bonus
from app.core.sse import Broadcaster
from app.core.storage import ContestStore
from app.domain.models import BonusTier, Contest, ContestStatus, Difficulty, Participant, Problem
from app.domain.state import ContestEngine

# ---------------------------------------------------------------------------
# Pure-function tests — compute_beat_bonus
# ---------------------------------------------------------------------------

TIERS = [
    BonusTier(min_beat_pct=95.0, bonus_pts=3),
    BonusTier(min_beat_pct=80.0, bonus_pts=2),
    BonusTier(min_beat_pct=60.0, bonus_pts=1),
]


def test_no_tiers_returns_zero():
    assert compute_beat_bonus(98.0, []) == 0


def test_none_beat_pct_returns_zero():
    assert compute_beat_bonus(None, TIERS) == 0


def test_highest_qualifying_tier_wins():
    assert compute_beat_bonus(98.0, TIERS) == 3
    assert compute_beat_bonus(85.0, TIERS) == 2
    assert compute_beat_bonus(65.0, TIERS) == 1


def test_below_all_thresholds_returns_zero():
    assert compute_beat_bonus(59.9, TIERS) == 0


def test_exact_threshold_qualifies():
    assert compute_beat_bonus(95.0, TIERS) == 3
    assert compute_beat_bonus(80.0, TIERS) == 2
    assert compute_beat_bonus(60.0, TIERS) == 1


def test_single_tier():
    tiers = [BonusTier(min_beat_pct=50.0, bonus_pts=5)]
    assert compute_beat_bonus(50.0, tiers) == 5
    assert compute_beat_bonus(49.9, tiers) == 0


# ---------------------------------------------------------------------------
# Integration tests — bonus flows through ingest_submissions
# ---------------------------------------------------------------------------

def _make_engine(tmp_path: Path) -> ContestEngine:
    settings = Settings(admin_token="t", leetcode_sessions="", data_dir=tmp_path)
    store = ContestStore(settings.state_file, settings.state_backup_file)
    return ContestEngine(store, Broadcaster(), settings)


def _seed(engine: ContestEngine, start: datetime, end: datetime) -> None:
    engine._store._contest = Contest(
        status=ContestStatus.running,
        start_time=start,
        end_time=end,
        last_started_at=start,
        problems=[
            Problem(title_slug="two-sum", difficulty=Difficulty.easy, points=1, order=0, beat_bonus_tiers=TIERS),
            Problem(title_slug="3sum", difficulty=Difficulty.medium, points=3, order=1, beat_bonus_tiers=TIERS),
        ],
        participants={
            "alice": Participant(username="alice", student_id="B11000001"),
        },
    )


def _sub(sub_id: int, slug: str, status: str, t: datetime, *, beat_pct: float | None = None) -> dict:
    raw: dict = {
        "id": str(sub_id),
        "statusDisplay": status,
        "titleSlug": slug,
        "timestamp": int(t.timestamp()),
    }
    if beat_pct is not None:
        raw["runtimePercentile"] = beat_pct
    return raw


@pytest.mark.asyncio
async def test_bonus_added_to_score(tmp_path: Path):
    engine = _make_engine(tmp_path)
    start = datetime(2026, 1, 1, 10, tzinfo=timezone.utc)
    _seed(engine, start, start + timedelta(hours=2))

    await engine.ingest_submissions(
        "alice",
        [_sub(1, "two-sum", "Accepted", start + timedelta(minutes=5), beat_pct=97.0)],
    )
    alice = engine.contest.participants["alice"]
    assert alice.score == 1 + 3  # base 1 + tier-3 bonus

    evt = engine.contest.events[0]
    assert evt.is_scoring
    assert evt.bonus_delta == 3
    assert evt.points_delta == 4
    assert evt.beat_pct == 97.0


@pytest.mark.asyncio
async def test_no_beat_pct_field_gives_no_bonus(tmp_path: Path):
    engine = _make_engine(tmp_path)
    start = datetime(2026, 1, 1, 10, tzinfo=timezone.utc)
    _seed(engine, start, start + timedelta(hours=2))

    await engine.ingest_submissions(
        "alice",
        [_sub(2, "two-sum", "Accepted", start + timedelta(minutes=5))],
    )
    alice = engine.contest.participants["alice"]
    assert alice.score == 1  # no bonus

    evt = engine.contest.events[0]
    assert evt.bonus_delta == 0
    assert evt.beat_pct is None


@pytest.mark.asyncio
async def test_below_threshold_gives_no_bonus(tmp_path: Path):
    engine = _make_engine(tmp_path)
    start = datetime(2026, 1, 1, 10, tzinfo=timezone.utc)
    _seed(engine, start, start + timedelta(hours=2))

    await engine.ingest_submissions(
        "alice",
        [_sub(3, "two-sum", "Accepted", start + timedelta(minutes=5), beat_pct=30.0)],
    )
    assert engine.contest.participants["alice"].score == 1
    assert engine.contest.events[0].bonus_delta == 0


@pytest.mark.asyncio
async def test_re_ac_with_same_beat_pct_no_upgrade(tmp_path: Path):
    """Second AC with same/worse beat % does not trigger an upgrade."""
    engine = _make_engine(tmp_path)
    start = datetime(2026, 1, 1, 10, tzinfo=timezone.utc)
    _seed(engine, start, start + timedelta(hours=2))

    await engine.ingest_submissions(
        "alice",
        [_sub(4, "two-sum", "Accepted", start + timedelta(minutes=5), beat_pct=99.0)],
    )
    await engine.ingest_submissions(
        "alice",
        [_sub(5, "two-sum", "Accepted", start + timedelta(minutes=10), beat_pct=99.0)],
    )
    alice = engine.contest.participants["alice"]
    assert alice.score == 1 + 3  # only first AC scored

    second_evt = next(e for e in engine.contest.events if e.submission_id == "5")
    assert not second_evt.is_scoring
    assert second_evt.bonus_delta == 0
    assert second_evt.beat_pct == 99.0  # still recorded for display


@pytest.mark.asyncio
async def test_re_ac_with_better_beat_pct_upgrades_bonus(tmp_path: Path):
    """Re-AC with higher beat % adds the bonus delta to the score."""
    engine = _make_engine(tmp_path)
    start = datetime(2026, 1, 1, 10, tzinfo=timezone.utc)
    _seed(engine, start, start + timedelta(hours=2))

    # First AC at beat 65 → bonus 1
    await engine.ingest_submissions(
        "alice",
        [_sub(10, "two-sum", "Accepted", start + timedelta(minutes=2), beat_pct=65.0)],
    )
    assert engine.contest.participants["alice"].score == 1 + 1

    # Re-AC at beat 85 → bonus tier 2 → upgrade by +1
    await engine.ingest_submissions(
        "alice",
        [_sub(11, "two-sum", "Accepted", start + timedelta(minutes=5), beat_pct=85.0)],
    )
    alice = engine.contest.participants["alice"]
    assert alice.score == 1 + 2  # base + new bonus
    assert alice.problem_bonus_pts["two-sum"] == 2

    upgrade_evt = next(e for e in engine.contest.events if e.submission_id == "11")
    assert upgrade_evt.is_scoring
    assert upgrade_evt.bonus_delta == 1  # delta only
    assert upgrade_evt.points_delta == 1
    assert upgrade_evt.beat_pct == 85.0
    assert "→" in (upgrade_evt.note or "")

    # Re-AC at beat 99 → bonus tier 3 → another +1 upgrade
    await engine.ingest_submissions(
        "alice",
        [_sub(12, "two-sum", "Accepted", start + timedelta(minutes=8), beat_pct=99.0)],
    )
    alice = engine.contest.participants["alice"]
    assert alice.score == 1 + 3
    assert alice.problem_bonus_pts["two-sum"] == 3


@pytest.mark.asyncio
async def test_different_problems_use_own_tiers(tmp_path: Path):
    """Each problem's bonus tiers are independent."""
    engine = _make_engine(tmp_path)
    start = datetime(2026, 1, 1, 10, tzinfo=timezone.utc)
    end = start + timedelta(hours=2)
    engine._store._contest = Contest(
        status=ContestStatus.running,
        start_time=start,
        end_time=end,
        last_started_at=start,
        problems=[
            Problem(
                title_slug="two-sum", difficulty=Difficulty.easy, points=1, order=0,
                beat_bonus_tiers=[BonusTier(min_beat_pct=90.0, bonus_pts=2)],
            ),
            Problem(
                title_slug="3sum", difficulty=Difficulty.medium, points=3, order=1,
                beat_bonus_tiers=[],  # no bonus for this problem
            ),
        ],
        participants={"alice": Participant(username="alice", student_id="B11000001")},
    )

    t = start + timedelta(minutes=5)
    await engine.ingest_submissions("alice", [
        {"id": "1", "statusDisplay": "Accepted", "titleSlug": "two-sum",
         "timestamp": int(t.timestamp()), "runtimePercentile": 95.0},
        {"id": "2", "statusDisplay": "Accepted", "titleSlug": "3sum",
         "timestamp": int(t.timestamp()), "runtimePercentile": 95.0},
    ])
    alice = engine.contest.participants["alice"]
    assert alice.score == (1 + 2) + 3  # two-sum: base+bonus; 3sum: base only

    evts = {e.title_slug: e for e in engine.contest.events if e.is_scoring}
    assert evts["two-sum"].bonus_delta == 2
    assert evts["3sum"].bonus_delta == 0
