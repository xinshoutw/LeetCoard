"""Single-token admin auth.

Token is read from `Settings.admin_token`. Clients pass it via
`Authorization: Bearer <token>` or `?token=...` (the SSE endpoint only
supports query-string because EventSource cannot set custom headers).
"""

from __future__ import annotations

import hmac
from typing import Optional

from fastapi import Depends, HTTPException, Query, Request, status

from .config import Settings, get_settings


def _extract_token(request: Request) -> Optional[str]:
    auth = request.headers.get("authorization") or request.headers.get("Authorization")
    if auth and auth.lower().startswith("bearer "):
        return auth.split(" ", 1)[1].strip()
    qp = request.query_params.get("token")
    if qp:
        return qp.strip()
    return None


async def require_admin(
    request: Request,
    settings: Settings = Depends(get_settings),
) -> None:
    expected = settings.admin_token
    given = _extract_token(request)
    if not expected or not given or not hmac.compare_digest(expected, given):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid token")


async def admin_token_for_sse(
    token: str = Query(default=""),
    settings: Settings = Depends(get_settings),
) -> bool:
    if not token or not hmac.compare_digest(settings.admin_token, token):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid token")
    return True
