"""
SGLang lifecycle proxy.

Forwards all requests to the upstream SGLang server. When SGLang is stopped,
starts it on the first incoming request and waits for it to be healthy before
proxying. Stops SGLang after IDLE_TIMEOUT_SECONDS of no requests.
"""

import asyncio
import json
import logging
import os
import time
from contextlib import asynccontextmanager

import docker
import httpx
from fastapi import FastAPI, Request, Response
from fastapi.responses import StreamingResponse

SGLANG_URL = os.getenv("SGLANG_URL", "http://sglang:30000")
CONTAINER_NAME = os.getenv("SGLANG_CONTAINER", "sglang")
IDLE_TIMEOUT = int(os.getenv("IDLE_TIMEOUT_SECONDS", "600"))
STARTUP_TIMEOUT = int(os.getenv("STARTUP_TIMEOUT_SECONDS", "300"))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
log = logging.getLogger("sglang-watcher")

_docker = docker.from_env()
_last_request: float = 0.0
_startup_event: asyncio.Event | None = None
_starting: bool = False

HOP_BY_HOP = {"transfer-encoding", "connection", "keep-alive", "te", "trailers", "upgrade"}


def _get_container():
    return _docker.containers.get(CONTAINER_NAME)


def _container_running() -> bool:
    try:
        return _get_container().status == "running"
    except docker.errors.NotFound:
        return False


async def _wait_healthy() -> bool:
    deadline = time.monotonic() + STARTUP_TIMEOUT
    async with httpx.AsyncClient() as client:
        while time.monotonic() < deadline:
            try:
                r = await client.get(f"{SGLANG_URL}/health", timeout=5.0)
                if r.status_code == 200:
                    return True
            except Exception:
                pass
            await asyncio.sleep(5)
    return False


async def _ensure_running() -> bool:
    global _starting, _startup_event

    if _container_running():
        return True

    # Another coroutine is already starting it — wait for that to finish.
    if _starting and _startup_event is not None:
        log.info("SGLang startup already in progress, waiting...")
        await _startup_event.wait()
        return _container_running()

    _startup_event = asyncio.Event()
    _starting = True
    try:
        log.info("Starting SGLang container...")
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, _get_container().start)
        log.info("Waiting up to %ds for SGLang to be healthy...", STARTUP_TIMEOUT)
        ready = await _wait_healthy()
        if ready:
            log.info("SGLang is ready")
        else:
            log.error("SGLang did not become healthy within %ds", STARTUP_TIMEOUT)
        return ready
    except Exception as exc:
        log.error("Failed to start SGLang: %s", exc)
        return False
    finally:
        _starting = False
        _startup_event.set()


async def _idle_watchdog() -> None:
    while True:
        await asyncio.sleep(60)
        if not _container_running():
            continue
        idle = time.monotonic() - _last_request
        if idle >= IDLE_TIMEOUT:
            log.info("SGLang idle for %.0fs (limit %ds), stopping", idle, IDLE_TIMEOUT)
            try:
                loop = asyncio.get_running_loop()
                await loop.run_in_executor(None, lambda: _get_container().stop(timeout=30))
                log.info("SGLang stopped")
            except Exception as exc:
                log.error("Failed to stop SGLang: %s", exc)


@asynccontextmanager
async def lifespan(app: FastAPI):
    asyncio.create_task(_idle_watchdog())
    yield
    await _http.aclose()


app = FastAPI(lifespan=lifespan)
_http = httpx.AsyncClient(
    timeout=httpx.Timeout(connect=10.0, read=600.0, write=120.0, pool=10.0),
    limits=httpx.Limits(max_connections=100, max_keepalive_connections=20),
)


@app.get("/watcher/status")
async def watcher_status():
    running = _container_running()
    idle = time.monotonic() - _last_request if _last_request else None
    return {
        "sglang_running": running,
        "idle_seconds": round(idle, 1) if idle is not None else None,
        "idle_timeout_seconds": IDLE_TIMEOUT,
        "startup_in_progress": _starting,
    }


@app.api_route(
    "/{path:path}",
    methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "HEAD", "PATCH"],
)
async def proxy(request: Request, path: str):
    global _last_request
    _last_request = time.monotonic()

    if not _container_running():
        ready = await _ensure_running()
        if not ready:
            return Response(
                content=b"SGLang failed to start within timeout. Check container logs.",
                status_code=503,
                headers={"Content-Type": "text/plain", "Retry-After": "30"},
            )

    _last_request = time.monotonic()

    url = f"{SGLANG_URL}/{path}"
    if request.url.query:
        url = f"{url}?{request.url.query}"

    headers = {k: v for k, v in request.headers.items() if k.lower() != "host"}
    body = await request.body()

    # Detect streaming: SSE Accept header OR stream:true in JSON body
    want_stream = "text/event-stream" in request.headers.get("accept", "")
    if not want_stream and body:
        try:
            want_stream = json.loads(body).get("stream", False)
        except Exception:
            pass

    if want_stream:
        async def _stream():
            global _last_request
            async with _http.stream(request.method, url, headers=headers, content=body) as up:
                async for chunk in up.aiter_bytes():
                    _last_request = time.monotonic()
                    yield chunk

        return StreamingResponse(
            _stream(),
            media_type="text/event-stream",
            headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"},
        )

    async with _http.stream(request.method, url, headers=headers, content=body) as up:
        content = await up.aread()
        _last_request = time.monotonic()
        resp_headers = {k: v for k, v in up.headers.items() if k.lower() not in HOP_BY_HOP}
        return Response(content=content, status_code=up.status_code, headers=resp_headers)
