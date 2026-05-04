from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any


DATA_ROOT = Path(__file__).resolve().parents[1] / "data_and_results"
CATEGORY_ORDER = ["BM", "CV", "DL", "MIA", "ML", "SAGE", "VO"]
PREFERRED_MODELS = [
    "GPT4-o3",
    "gpt4-o3",
    "GPT4-o3-mini",
    "gpt4-o3-mini",
    "gpt-4o-mini",
    "llm_es",
    "llm",
]
LOWER_BETTER_METRICS = {"top1_error_10crop"}


def load_demo_experiments() -> list[dict[str, Any]]:
    if not DATA_ROOT.exists():
        return []

    experiments: list[dict[str, Any]] = []
    for category in CATEGORY_ORDER:
        category_dir = DATA_ROOT / category
        if not category_dir.exists():
            continue
        task_dirs = _list_task_dirs(category_dir)
        for task_dir in task_dirs:
            experiments.extend(_build_task_payloads(category, task_dir))
    return experiments


def _list_task_dirs(category_dir: Path) -> list[Path]:
    if any(category_dir.glob("*_gt.json")):
        return [category_dir]
    return sorted([p for p in category_dir.iterdir() if p.is_dir()], key=lambda p: p.name.lower())


def _build_task_payloads(category: str, task_dir: Path) -> list[dict[str, Any]]:
    model_dirs = [p for p in task_dir.iterdir() if p.is_dir()]
    if not model_dirs:
        return []

    payloads: list[dict[str, Any]] = []
    for model_dir in sorted(model_dirs, key=lambda p: p.name.lower()):
        chosen_run = _latest_run_file(model_dir)
        if chosen_run is None:
            continue
        payload = _build_experiment_payload(category, task_dir, model_dir, chosen_run)
        if payload is not None:
            payloads.append(payload)

    # Keep preferred models first for better UX in dropdowns.
    preferred_order = {name.lower(): idx for idx, name in enumerate(PREFERRED_MODELS)}
    payloads.sort(
        key=lambda item: (
            item.get("category", ""),
            item.get("taskName", ""),
            preferred_order.get(str(item.get("modelName", "")).lower(), 10**6),
            str(item.get("modelName", "")).lower(),
        )
    )
    return payloads


def _build_experiment_payload(category: str, task_dir: Path, model_dir: Path, run_file: Path) -> dict[str, Any] | None:
    run_data = _read_json(run_file)
    if not isinstance(run_data, list) or len(run_data) < 2:
        return None

    user_content = run_data[1].get("content", {}) if isinstance(run_data[1], dict) else {}
    if not isinstance(user_content, dict):
        user_content = {}

    trials = user_content.get("trials", [])
    if not isinstance(trials, list):
        trials = []

    metric_name = _detect_metric_key(trials)
    best_trial_number, best_metric = _find_best_trial(trials, metric_name)
    curve = _build_curve(trials, metric_name)

    status = _status_from_filename(run_file.name)
    completed_trials = _to_int(user_content.get("completed_trials"), default=len(trials))
    max_trials = _to_int(user_content.get("max_trials"), default=len(trials))
    if status == "Running" and max_trials > 0 and completed_trials >= max_trials:
        status = "Completed"

    preview_trials = trials[-8:] if trials else []
    mapped_trials = [
        {
            "id": trial.get("number", idx + 1),
            "proposal": _params_to_text(trial.get("params", {})),
            "metric": _to_float(trial.get(metric_name)),
            "status": "Best" if trial.get("number") == best_trial_number else "Done",
        }
        for idx, trial in enumerate(preview_trials)
        if isinstance(trial, dict)
    ]

    task_name = task_dir.name
    model_name = model_dir.name
    task_key = _slug(f"{category}-{task_name}")
    run_tag = run_file.stem
    experiment_id = _slug(f"{category}-{task_name}-{model_name}-{run_tag}")

    return {
        "id": experiment_id,
        "category": category,
        "taskKey": task_key,
        "taskName": task_name,
        "modelName": model_name,
        "shortName": f"{category} · {task_name}",
        "name": f"{task_name} / {model_name}",
        "objective": f"Optimize {metric_name}" if metric_name else "Optimize metric",
        "status": status,
        "progress": {"done": completed_trials, "total": max_trials},
        "metricName": metric_name,
        "bestMetric": best_metric,
        "curve": curve,
        "trials": mapped_trials,
        "logs": _load_log_lines(run_file.parent, run_file.stem),
        "conversation": _load_conversation(run_file.parent, run_file.stem, task_name, model_name),
    }


