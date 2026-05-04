from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from typing import Any

from .schemas import MainSelfAIRequest, OptimizationRequest


METRIC_DICT: dict[str, str] = {
    "siren_cat_me3_TV": "PSNR",
    "siren_cameraman_FH": "PSNR",
    "siren_cameraman_TV": "PSNR",
    "siren_cat_me3_FH": "PSNR",
    "sentiment_analysis": "training accuracy",
    "denoise_0.1_ROF_TV": "PSNR",
    "denoise_0.2_ROF_TV": "PSNR",
    "boston": "mean_score",
    "TC20_TW_toy": "PSNR",
    "mae": "validation accuracy",
    "LCBench_FashionMnist_Classification": "validation accuracy",
    "SAGE": "test_acc",
    "nnUnet_BTCV": "Dice",
    "nnUnet_params_2": "Dice",
    "resnet": "top1_error_10crop",
    "dino": "top1_kNN",
    "DNN_molecular_property": "accuracy",
}


def run_main_selfai_job(req: MainSelfAIRequest) -> dict[str, Any]:
    main_selfai, _, _ = _load_selfai_runtime_modules()

    _apply_main_selfai_env(req)
    main_selfai.main(req.model_name_list, req.json_name_list)

    work_dir = _resolve_main_work_dir(req)
    outputs = sorted(work_dir.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
    db_files = sorted(work_dir.glob("*.db"), key=lambda p: p.stat().st_mtime, reverse=True)
    log_files = sorted(work_dir.glob("*.log"), key=lambda p: p.stat().st_mtime, reverse=True)

    return {
        "mode": "main_selfai_strict",
        "work_dir": str(work_dir),
        "db_files": [str(p) for p in db_files],
        "log_files": [str(p) for p in log_files],
        "output_json_files": [str(p) for p in outputs],
        "latest_output_json": str(outputs[0]) if outputs else None,
    }


def run_optimization_job(req: OptimizationRequest) -> dict[str, Any]:
    gt_path = Path(req.gt_json_path).expanduser().resolve()
    train_path = Path(req.train_json_path).expanduser().resolve()

    if not gt_path.exists():
        raise FileNotFoundError(f"gt_json_path does not exist: {gt_path}")
    if not train_path.exists():
        raise FileNotFoundError(f"train_json_path does not exist: {train_path}")

    work_dir = (
        Path(req.work_dir).expanduser().resolve()
        if req.work_dir
        else train_path.parent.resolve()
    )
    work_dir.mkdir(parents=True, exist_ok=True)

    _apply_runtime_env(req, work_dir)

    main_selfai, CachedBase, create_logger = _load_selfai_runtime_modules()

    dataset_name = req.dataset or gt_path.parent.name
    metric = req.metric or _guess_metric(gt_path)
    stop_rule = req.stop_rule or _default_stop_rule(metric)
    exp_desc = req.experimental_desc or f"{train_path.stem}_{req.model_info.replace(':', '_')}"

    args = SimpleNamespace(
        train_json_path=str(train_path),
        gt_json_path=str(gt_path),
        experimental_desc=exp_desc,
        dataset=dataset_name,
        stop_rule=stop_rule,
        ignore_key=req.ignore_key,
        metric=metric,
        n_jobs=req.n_jobs,
        debug=req.debug,
        auto_debug=req.auto_debug,
        model_info=req.model_info,
        source=req.source or "ollama",
        completed_trials=req.completed_trials,
        rag=req.rag,
        threshold=req.threshold,
        vector_backend=req.vector_backend,
        fmt=req.fmt,
        search_type=req.search_type,
    )
    args.log_file = str(work_dir / f"{args.experimental_desc}.log")

    cache_name = req.cache_name or f"{train_path.stem}_{req.model_info.replace(':', '_')}_record"
    cache = CachedBase()
    cache.init(saved_fname=cache_name)
    main_selfai.cache = cache

    logger = create_logger(
        args.experimental_desc,
        work_dir=str(Path(args.log_file).parent),
        cfg=None,
    )

    main_selfai.interact(args, logger=logger)

    final_train_path = _find_final_train_path(train_path)
    summary = _build_result_summary(final_train_path, req.n_jobs)
    summary["job_info"] = {
        "gt_json_path": str(gt_path),
        "train_json_path": str(train_path),
        "final_train_json_path": str(final_train_path),
        "log_file": args.log_file,
        "metric": metric,
        "model_info": req.model_info,
        "dataset": dataset_name,
        "work_dir": str(work_dir),
    }
    return summary


def _load_selfai_runtime_modules():
    repo_root = Path(__file__).resolve().parents[1]
    selfai_dir = repo_root / "selfai"
    if str(selfai_dir) not in sys.path:
        sys.path.insert(0, str(selfai_dir))
    try:
        import main_selfai
        from utils.client import CachedBase, create_logger
    except ModuleNotFoundError as exc:
        missing = str(exc)
        raise RuntimeError(
            f"Failed to import selfai runtime dependency: {missing}. "
            "Please install required packages first (see requirements-service.txt)."
        )
    return main_selfai, CachedBase, create_logger


def _apply_main_selfai_env(req: MainSelfAIRequest) -> None:
    os.environ["n_jobs"] = str(req.n_jobs)
    os.environ["completed_trials"] = str(req.completed_trials)
    os.environ["max_retries"] = str(req.max_retries)
    os.environ["retry_delay"] = str(req.retry_delay)
    os.environ["cached_mode"] = req.cached_mode
    os.environ["cache_path"] = req.cache_path
    os.environ["saved_as_path"] = req.saved_as_path or req.cache_path

    os.environ["SELF_AI_WORK_DIR"] = str(Path(req.work_dir).expanduser().resolve())

    os.environ["SELF_AI_DB_NAME"] = req.db_name
    os.environ["SELF_AI_CLEAR_DB"] = "1" if req.clear_db else "0"
    os.environ["SELF_AI_OPTUNA_N_JOBS"] = str(req.optuna_n_jobs)
    os.environ["SELF_AI_STUDY_NAME"] = req.study_name
    os.environ["SELF_AI_STUDY_DIRECTION"] = req.study_direction
    if req.cache_name:
        os.environ["SELF_AI_CACHE_NAME"] = req.cache_name
    else:
        os.environ.pop("SELF_AI_CACHE_NAME", None)

    if req.openai_api_key:
        os.environ["OPENAI_API_KEY"] = req.openai_api_key
    if req.deepseek_api_key:
        os.environ["DEEPSEEK_API_KEY"] = req.deepseek_api_key
    if req.claude_api_key:
        os.environ["CLAUDE_API_KEY"] = req.claude_api_key


def _resolve_main_work_dir(req: MainSelfAIRequest) -> Path:
    return Path(req.work_dir).expanduser().resolve()


def _apply_runtime_env(req: OptimizationRequest, work_dir: Path) -> None:
    os.environ["MODEL_INFO"] = req.model_info
    os.environ["n_jobs"] = str(req.n_jobs)
    os.environ["completed_trials"] = str(req.completed_trials)
    os.environ["max_retries"] = str(req.max_retries)
    os.environ["retry_delay"] = str(req.retry_delay)

    os.environ["work_dir"] = str(work_dir)
    os.environ["cached_mode"] = req.cache_mode
    os.environ["cache_path"] = req.cache_path
    os.environ["saved_as_path"] = req.saved_as_path or req.cache_path

    if req.openai_api_key:
        os.environ["OPENAI_API_KEY"] = req.openai_api_key
    if req.deepseek_api_key:
        os.environ["DEEPSEEK_API_KEY"] = req.deepseek_api_key
    if req.claude_api_key:
        os.environ["CLAUDE_API_KEY"] = req.claude_api_key


def _default_stop_rule(metric: str) -> str:
    return (
        "You do not need to test all configuration.\n"
        "---\n"
        "Step 1: Analyze all criteria from completed trials:\n"
        "1. Have all promising configurations already been tested?\n"
        "2. Are unexplored configurations unlikely to perform better?\n"
        f"3. Has best metric `{metric}` improved significantly over early trials?\n"
        "---\n"
    )


def _guess_metric(gt_path: Path) -> str:
    dataset_key = gt_path.stem.replace("_gt", "")
    if dataset_key in METRIC_DICT:
        return METRIC_DICT[dataset_key]

    data = json.loads(gt_path.read_text(encoding="utf-8"))
    trials = data[1]["content"]["trials"] if isinstance(data, list) else []
    if not trials:
        raise ValueError("Unable to infer metric from empty gt trials")

    sample = trials[0]
    metric_keys = [k for k in sample.keys() if k not in {"number", "params"}]
    if not metric_keys:
        raise ValueError("Unable to infer metric key from gt trials")
    return metric_keys[0]


def _find_final_train_path(original_train_path: Path) -> Path:
    stem = original_train_path.stem
    parent = original_train_path.parent
    candidates = [
        original_train_path,
        parent / f"{stem}_y.json",
        parent / f"{stem}_n.json",
        parent / f"{stem}_stop.json",
    ]
    existing = [p for p in candidates if p.exists()]
    if not existing:
        raise FileNotFoundError(
            f"No output train json found after run. Checked: {[str(p) for p in candidates]}"
        )
    return max(existing, key=lambda p: p.stat().st_mtime)


def _build_result_summary(train_path: Path, n_jobs: int) -> dict[str, Any]:
    data = json.loads(train_path.read_text(encoding="utf-8"))
    content = data[1]["content"]
    trials = content.get("trials", [])

    recent = trials[-n_jobs:] if trials else []
    stopped = train_path.stem.endswith("_y") or train_path.stem.endswith("_stop")
    return {
        "stopped": stopped,
        "completed_trials": content.get("completed_trials", len(trials)),
        "max_trials": content.get("max_trials"),
        "total_trials": len(trials),
        "latest_trials": recent,
    }
