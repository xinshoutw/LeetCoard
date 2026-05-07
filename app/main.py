"""FastAPI application entrypoint."""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .core.config import get_settings
from .core.sse import broadcaster
from .core.storage import ContestStore
from .domain.state import ContestEngine
from .integrations.leetcode import LeetCodeClient
from .routes import admin as admin_routes
from .routes import public as public_routes
from .workers.polling import PollingWorker
from .workers.scheduler import ContestScheduler

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s :: %(message)s",
)
log = logging.getLogger("gdg.main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    log.info("Starting backend sessions=%d", len(settings.session_list))

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

    polling = PollingWorker(engine, client, settings)
    await polling.start()

    scheduler = ContestScheduler(engine)
    await scheduler.start()

    app.state.polling_worker = polling
    app.state.scheduler = scheduler

    try:
        yield
    finally:
        log.info("Shutting down workers")
        for worker in (scheduler, polling):
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
