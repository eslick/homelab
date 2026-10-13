"""
LLM gateway: one inference container at a time on the shared GPUs.

Routes OpenAI-compatible requests by the `model` field in the JSON body to one of several
backend containers (see MODELS_JSON). Every backend claims both GPUs, so at most one runs:

  * target already running            -> proxy it
  * nothing running                   -> start target, wait up to LOAD_WAIT_SECONDS for health
  * another model running and IDLE    -> stop it, start target (same wait)
  * another model running and BUSY    -> 503 + Retry-After (client is expected to back off and retry)

"Busy" = requests in flight (streams included), the model still loading, or a short hold after a
client gave up waiting on a load (so the loader's retry is not starved by the other model).
Idle backends are stopped after IDLE_TIMEOUT_SECONDS.
"""

import asyncio
import json
import logging
import os
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass, field

import docker
import httpx
from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse, StreamingResponse

IDLE_TIMEOUT = int(os.getenv("IDLE_TIMEOUT_SECONDS", "300"))
STARTUP_TIMEOUT = int(os.getenv("STARTUP_TIMEOUT_SECONDS", "600"))
LOAD_WAIT = int(os.getenv("LOAD_WAIT_SECONDS", "90"))  # how long one request blocks on a load
BUSY_RETRY_AFTER = int(os.getenv("BUSY_RETRY_AFTER_SECONDS", "30"))
LOADING_RETRY_AFTER = int(os.getenv("LOADING_RETRY_AFTER_SECONDS", "15"))
HOLD_SECONDS = int(os.getenv("LOAD_HOLD_SECONDS", "90"))  # claim kept after a client times out on a load
STALE_INFLIGHT_SECONDS = int(os.getenv("STALE_INFLIGHT_SECONDS", "1800"))

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("llm-gateway")

HOP_BY_HOP = {"transfer-encoding", "connection", "keep-alive", "te", "trailers", "upgrade"}


@dataclass
class Backend:
    name: str  # served model name clients send
    container: str
    url: str
    health: str = "/health"
    inflight: int = 0
    ready: bool = False
    loading: bool = False
    hold_until: float = 0.0
    last_activity: float = field(default_factory=time.monotonic)
    done: asyncio.Event = field(default_factory=asyncio.Event)

    def busy(self) -> bool:
        return self.inflight > 0 or self.loading or time.monotonic() < self.hold_until


_cfg = json.loads(os.environ["MODELS_JSON"])
BACKENDS: dict[str, Backend] = {m["name"]: Backend(**m) for m in _cfg["models"]}
DEFAULT = BACKENDS[_cfg.get("default") or next(iter(BACKENDS))]

_docker = docker.from_env()
_lock = asyncio.Lock()  # serialises stop/start decisions
_http = httpx.AsyncClient(
    timeout=httpx.Timeout(connect=10.0, read=600.0, write=120.0, pool=10.0),
    limits=httpx.Limits(max_connections=100, max_keepalive_connections=20),
)


def _running(b: Backend) -> bool:
    try:
        return _docker.containers.get(b.container).status == "running"
    except docker.errors.NotFound:
        return False


async def _in_executor(fn):
    return await asyncio.get_running_loop().run_in_executor(None, fn)


async def _healthy(b: Backend) -> bool:
    try:
        r = await _http.get(f"{b.url}{b.health}", timeout=5.0)
        return r.status_code == 200
    except Exception:
        return False


async def _stop(b: Backend) -> None:
    log.info("Stopping %s (%s)", b.name, b.container)
    await _in_executor(lambda: _docker.containers.get(b.container).stop(timeout=30))
    b.ready = False


async def _load(b: Backend) -> None:
    """Start the container and wait for health. Runs detached from any single request."""
    try:
        if not _running(b):
            log.info("Starting %s (%s)", b.name, b.container)
            await _in_executor(lambda: _docker.containers.get(b.container).start())
        deadline = time.monotonic() + STARTUP_TIMEOUT
        while time.monotonic() < deadline:
            if await _healthy(b):
                b.ready = True
                log.info("%s is ready", b.name)
                return
            if not _running(b):
                log.error("%s exited during startup", b.name)
                return
            await asyncio.sleep(5)
        log.error("%s not healthy within %ds", b.name, STARTUP_TIMEOUT)
    except Exception as exc:
        log.error("Failed to start %s: %s", b.name, exc)
    finally:
        b.loading = False
        b.last_activity = time.monotonic()
        b.done.set()


def _unavailable(reason: str, message: str, retry_after: int) -> JSONResponse:
    return JSONResponse(
        status_code=503,
        headers={"Retry-After": str(retry_after), "X-Gateway-Reason": reason},
        content={"error": {"message": message, "type": "service_unavailable_error",
                           "code": "server_is_overloaded", "reason": reason,
                           "retry_after": retry_after}},
    )


