"""Scoring + ranking + persistence-roundtrip tests.

These exist so we can break the implementation freely without breaking the
contract: every box in the spec's "計分規則" section is enforced here.
"""

from __future__ import annotations

import asyncio
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from app.config import Settings
from app.models import (
    Contest,
    ContestStatus,
    Difficulty,
    Participant,
    Problem,
)
from app.sse import Broadcaster
from app.state import ContestEngine
from app.storage import ContestStore


def _make_engine(tmp_path: Path) -> tuple[ContestEngine, ContestStore]:
    settings = Settings(
        admin_token="t",
        leetcode_sessions="",
        data_dir=tmp_path,
        post_end_grace_sec=90,
    )
    store = ContestStore(settings.state_file, settings.state_backup_file)
    bc = Broadcaster()
    engine = ContestEngine(store, bc, settings)
    return engine, store


def _seed(engine: ContestEngine, start: datetime, end: datetime) -> None:
    engine._store._contest = Contest(
        status=ContestStatus.running,
        start_time=start,
        end_time=end,
        last_started_at=start,
        problems=[
            Problem(title_slug="two-sum", difficulty=Difficulty.easy, points=1, order=0),
            Problem(title_slug="valid-parentheses", difficulty=Difficulty.easy, points=1, order=1),
            Problem(title_slug="3sum", difficulty=Difficulty.medium, points=3, order=2),
            Problem(title_slug="trapping-rain-water", difficulty=Difficulty.hard, points=5, order=3),
        ],
        participants={
            "alice": Participant(username="alice", student_id="B11000001"),
            "bob": Participant(username="bob", student_id="B11000002"),
            "carol": Participant(username="carol", student_id="B11000003"),
        },
    )


def _sub(sub_id: int, slug: str, status: str, t: datetime) -> dict:
    return {
        "id": str(sub_id),
        "statusDisplay": status,
        "titleSlug": slug,
        "timestamp": int(t.timestamp()),
    }


@pytest.mark.asyncio
async def test_first_ac_scores_and_duplicates_dont(tmp_path: Path):
    engine, _ = _make_engine(tmp_path)
    start = datetime(2026, 1, 1, 10, tzinfo=timezone.utc)
    end = start + timedelta(hours=2)
    _seed(engine, start, end)

    await engine.ingest_submissions(
        "alice",
        [
            _sub(1, "two-sum", "Wrong Answer", start + timedelta(minutes=1)),
            _sub(2, "two-sum", "Accepted", start + timedelta(minutes=2)),
            _sub(3, "two-sum", "Accepted", start + timedelta(minutes=3)),
        ],
    )
    alice = engine.contest.participants["alice"]
    assert alice.score == 1
    assert alice.solved_problems == {"two-sum"}
    scoring_events = [e for e in engine.contest.events if e.is_scoring]
    assert len(scoring_events) == 1
    assert scoring_events[0].submission_id == "2"


@pytest.mark.asyncio
async def test_ac_outside_window_is_not_scored(tmp_path: Path):
    engine, _ = _make_engine(tmp_path)
    start = datetime(2026, 1, 1, 10, tzinfo=timezone.utc)
    end = start + timedelta(hours=2)
    _seed(engine, start, end)

    await engine.ingest_submissions(
        "alice",
        [
            _sub(10, "two-sum", "Accepted", start - timedelta(minutes=5)),  # before
            _sub(11, "two-sum", "Accepted", end + timedelta(minutes=5)),    # after
        ],
    )
    assert engine.contest.participants["alice"].score == 0
    assert all(not e.is_scoring for e in engine.contest.events)


@pytest.mark.asyncio
async def test_late_arriving_in_window_submission_still_scores(tmp_path: Path):
    """LeetCode submission timestamp is in window, but server only saw it
    after `endTime`. The spec requires it to count."""
    engine, _ = _make_engine(tmp_path)
    start = datetime(2026, 1, 1, 10, tzinfo=timezone.utc)
    end = start + timedelta(hours=2)
    _seed(engine, start, end)
    engine.contest.status = ContestStatus.ended  # simulate post-end grace

    await engine.ingest_submissions(
        "carol",
        [_sub(20, "3sum", "Accepted", end - timedelta(seconds=30))],
    )
    assert engine.contest.participants["carol"].score == 3


@pytest.mark.asyncio
async def test_untracked_problem_emits_no_event(tmp_path: Path):
    engine, _ = _make_engine(tmp_path)
    start = datetime(2026, 1, 1, 10, tzinfo=timezone.utc)
    end = start + timedelta(hours=2)
    _seed(engine, start, end)

    await engine.ingest_submissions(
        "alice",
        [_sub(30, "longest-palindrome", "Accepted", start + timedelta(minutes=5))],
    )
    assert engine.contest.events == []


@pytest.mark.asyncio
async def test_ranking_tiebreak_by_first_reach_time(tmp_path: Path):
    engine, _ = _make_engine(tmp_path)
    start = datetime(2026, 1, 1, 10, tzinfo=timezone.utc)
    end = start + timedelta(hours=2)
    _seed(engine, start, end)

    # alice: 1pt at t+10min
    await engine.ingest_submissions(
        "alice", [_sub(40, "two-sum", "Accepted", start + timedelta(minutes=10))]
    )
    # bob: 1pt at t+5min  -> should outrank alice on tiebreak
    await engine.ingest_submissions(
        "bob", [_sub(41, "two-sum", "Accepted", start + timedelta(minutes=5))]
    )
    # carol: 0pt — last
    leaderboard = engine._leaderboard_snapshot()
    rank_by_user = {row["username"]: row["rank"] for row in leaderboard}
    assert rank_by_user["bob"] < rank_by_user["alice"]
    assert rank_by_user["carol"] >= rank_by_user["alice"]


@pytest.mark.asyncio
async def test_dedupe_across_polls(tmp_path: Path):
    engine, _ = _make_engine(tmp_path)
    start = datetime(2026, 1, 1, 10, tzinfo=timezone.utc)
    end = start + timedelta(hours=2)
    _seed(engine, start, end)

    sub = _sub(50, "valid-parentheses", "Accepted", start + timedelta(minutes=4))
    await engine.ingest_submissions("alice", [sub])
    await engine.ingest_submissions("alice", [sub, sub])  # same poll again
    assert engine.contest.participants["alice"].score == 1
    assert sum(1 for e in engine.contest.events if e.submission_id == "50") == 1


@pytest.mark.asyncio
async def test_persistence_roundtrip(tmp_path: Path):
    engine, store = _make_engine(tmp_path)
    start = datetime(2026, 1, 1, 10, tzinfo=timezone.utc)
    end = start + timedelta(hours=2)
    _seed(engine, start, end)

    await engine.ingest_submissions(
        "alice",
        [_sub(60, "trapping-rain-water", "Accepted", start + timedelta(minutes=20))],
    )
    await store.flush_now()
    assert store._path.exists()

    # New process simulation
    bc2 = Broadcaster()
    cfg = Settings(admin_token="t", data_dir=tmp_path)
    store2 = ContestStore(cfg.state_file, cfg.state_backup_file)
    store2.load_sync()
    assert store2.contest.participants["alice"].score == 5
    assert "trapping-rain-water" in store2.contest.participants["alice"].solved_problems
