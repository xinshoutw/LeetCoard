"""Pure scoring helpers — no I/O, no side-effects, fully unit-testable."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .models import BonusTier


def compute_beat_bonus(beat_pct: float | None, tiers: list["BonusTier"]) -> int:
    """Return bonus points for *beat_pct* (runtime beat percentile, 0–100).

    Picks the highest-threshold tier whose min_beat_pct ≤ beat_pct.
    Returns 0 when beat_pct is None or no tiers are configured.
    """
    if beat_pct is None or not tiers:
        return 0
    for tier in sorted(tiers, key=lambda t: t.min_beat_pct, reverse=True):
        if beat_pct >= tier.min_beat_pct:
            return tier.bonus_pts
    return 0
