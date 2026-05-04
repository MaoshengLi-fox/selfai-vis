from __future__ import annotations

from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime
from threading import Lock
from typing import Any, Callable
from uuid import uuid4


@dataclass
class JobRecord:
    job_id: str
    status: str
    created_at: datetime
    started_at: datetime | None = None
    finished_at: datetime | None = None
    error: str | None = None
    result: dict[str, Any] | None = None
    future: Future | None = None


class JobManager:
    def __init__(self, max_workers: int = 2):
        self._executor = ThreadPoolExecutor(max_workers=max_workers)
        self._jobs: dict[str, JobRecord] = {}
        self._lock = Lock()

    def submit(self, runner: Callable[..., dict[str, Any]], *args, **kwargs) -> JobRecord:
        job_id = str(uuid4())
        record = JobRecord(job_id=job_id, status="queued", created_at=datetime.utcnow())
        with self._lock:
            self._jobs[job_id] = record

        def wrapped() -> dict[str, Any]:
            self._mark_started(job_id)
            try:
                result = runner(*args, **kwargs)
                self._mark_finished(job_id, result=result)
                return result
            except Exception as exc:
                self._mark_failed(job_id, str(exc))
                raise

        future = self._executor.submit(wrapped)
        record.future = future
        return record

    def get(self, job_id: str) -> JobRecord | None:
        with self._lock:
            return self._jobs.get(job_id)

    def list(self) -> list[JobRecord]:
        with self._lock:
            return list(self._jobs.values())

    def remove(self, job_id: str) -> bool:
        with self._lock:
            record = self._jobs.get(job_id)
            if record is None:
                return False
            if record.future and not record.future.done():
                return False
            del self._jobs[job_id]
            return True

    def stats(self) -> tuple[int, int]:
        queued, running = 0, 0
        with self._lock:
            for item in self._jobs.values():
                if item.status == "queued":
                    queued += 1
                elif item.status == "running":
                    running += 1
        return queued, running

    def _mark_started(self, job_id: str) -> None:
        with self._lock:
            record = self._jobs[job_id]
            record.status = "running"
            record.started_at = datetime.utcnow()

    def _mark_finished(self, job_id: str, result: dict[str, Any]) -> None:
        with self._lock:
            record = self._jobs[job_id]
            record.status = "succeeded"
            record.finished_at = datetime.utcnow()
            record.result = result

    def _mark_failed(self, job_id: str, error: str) -> None:
        with self._lock:
            record = self._jobs[job_id]
            record.status = "failed"
            record.finished_at = datetime.utcnow()
            record.error = error
