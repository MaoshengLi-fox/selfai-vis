# SelfAI-Vis Development Guide

## 1. Project Overview

`selfai-vis` is a full-stack project with:

- `web/`: Next.js frontend for paper visualization and interactive demo.
- `server/`: FastAPI backend that exposes demo data and optimization APIs.

The frontend can run in fallback mode without backend data, while full demo and optimization workflows require the backend.

## 2. Repository Structure

```text
selfai-vis/
  web/
    app/
      page.js                 # Paper page rendered from LaTeX sources
      demo/
        page.js               # Demo route entry
        DemoWorkbench.jsx     # Main interactive demo console
    SelfAI___NeurIPS_2026/    # LaTeX source and bibliography
    package.json
  server/
    service_backend/
      app.py                  # FastAPI app and routes
      schemas.py              # Pydantic request/response models
      demo_loader.py          # Load and normalize demo experiment data
      runner.py               # Runtime execution bridge to selfai logic
      job_manager.py          # In-memory async job queue
    selfai/                   # Core runtime implementation
    data_and_results/         # Demo datasets and run artifacts
    SERVICE_API.md
```

## 3. Architecture

### 3.1 Frontend

- Built with Next.js App Router (`next@16`, `react@19`).
- Main paper page (`web/app/page.js`) parses LaTeX sections, equations, figures, tables, and bibliography into HTML.
- Demo page (`web/app/demo/DemoWorkbench.jsx`) provides:
  - category/task/model switchers
  - JSON editor for optimization commands
  - polling-based runtime status updates
  - trial table, metric curve, and live log panel

API base URL is controlled by:

- `NEXT_PUBLIC_SELFAI_API_BASE` (default: `http://127.0.0.1:8000`)

### 3.2 Backend

- Built with FastAPI and Pydantic v2.
- Main API app: `server/service_backend/app.py`
- Responsibilities:
  - health and metric metadata endpoints
  - demo experiment listing from `server/data_and_results`
  - async/sync optimization endpoints
  - serverless-mode graceful degradation (`501` for heavy endpoints)

Core runtime flow:

1. Request validated by schemas in `schemas.py`.
2. API dispatches to runner functions in `runner.py`.
3. Runner configures environment variables and invokes `server/selfai/main_selfai.py`.
4. Output JSON/log/DB files are collected and returned as summary.

## 4. API Summary

Primary endpoints:

- `GET /api/v1/health`
- `GET /api/v1/meta/metrics`
- `GET /api/v1/demo/experiments`
- `POST /api/v1/demo/optimize`
- `POST /api/v1/jobs/optimize`
- `GET /api/v1/jobs`
- `GET /api/v1/jobs/{job_id}`
- `DELETE /api/v1/jobs/{job_id}`
- `POST /api/v1/optimize/run`
- `POST /api/v1/jobs/optimize-legacy`

OpenAPI docs:

- `http://127.0.0.1:8000/docs`

## 5. Local Development Setup

## 5.1 Backend

```bash
cd server
pip install -r requirements-service.txt
uvicorn service_backend.app:app --host 0.0.0.0 --port 8000 --reload
```

Optional environment file:

- Path defaults to `server/.env`
- Override with `SELFAI_ENV_FILE`

Important runtime variables used by backend runner:

- `OPENAI_API_KEY`
- `DEEPSEEK_API_KEY`
- `CLAUDE_API_KEY`
- `SELF_AI_WORK_DIR`
- `SELF_AI_DB_NAME`
- `SELF_AI_CLEAR_DB`

## 5.2 Frontend

```bash
cd web
npm install
npm run dev
```

Visit:

- `http://127.0.0.1:3000/` (paper page)
- `http://127.0.0.1:3000/demo` (interactive demo)

## 6. Data and Demo Conventions

`demo_loader.py` expects data under `server/data_and_results` using category/task/model hierarchy.

Run file naming conventions influence status:

- `*_y.json` => Completed
- `*_stop.json` => Stopped
- `*_n.json` => Failed
- otherwise => Running

Model folder logs and `*_record.json` files are used to render runtime traces and summarized conversation snippets.

## 7. Deployment Notes

- `server/vercel.json` configures server deployment.
- In serverless mode (`VERCEL=1` or `SELFAI_SERVERLESS=1`):
  - lightweight endpoints stay available
  - optimization/job endpoints return `501`
- Use persistent worker environments for optimization execution.

## 8. Development Workflow Recommendations

- Keep `web` and `server` API contracts aligned through `schemas.py`.
- Validate JSON input shape early in frontend before submission (already implemented in `DemoWorkbench.jsx`).
- Prefer adding new API routes in `app.py` with explicit schema models.
- Keep long-running/CPU-heavy work inside backend runner layer, not in request handlers.
- When adding new task/model demo assets, follow existing file naming patterns so loader and status parsing continue to work.

## 9. `/demo` Page Notes

Core files:

- `web/app/demo/page.js`: Next.js route entry that mounts `DemoWorkbench`.
- `web/app/demo/DemoWorkbench.jsx`: client state, data loading, experiment switching, command submission, and log polling.
- `web/app/demo/demo.module.css`: page-scoped CSS Modules styles.

Page data flow:

1. The page requests `GET /api/v1/demo/experiments` on first load.
2. If the request fails, `FALLBACK_EXPERIMENTS` keeps the route renderable.
3. Category/task/model selections derive `selectedExperiment` from the local experiment list.
4. JSON command submission calls `POST /api/v1/demo/optimize`.
5. While an experiment is running/pending/queued or a submission is active, the page polls the experiment list and merges log lines.

The current UI follows a scientific discovery console layout:

- Global top bar with brand, Agent/Python/Active/Running status, and user tools.
- Left navigation for Home, Experiments, Search Space, Trials, Visualizations, Artifacts, Reports, and Settings.
- Experiment cards grouped by category with task/model selectors and trial progress.
- Agent Workspace with backend conversation, submitted user commands, and the structured JSON editor.
- Experiment Area with summary stats, tabs, performance curve, metric chips, and trial results table.
- Runtime Logs panel with dark terminal styling and auto-follow scrolling.

Maintenance rules:

- Prefer existing derived state such as `selectedExperiment`, `categoryGroups`, and `messageKey` when adding interactions.
- Keep decorative copy local to JSX, but runtime values must come from `selectedExperiment` or API payloads.
- Normalize new backend fields in `toSafeExperiment` before rendering them.
- Keep page styles in `demo.module.css` so the paper page remains isolated.
- Preserve fallback mode; `/demo` should not blank-screen when the backend is offline.

## 10. Common Checks

Frontend:

```bash
cd web
npm run build
```

Backend:

```bash
cd server
python -m compileall service_backend
```

API smoke test:

```bash
curl http://127.0.0.1:8000/api/v1/health
curl http://127.0.0.1:8000/api/v1/demo/experiments
```
