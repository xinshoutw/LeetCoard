"""Atomic JSON persistence for `Contest` state.

Strategy:
- Single global asyncio.Lock around writes.
- Coalesce writes within a 200ms window: setting `mark_dirty()` schedules a flush;
  multiple calls inside the window collapse into one disk hit.
- Atomic via `tmp + os.replace`.
- On every successful write, retain previous file as `contest.json.bak` for recovery.
- On boot, attempt main file → fall back to `.bak` → fall back to default factory.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import tempfile
from pathlib import Path
from typing import Optional

from pydantic import ValidationError

from ..domain.models import Contest, default_contest

log = logging.getLogger("gdg.storage")

_FLUSH_DELAY_SEC = 0.2


class ContestStore:
    """Owns the single in-memory `Contest` and its on-disk JSON mirror."""

    def __init__(self, state_path: Path, backup_path: Path):
        self._path = state_path
        self._backup = backup_path
        self._contest: Contest = default_contest()
        self._lock = asyncio.Lock()
        self._dirty = False
        self._flush_task: Optional[asyncio.Task] = None

    # -------- read / write surface --------

    @property
    def contest(self) -> Contest:
        return self._contest

    def replace_contest(self, contest: Contest) -> None:
        """Atomically swap the in-memory contest. Caller is responsible for
        flushing afterwards."""

        self._contest = contest

    def load_sync(self) -> None:
        """Best-effort load on boot. Falls back to backup, then to default."""

        for source in (self._path, self._backup):
            if not source.exists():
                continue
            try:
                raw = source.read_text(encoding="utf-8")
                data = json.loads(raw)
                self._contest = Contest.model_validate(data)
                log.info("Loaded contest state from %s", source)
                return
            except (json.JSONDecodeError, ValidationError, OSError) as exc:
                log.error("Failed to load %s: %s", source, exc)
        log.info("No usable state file at %s; starting from default contest", self._path)
        self._contest = default_contest()

    def mark_dirty(self) -> None:
        """Schedule a coalesced flush. Safe to call from any async context."""

        self._dirty = True
        if self._flush_task is None or self._flush_task.done():
            try:
                loop = asyncio.get_running_loop()
            except RuntimeError:
                # No running loop — caller is sync, do a sync flush instead.
                self._write_sync()
                return
            self._flush_task = loop.create_task(self._delayed_flush())

    async def flush_now(self) -> None:
        """Force an immediate write (e.g. on shutdown / state transitions)."""

        async with self._lock:
            if self._dirty or not self._path.exists():
                self._write_sync()

    async def _delayed_flush(self) -> None:
        try:
            await asyncio.sleep(_FLUSH_DELAY_SEC)
            async with self._lock:
                if self._dirty:
                    self._write_sync()
        except asyncio.CancelledError:
            pass
        except Exception:  # never let the flush task die silently
            log.exception("Coalesced flush failed")

    def _write_sync(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        payload = self._contest.model_dump(mode="json")
        # Sets are stringly serialised by mode=json; ensure determinism.
        encoded = json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=False)

        # Rotate previous file → backup before overwriting.
        if self._path.exists():
            try:
                os.replace(self._path, self._backup)
            except OSError as exc:
                log.warning("Could not rotate backup for %s: %s", self._path, exc)

        with tempfile.NamedTemporaryFile(
            "w",
            encoding="utf-8",
            dir=str(self._path.parent),
            prefix=".contest-",
            suffix=".json.tmp",
            delete=False,
        ) as tmp:
            tmp.write(encoded)
            tmp.flush()
            os.fsync(tmp.fileno())
            tmp_path = Path(tmp.name)

        os.replace(tmp_path, self._path)
        self._dirty = False
        log.debug("Wrote contest state -> %s (%d bytes)", self._path, len(encoded))
