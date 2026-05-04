"""FastAPI application entrypoint."""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .leetcode import LeetCodeClient
from .mock import MockSubmissionWorker
from .polling import PollingWorker
from .precheck import PrecheckWorker
from .routes import admin as admin_routes
from .routes import public as public_routes
from .sse import broadcaster
from .state import ContestEngine
from .storage import ContestStore

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s :: %(message)s",
)
log = logging.getLogger("gdg.main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    log.info("Starting backend mock_mode=%s sessions=%d", settings.mock_mode, len(settings.session_list))

    settings.data_dir.mkdir(parents=True, exist_ok=True)
    store = ContestStore(settings.state_file, settings.state_backup_file)
    store.load_sync()

    engine = ContestEngine(store, broadcaster, settings)
    app.state.engine = engine

    client = LeetCodeClient(
        api_base=settings.leetcode_api_base,
        sessions=settings.session_list,
        timeout=settings.leetcode_http_timeout_sec,
    )
    await client.__aenter__()
    app.state.lc_client = client

    polling: PollingWorker | None = None
    precheck: PrecheckWorker | None = None
    mock: MockSubmissionWorker | None = None

    if settings.mock_mode:
        mock = MockSubmissionWorker(engine, settings)
        await mock.start()
    else:
        polling = PollingWorker(engine, client, settings)
        precheck = PrecheckWorker(engine, client, settings)
        await polling.start()

    app.state.polling_worker = polling
    app.state.precheck_worker = precheck
    app.state.mock_worker = mock

    try:
        yield
    finally:
        log.info("Shutting down workers")
        for worker in (polling, precheck, mock):
            if worker:
                try:
                    await worker.stop()
                except Exception:
                    log.exception("worker stop failed")
        await store.flush_now()
        await client.aclose()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="GDG NTUST · LeetCode Contest API",
        version="0.1.0",
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_list,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(public_routes.router, prefix="/api", tags=["public"])
    app.include_router(admin_routes.router, prefix="/api/admin", tags=["admin"])
    return app


app = create_app()


def cli() -> None:
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8080,
        reload=False,
        log_level="info",
    )


if __name__ == "__main__":
    cli()
