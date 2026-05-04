# SelfAI Backend Service

## 1. Install

```bash
pip install -r requirements-service.txt
```

## 2. Run

```bash
uvicorn service_backend.app:app --host 0.0.0.0 --port 8000 --reload
```

## 3. API

- `GET /api/v1/health`
- `GET /api/v1/meta/metrics`
- `GET /api/v1/demo/experiments` (demo view data aggregated from `server/data_and_results`)
- `POST /api/v1/jobs/optimize` (async, strict `main_selfai` mode with Optuna)
- `GET /api/v1/jobs`
- `GET /api/v1/jobs/{job_id}`
- `DELETE /api/v1/jobs/{job_id}`
- `POST /api/v1/optimize/run` (sync strict mode)
- `POST /api/v1/jobs/optimize-legacy` (async, previous direct-interact mode)

Swagger:
- `http://127.0.0.1:8000/docs`

## 4. Example

```bash
curl -X POST "http://127.0.0.1:8000/api/v1/jobs/optimize" \
  -H "Content-Type: application/json" \
  -d '{
    "model_name_list": ["gpt-4o-mini"],
    "json_name_list": ["VO/TC20_TW_toy"],
    "work_dir": "/Users/foxli/Desktop/codeBase/self_ai_backend/data and results/VO/TC20_TW_Toy/gpt-4o-mini-service",
    "n_jobs": 3,
    "completed_trials": 3,
    "cached_mode": "all",
    "cache_path": "",
    "db_name": "ollama_completion",
    "clear_db": true,
    "max_retries": 1,
    "retry_delay": 1,
    "optuna_n_jobs": 1,
    "study_name": "ollama",
    "study_direction": "maximize",
    "openai_api_key": "YOUR_OPENAI_API_KEY"
  }'
```

Then query status:

```bash
curl "http://127.0.0.1:8000/api/v1/jobs/<job_id>"
```