def _latest_run_file(model_dir: Path) -> Path | None:
    candidates = [
        p
        for p in model_dir.rglob("*_train_*.json")
        if "_record.json" not in p.name
    ]
    if not candidates:
        return None
    return max(candidates, key=lambda p: p.stat().st_mtime)


def _read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def _detect_metric_key(trials: list[dict[str, Any]]) -> str:
    for trial in trials:
        if not isinstance(trial, dict):
            continue
        for key in trial.keys():
            if key not in {"number", "params"}:
                return key
    return "metric"


def _find_best_trial(trials: list[dict[str, Any]], metric_name: str) -> tuple[int | None, float | None]:
    best_num: int | None = None
    best_val: float | None = None
    lower_is_better = metric_name in LOWER_BETTER_METRICS
    for trial in trials:
        if not isinstance(trial, dict):
            continue
        value = _to_float(trial.get(metric_name))
        if value is None:
            continue
        number = _to_int(trial.get("number"), default=None)
        if best_val is None:
            best_val = value
            best_num = number
            continue
        if (lower_is_better and value < best_val) or (not lower_is_better and value > best_val):
            best_val = value
            best_num = number
    return best_num, best_val


def _build_curve(trials: list[dict[str, Any]], metric_name: str) -> list[float]:
    lower_is_better = metric_name in LOWER_BETTER_METRICS
    curve: list[float] = []
    best: float | None = None
    for trial in trials:
        if not isinstance(trial, dict):
            continue
        value = _to_float(trial.get(metric_name))
        if value is None:
            continue
        if best is None:
            best = value
        elif lower_is_better:
            best = min(best, value)
        else:
            best = max(best, value)
        curve.append(best)
    return curve


def _status_from_filename(filename: str) -> str:
    if filename.endswith("_y.json"):
        return "Completed"
    if filename.endswith("_stop.json"):
        return "Stopped"
    if filename.endswith("_n.json"):
        return "Failed"
    return "Running"


def _params_to_text(params: Any) -> str:
    if not isinstance(params, dict) or not params:
        return "-"
    items = list(params.items())[:4]
    return ", ".join(f"{k}={v}" for k, v in items)


def _load_log_lines(model_dir: Path, run_stem: str) -> list[str]:
    base = re.sub(r"_(y|n|stop)$", "", run_stem)
    log_file = model_dir / f"{base}.log"
    if not log_file.exists():
        log_candidates = sorted(model_dir.glob("*.log"), key=lambda p: p.stat().st_mtime, reverse=True)
        if not log_candidates:
            return []
        log_file = log_candidates[0]
    try:
        lines = [line.strip() for line in log_file.read_text(encoding="utf-8", errors="ignore").splitlines() if line.strip()]
    except Exception:
        return []
    return lines[-12:]


def _load_conversation(model_dir: Path, run_stem: str, task_name: str, model_name: str) -> list[dict[str, str]]:
    base = re.sub(r"_(y|n|stop)$", "", run_stem)
    record_file = model_dir / f"{base}_record.json"
    if not record_file.exists():
        record_candidates = sorted(model_dir.glob("*_record.json"), key=lambda p: p.stat().st_mtime, reverse=True)
        if not record_candidates:
            return [
                {"role": "user", "content": f"Show latest result for {task_name}."},
                {"role": "agent", "content": f"Loaded runtime summary from model `{model_name}`."},
            ]
        record_file = record_candidates[0]

    payload = _read_json(record_file)
    if not isinstance(payload, dict) or not payload:
        return []

    nested = next(iter(payload.values()))
    if not isinstance(nested, dict):
        return []

    keys = sorted(nested.keys(), key=_conversation_key_order)
    picked = keys[-4:]

    messages: list[dict[str, str]] = [{"role": "user", "content": f"Show latest result for {task_name}."}]
    for key in picked:
        content = str(nested.get(key, "")).strip().replace("\n", " ")
        if not content:
            continue
        if len(content) > 280:
            content = f"{content[:277]}..."
        messages.append({"role": "agent", "content": f"[{key}] {content}"})
    return messages[:6]


def _conversation_key_order(key: str) -> tuple[int, str]:
    match = re.match(r"^(\d+)-", key)
    if match:
        return int(match.group(1)), key
    return 10**9, key


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def _to_int(value: Any, default: int | None) -> int | None:
    try:
        if value is None:
            return default
        return int(value)
    except Exception:
        return default


def _to_float(value: Any) -> float | None:
    try:
        if value is None:
            return None
        return float(value)
    except Exception:
        return None
