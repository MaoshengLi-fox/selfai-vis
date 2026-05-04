from __future__ import annotations

from datetime import datetime

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .job_manager import JobManager, JobRecord
from .runner import METRIC_DICT, run_main_selfai_job, run_optimization_job
from .schemas import (
    HealthResponse,
    JobCreateResponse,
    JobStatusResponse,
    MainSelfAIRequest,
    MetricsResponse,
    OptimizationRequest,
)


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


@app.get("/api/v1/health", response_model=HealthResponse)
def health() -> HealthResponse:
    queued, running = job_manager.stats()
    return HealthResponse(
        status="ok",
        time=datetime.utcnow(),
        running_jobs=running,
        queued_jobs=queued,
    )


@app.get("/api/v1/meta/metrics", response_model=MetricsResponse)
def metrics() -> MetricsResponse:
    return MetricsResponse(metric_dicts=METRIC_DICT)


@app.post("/api/v1/jobs/optimize", response_model=JobCreateResponse)
def create_optimization_job(req: MainSelfAIRequest) -> JobCreateResponse:
    record = job_manager.submit(run_main_selfai_job, req)
    return JobCreateResponse(job_id=record.job_id, status=record.status)


@app.get("/api/v1/jobs", response_model=list[JobStatusResponse])
def list_jobs() -> list[JobStatusResponse]:
    items = sorted(job_manager.list(), key=lambda x: x.created_at, reverse=True)
    return [_to_status(item) for item in items]


@app.get("/api/v1/jobs/{job_id}", response_model=JobStatusResponse)
def get_job(job_id: str) -> JobStatusResponse:
    item = job_manager.get(job_id)
    if item is None:
        raise HTTPException(status_code=404, detail=f"Job not found: {job_id}")
    return _to_status(item)


@app.delete("/api/v1/jobs/{job_id}")
def delete_job(job_id: str) -> dict[str, str]:
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
    try:
        return run_main_selfai_job(req)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/api/v1/jobs/optimize-legacy", response_model=JobCreateResponse)
def create_optimization_job_legacy(req: OptimizationRequest) -> JobCreateResponse:
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
