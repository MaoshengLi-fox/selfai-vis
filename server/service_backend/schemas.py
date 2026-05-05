from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


class OptimizationRequest(BaseModel):
    gt_json_path: str = Field(..., description="Path to *_gt.json")
    train_json_path: str = Field(..., description="Path to *_train_*.json")
    work_dir: str | None = Field(None, description="Runtime output directory")

    model_info: str = Field("gpt-4o-mini")
    source: str | None = Field(None, description="openai/ollama/deepseek/claude/gemini")

    n_jobs: int = Field(3, ge=1)
    completed_trials: int = Field(3, ge=1)
    metric: str | None = None
    ignore_key: list[str] = Field(
        default_factory=lambda: ["PSNR", "Training accuracy", "validation accuracy", "noise_level"]
    )

    search_type: Literal["trial", "grid"] = "trial"
    fmt: Literal["json", "yaml"] = "json"
    rag: bool = False
    debug: bool = False
    auto_debug: bool = False

    cache_mode: Literal["all", "skip", "none"] = "all"
    cache_path: str = "cache"
    saved_as_path: str | None = None
    cache_name: str | None = None

    max_retries: int = Field(1, ge=0)
    retry_delay: int = Field(1, ge=0)

    stop_rule: str | None = None
    threshold: float | None = None
    vector_backend: str = "memory"
    experimental_desc: str | None = None
    dataset: str | None = None

    openai_api_key: str | None = None
    deepseek_api_key: str | None = None
    claude_api_key: str | None = None


class MainSelfAIRequest(BaseModel):
    model_name_list: list[str] = Field(..., min_length=1)
    json_name_list: list[str] = Field(..., min_length=1)

    n_jobs: int = Field(3, ge=1)
    completed_trials: int = Field(3, ge=1)

    work_dir: str = Field(
        ...,
        description="Runtime work directory. In strict mode this should be set explicitly.",
    )
    db_name: str = "ollama_completion"
    clear_db: bool = True

    cached_mode: Literal["all", "skip", "none"] = "all"
    cache_path: str = ""
    saved_as_path: str | None = None
    cache_name: str | None = None

    max_retries: int = Field(1, ge=0)
    retry_delay: int = Field(1, ge=0)
    optuna_n_jobs: int = Field(1, ge=1)
    study_name: str = "ollama"
    study_direction: Literal["maximize", "minimize"] = "maximize"

    openai_api_key: str | None = None
    deepseek_api_key: str | None = None
    claude_api_key: str | None = None


class JobCreateResponse(BaseModel):
    job_id: str
    status: str


class JobStatusResponse(BaseModel):
    job_id: str
    status: str
    created_at: datetime
    started_at: datetime | None = None
    finished_at: datetime | None = None
    error: str | None = None
    result: dict[str, Any] | None = None


class HealthResponse(BaseModel):
    status: str
    time: datetime
    running_jobs: int
    queued_jobs: int


class MetricsResponse(BaseModel):
    metric_dicts: dict[str, str]


class DemoProgress(BaseModel):
    done: int
    total: int


class DemoTrial(BaseModel):
    id: int | str
    proposal: str
    metric: float | None = None
    status: str


class DemoMessage(BaseModel):
    role: Literal["user", "agent"]
    content: str


class DemoExperimentResponse(BaseModel):
    id: str
    category: str
    taskKey: str
    taskName: str
    modelName: str
    shortName: str
    name: str
    objective: str
    status: str
    progress: DemoProgress
    metricName: str
    bestMetric: float | None = None
    curve: list[float] = Field(default_factory=list)
    trials: list[DemoTrial] = Field(default_factory=list)
    logs: list[str] = Field(default_factory=list)
    conversation: list[DemoMessage] = Field(default_factory=list)
    maxTrials: int | None = None
    completedTrials: int | None = None
    searchSpace: dict[str, Any] | None = None


class DemoOptimizeRequest(BaseModel):
    category: str
    taskName: str
    modelName: str | None = None
    model: str | None = None
    max_trials: int = Field(..., ge=1)
    search_space: dict[str, Any] = Field(default_factory=dict)
    command: str | None = None
    n_jobs: int = Field(1, ge=1)