async def _acquire(b: Backend) -> JSONResponse | None:
    """Claim the GPUs for `b` (counting one in-flight request). Returns a 503 if not possible."""
    async with _lock:
        others = [o for o in BACKENDS.values() if o is not b and _running(o)]
        for o in others:
            if o.busy():
                why = "loading" if o.loading else "in use"
                log.info("503 for %s: %s is %s", b.name, o.name, why)
                return _unavailable(
                    "busy", f"GPUs are busy serving {o.name} ({why}); retry later.", BUSY_RETRY_AFTER)
        for o in others:
            await _stop(o)
        if not b.loading and not b.ready:
            if _running(b) and await _healthy(b):
                b.ready = True  # e.g. gateway restarted while the backend kept running
            else:
                b.loading, b.ready = True, False  # set before the task runs so waiters see it
                b.done.clear()
                asyncio.create_task(_load(b))
        if b.ready:
            b.hold_until = 0.0  # the load-timeout claim has done its job
        b.inflight += 1
        b.last_activity = time.monotonic()
    return None


def _release(b: Backend) -> None:
    b.inflight = max(0, b.inflight - 1)
    b.last_activity = time.monotonic()


async def _idle_watchdog() -> None:
    while True:
        await asyncio.sleep(30)
        now = time.monotonic()
        for b in BACKENDS.values():
            if b.inflight and now - b.last_activity > STALE_INFLIGHT_SECONDS:
                log.warning("%s: resetting %d stale in-flight request(s)", b.name, b.inflight)
                b.inflight = 0
            if b.busy() or not _running(b) or now - b.last_activity < IDLE_TIMEOUT:
                continue
            async with _lock:
                if b.busy():
                    continue
                log.info("%s idle for %.0fs (limit %ds)", b.name, now - b.last_activity, IDLE_TIMEOUT)
                try:
                    await _stop(b)
                except Exception as exc:
                    log.error("Failed to stop %s: %s", b.name, exc)


@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(_idle_watchdog())
    yield
    task.cancel()
    await _http.aclose()


app = FastAPI(lifespan=lifespan)


def _status() -> dict:
    now = time.monotonic()
    return {
        "active": [b.name for b in BACKENDS.values() if _running(b)],
        "models": {
            b.name: {
                "container": b.container, "running": _running(b), "ready": b.ready,
                "loading": b.loading, "inflight": b.inflight, "busy": b.busy(),
                "idle_seconds": round(now - b.last_activity, 1),
            } for b in BACKENDS.values()
        },
        "idle_timeout_seconds": IDLE_TIMEOUT,
    }


@app.get("/gateway/status")
@app.get("/watcher/status")  # legacy alias
async def status():
    return _status()


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/v1/models")
async def models():
    return {"object": "list", "data": [
        {"id": b.name, "object": "model", "owned_by": "homelab", "active": _running(b)}
        for b in BACKENDS.values()]}


@app.api_route("/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "HEAD", "PATCH"])
async def proxy(request: Request, path: str):
    body = await request.body()
    requested = None
    if body:
        try:
            requested = json.loads(body).get("model")
        except Exception:
            pass
    b = BACKENDS.get(requested)
    if b is None:
        if requested:
            log.info("Unknown model %r, routing to default %s", requested, DEFAULT.name)
        b = DEFAULT

    refusal = await _acquire(b)
    if refusal:
        return refusal

    released = False
    try:
        if not b.ready:
            try:
                await asyncio.wait_for(b.done.wait(), LOAD_WAIT)
            except asyncio.TimeoutError:
                b.hold_until = time.monotonic() + HOLD_SECONDS
                return _unavailable(
                    "loading", f"{b.name} is still loading; retry shortly.", LOADING_RETRY_AFTER)
            if not b.ready:
                return _unavailable(
                    "failed", f"{b.name} failed to start; check container logs.", BUSY_RETRY_AFTER)

        url = f"{b.url}/{path}" + (f"?{request.url.query}" if request.url.query else "")
        headers = {k: v for k, v in request.headers.items() if k.lower() not in ("host", "content-length")}
        try:
            up = await _http.send(
                _http.build_request(request.method, url, headers=headers, content=body), stream=True)
        except httpx.HTTPError as exc:
            log.error("Upstream error for %s: %s", b.name, exc)
            return _unavailable("upstream", f"{b.name} is not reachable.", LOADING_RETRY_AFTER)

        resp_headers = {k: v for k, v in up.headers.items() if k.lower() not in HOP_BY_HOP | {"content-length"}}
        if "text/event-stream" in up.headers.get("content-type", ""):
            async def _stream():
                try:
                    async for chunk in up.aiter_bytes():
                        b.last_activity = time.monotonic()
                        yield chunk
                finally:
                    await up.aclose()
                    _release(b)

            released = True  # the generator now owns the release
            return StreamingResponse(
                _stream(), status_code=up.status_code, headers={**resp_headers, "X-Accel-Buffering": "no"})

        try:
            content = await up.aread()
        finally:
            await up.aclose()
        return Response(content=content, status_code=up.status_code, headers=resp_headers)
    finally:
        if not released:
            _release(b)
