"""Runtime configuration loaded from environment / `.env`."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import List

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    admin_token: str = Field(default="change-me", min_length=1)
    leetcode_sessions: str = ""
    leetcode_api_base: str = "https://leetcode-api-pied.vercel.app"
    data_dir: Path = Path("./data")

    poll_interval_sec: float = 5.0
    poll_recent_limit: int = 5
    poll_jitter: float = 0.2
    post_end_grace_sec: float = 90.0
    leetcode_http_timeout_sec: float = 10.0

    cors_origins: str = "*"

    mock_mode: bool = False
    mock_script_path: Path = Path("./mock/sample.json")

    @field_validator("data_dir", "mock_script_path", mode="before")
    @classmethod
    def _expand(cls, v: str | Path) -> Path:
        return Path(v).expanduser()

    @property
    def session_list(self) -> List[str]:
        raw = (self.leetcode_sessions or "").strip()
        if not raw:
            return []
        return [s.strip() for s in raw.split(",") if s.strip()]

    @property
    def cors_list(self) -> List[str]:
        raw = (self.cors_origins or "").strip()
        if not raw or raw == "*":
            return ["*"]
        return [s.strip() for s in raw.split(",") if s.strip()]

    @property
    def state_file(self) -> Path:
        return self.data_dir / "contest.json"

    @property
    def state_backup_file(self) -> Path:
        return self.data_dir / "contest.json.bak"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
