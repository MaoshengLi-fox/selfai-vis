from __future__ import annotations

import os
from datetime import datetime

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .demo_loader import load_demo_experiments
from .job_manager import JobManager, JobRecord
from .schemas import (
    DemoExperimentResponse,
    HealthResponse,
    JobCreateResponse,
    JobStatusResponse,
    MainSelfAIRequest,
    MetricsResponse,
    OptimizationRequest,
)

SERVERLESS_MODE = os.getenv("VERCEL") == "1" or os.getenv("SELFAI_SERVERLESS") == "1"

app = FastAPI(
    title="SelfAI Backend Service",
    version="1.0.0",
    description="Expose SelfAI optimization workflow to frontend clients.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

job_manager = JobManager(max_workers=2)


def _raise_serverless_not_supported(endpoint: str) -> None:
    raise HTTPException(
        status_code=501,
        detail=(
            f"`{endpoint}` is disabled in serverless mode. "
            "Use a persistent worker environment for optimization endpoints."
        ),
    )


def _load_metric_dict() -> dict[str, str]:
    try:
        from .runner import METRIC_DICT

        return METRIC_DICT
    except Exception:
        # Keep the API alive even when heavy optional dependencies are unavailable.
        return {}


@app.get("/api/v1/health", response_model=HealthResponse)
def health() -> HealthResponse:
    queued, running = (0, 0) if SERVERLESS_MODE else job_manager.stats()
    return HealthResponse(
        status="ok-serverless" if SERVERLESS_MODE else "ok",
        time=datetime.utcnow(),
        running_jobs=running,
        queued_jobs=queued,
    )


@app.get("/api/v1/meta/metrics", response_model=MetricsResponse)
def metrics() -> MetricsResponse:
    return MetricsResponse(metric_dicts=_load_metric_dict())


@app.get("/api/v1/demo/experiments", response_model=list[DemoExperimentResponse])
def demo_experiments() -> list[DemoExperimentResponse]:
    return [DemoExperimentResponse(**item) for item in load_demo_experiments()]


@app.post("/api/v1/jobs/optimize", response_model=JobCreateResponse)
def create_optimization_job(req: MainSelfAIRequest) -> JobCreateResponse:
    if SERVERLESS_MODE:
        _raise_serverless_not_supported("/api/v1/jobs/optimize")

    from .runner import run_main_selfai_job

    record = job_manager.submit(run_main_selfai_job, req)
    return JobCreateResponse(job_id=record.job_id, status=record.status)


@app.get("/api/v1/jobs", response_model=list[JobStatusResponse])
def list_jobs() -> list[JobStatusResponse]:
    if SERVERLESS_MODE:
        _raise_serverless_not_supported("/api/v1/jobs")

    items = sorted(job_manager.list(), key=lambda x: x.created_at, reverse=True)
    return [_to_status(item) for item in items]


@app.get("/api/v1/jobs/{job_id}", response_model=JobStatusResponse)
def get_job(job_id: str) -> JobStatusResponse:
    if SERVERLESS_MODE:
        _raise_serverless_not_supported("/api/v1/jobs/{job_id}")

    item = job_manager.get(job_id)
    if item is None:
        raise HTTPException(status_code=404, detail=f"Job not found: {job_id}")
    return _to_status(item)


@app.delete("/api/v1/jobs/{job_id}")
def delete_job(job_id: str) -> dict[str, str]:
    if SERVERLESS_MODE:
        _raise_serverless_not_supported("/api/v1/jobs/{job_id}")

    ok = job_manager.remove(job_id)
    if not ok:
        raise HTTPException(
            status_code=409,
            detail="Job cannot be removed (not found or still running)",
        )
    return {"message": "deleted", "job_id": job_id}


@app.post("/api/v1/optimize/run")
def run_optimization_sync(req: MainSelfAIRequest) -> dict:
    """Synchronous strict main_selfai mode without queue."""
    if SERVERLESS_MODE:
        _raise_serverless_not_supported("/api/v1/optimize/run")

    from .runner import run_main_selfai_job

    try:
        return run_main_selfai_job(req)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/api/v1/jobs/optimize-legacy", response_model=JobCreateResponse)
def create_optimization_job_legacy(req: OptimizationRequest) -> JobCreateResponse:
    if SERVERLESS_MODE:
        _raise_serverless_not_supported("/api/v1/jobs/optimize-legacy")

    from .runner import run_optimization_job

    record = job_manager.submit(run_optimization_job, req)
    return JobCreateResponse(job_id=record.job_id, status=record.status)


def _to_status(item: JobRecord) -> JobStatusResponse:
    return JobStatusResponse(
        job_id=item.job_id,
        status=item.status,
        created_at=item.created_at,
        started_at=item.started_at,
        finished_at=item.finished_at,
        error=item.error,
        result=item.result,
    )
