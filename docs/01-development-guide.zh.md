# SelfAI-Vis 开发文档

## 1. 项目概览

`selfai-vis` 是一个前后端分离项目，包含：

- `web/`：Next.js 前端，用于论文展示与交互式 Demo。
- `server/`：FastAPI 后端，提供实验数据与优化相关 API。

前端可在无后端时进入 fallback 模式；完整的 Demo 与优化流程需要后端服务在线。

## 2. 仓库结构

```text
selfai-vis/
  web/
    app/
      page.js                 # 由 LaTeX 源渲染的论文主页
      demo/
        page.js               # Demo 路由入口
        DemoWorkbench.jsx     # 主交互控制台
    SelfAI___NeurIPS_2026/    # LaTeX 论文与参考文献
    package.json
  server/
    service_backend/
      app.py                  # FastAPI 应用与路由
      schemas.py              # Pydantic 请求/响应模型
      demo_loader.py          # Demo 实验数据装载与归一化
      runner.py               # 调用 selfai 核心逻辑的执行桥接层
      job_manager.py          # 内存异步任务队列
    selfai/                   # 核心运行时实现
    data_and_results/         # Demo 数据和运行产物
    SERVICE_API.md
```

## 3. 架构说明

### 3.1 前端

- 基于 Next.js App Router（`next@16`、`react@19`）。
- 论文页（`web/app/page.js`）会解析 LaTeX 的章节、公式、图表与参考文献，并渲染为 HTML。
- Demo 页（`web/app/demo/DemoWorkbench.jsx`）提供：
  - category/task/model 切换
  - JSON 优化指令编辑
  - 轮询式状态刷新
  - trial 表格、指标曲线、实时日志面板

前端 API 基地址通过以下环境变量控制：

- `NEXT_PUBLIC_SELFAI_API_BASE`（默认 `http://127.0.0.1:8000`）

### 3.2 后端

- 基于 FastAPI + Pydantic v2。
- 主 API 入口：`server/service_backend/app.py`
- 主要职责：
  - 健康检查与指标元数据接口
  - 从 `server/data_and_results` 聚合 Demo 实验视图
  - 异步/同步优化接口
  - Serverless 模式降级（重任务端点返回 `501`）

核心执行流程：

1. `schemas.py` 完成请求模型校验。
2. `app.py` 路由分发到 `runner.py`。
3. `runner.py` 组装环境变量并调用 `server/selfai/main_selfai.py`。
4. 收集输出 JSON / 日志 / DB 文件并返回摘要。

## 4. API 总览

主要端点：

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

OpenAPI 文档：

- `http://127.0.0.1:8000/docs`

## 5. 本地开发环境

### 5.1 启动后端

```bash
cd server
pip install -r requirements-service.txt
uvicorn service_backend.app:app --host 0.0.0.0 --port 8000 --reload
```

可选环境文件：

- 默认路径：`server/.env`
- 可通过 `SELFAI_ENV_FILE` 覆盖

后端执行层常用环境变量：

- `OPENAI_API_KEY`
- `DEEPSEEK_API_KEY`
- `CLAUDE_API_KEY`
- `SELF_AI_WORK_DIR`
- `SELF_AI_DB_NAME`
- `SELF_AI_CLEAR_DB`

### 5.2 启动前端

```bash
cd web
npm install
npm run dev
```

访问：

- `http://127.0.0.1:3000/`（论文展示页）
- `http://127.0.0.1:3000/demo`（交互 Demo）

## 6. 数据与 Demo 约定

`demo_loader.py` 默认读取 `server/data_and_results` 下的 category/task/model 层级目录。

运行结果文件名会直接影响状态推断：

- `*_y.json` => Completed
- `*_stop.json` => Stopped
- `*_n.json` => Failed
- 其他 => Running

模型目录中的 `.log` 与 `*_record.json` 会被用于日志展示与对话摘要构建。

## 7. 部署说明

- `server/vercel.json` 用于后端部署配置。
- 在 Serverless 模式（`VERCEL=1` 或 `SELFAI_SERVERLESS=1`）下：
  - 轻量端点可用
  - 优化/任务相关端点返回 `501`
- 生产优化任务应部署在持久化 worker 环境，而非纯 Serverless 环境。

## 8. 开发建议

- 通过 `schemas.py` 维护前后端接口契约一致性。
- 前端在提交前尽早校验 JSON 输入结构（`DemoWorkbench.jsx` 已实现）。
- 新增接口优先在 `app.py` 中显式绑定请求/响应模型。
- 将长耗时逻辑放在 runner 层，不要塞入路由处理器本体。
- 新增任务/模型 demo 资产时遵循现有命名规范，保证 loader 与状态解析逻辑稳定。

## 9. `/demo` 页面开发说明

核心文件：

- `web/app/demo/page.js`：Next.js 路由入口，仅挂载 `DemoWorkbench`。
- `web/app/demo/DemoWorkbench.jsx`：客户端交互、数据装载、实验切换、命令提交、日志轮询。
- `web/app/demo/demo.module.css`：页面级 CSS Modules 样式。

页面数据流：

1. 首次进入页面时请求 `GET /api/v1/demo/experiments`。
2. 失败时使用 `FALLBACK_EXPERIMENTS`，页面仍可打开并显示 fallback 状态。
3. 用户选择 category/task/model 后，`selectedExperiment` 由本地实验列表派生。
4. 用户提交 JSON 指令后调用 `POST /api/v1/demo/optimize`。
5. 当实验处于 running/pending/queued 或正在提交时，页面轮询实验列表并合并日志。

本次 UI 已按科学发现控制台设计重构为：

- 顶部全局状态栏：品牌、Agent/Python/Active/Running 状态、用户工具区。
- 左侧导航：Home、Experiments、Search Space、Trials、Visualizations、Artifacts、Reports、Settings。
- 实验卡片区：按 category 聚合，每张卡展示任务、状态、trial 进度、task/model 选择器。
- Agent Workspace：展示后端 conversation 与用户提交的 JSON 指令，并保留结构化 JSON 编辑器。
- Experiment Area：包含状态摘要、tabs、performance 曲线、metric chips、trial results 表格。
- Runtime Logs：底部深色日志台，支持自动跟随滚动到底部。

维护约定：

- 新增交互优先复用 `selectedExperiment`、`categoryGroups`、`messageKey` 等已派生状态，避免复制来源数据。
- UI 文案和静态装饰尽量放在 JSX 局部，真实运行数据必须来自 `selectedExperiment` 或 API payload。
- 若新增后端字段，先在 `toSafeExperiment` 中做类型收敛，再进入渲染层。
- CSS 类继续使用 `demo.module.css`，避免影响论文主页的全局样式。
- 保持 fallback 模式可用，不能因为后端未启动导致 `/demo` 白屏。

## 10. 常用校验

前端：

```bash
cd web
npm run build
```

后端：

```bash
cd server
python -m compileall service_backend
```

API smoke test：

```bash
curl http://127.0.0.1:8000/api/v1/health
curl http://127.0.0.1:8000/api/v1/demo/experiments
```
