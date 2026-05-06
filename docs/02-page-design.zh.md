# SelfAI-Vis 页面设计文档

## 1. 范围

本文档定义以下页面的设计：

- 论文主页（`/`）
- 交互式 Demo 页面（`/demo`）

文档重点包含信息架构、UI 组成、交互流程、数据依赖和当前实现约束。

## 2. 设计目标

- 以网页原生方式清晰呈现 NeurIPS 论文内容。
- 提供可操作的实验优化控制台，支持任务与模型切换。
- 在后端不可用时仍保证 Demo 可用（fallback 策略）。
- 保持前后端协作下的低门槛本地开发体验。

## 3. 全局结构

### 3.1 路由结构

- `/`：论文渲染与阅读导航
- `/demo`：实验交互工作台

### 3.2 通用设计原则

- 渐进披露：先展示概览，再进入细节。
- 可读优先：公式、表格、图像在 Web 中保持可理解性。
- 安全交互：提交前先做输入校验。
- 韧性设计：后端离线时前端应保持基础可操作性。

## 4. 主页（`/`）设计

### 4.1 信息架构

1. 顶部导航（品牌 + 外链 + Demo 入口）
2. Hero 区（标题、作者、机构、操作按钮）
3. 主体布局：
   - 左侧目录（TOC）
   - 右侧正文（Article）
4. 参考文献区
5. 页脚

### 4.2 内容渲染管线

页面会将 `web/SelfAI___NeurIPS_2026/` 下的 LaTeX 转换为结构化内容块：

- 段落
- h3/h4 子标题
- 公式
- 图片
- 表格
- 文中引用

核心职责：

- `tokenize(...)`：将 LaTeX 片段分类为页面块类型。
- `renderMath(...)`：使用 KaTeX 渲染数学公式。
- Bib 解析：构建有序引用并建立可点击文献编号。
- TOC 构建：为章节与子章节生成锚点 ID。

### 4.3 交互设计

- 左侧 TOC 支持快速定位章节。
- 引用编号可跳转到文献列表对应条目。
- `Paper` / `Code` 外链新标签打开。
- `Try Demo` 引导进入交互流程。

### 4.4 页面状态

- `normal`：LaTeX 与 bib 正常加载。
- `partial`：部分源文件缺失时，页面仍可渲染。
- `math-fallback`：KaTeX 失败时回退为转义代码文本。

## 5. Demo 页面（`/demo`）设计

### 5.1 信息架构

1. 顶部状态区（当前实验上下文）
2. 实验切换区（Category -> Task -> Model）
3. 主体双栏：
   - 左栏：Agent Workspace（消息 + JSON 输入）
   - 右栏：实验视图（状态、曲线、trial）
4. 运行日志区

### 5.2 核心用户流程

1. 通过 `GET /api/v1/demo/experiments` 加载实验。
2. 用户选择 category/task/model。
3. 用户编辑 JSON 命令（`max_trials`、`search_space`）。
4. 前端执行输入校验。
5. 提交到 `POST /api/v1/demo/optimize`。
6. 运行期间轮询接口刷新状态。
7. 观察日志、曲线和 trial 直到结束。

### 5.3 交互细节

- 选择器模型：
  - category 维度选择
  - task 受 category 约束
  - model 受 category+task 约束
- JSON 编辑：
  - 解析成功时使用树形编辑
  - 解析失败时自动回退 textarea
- 日志区：
  - 用户位于底部时自动跟随
  - 用户上滚后停止自动跟随
- 轮询机制：
  - 运行中定时刷新
  - 轮询错误静默处理，避免打断使用

### 5.4 视觉组件

- 实验卡片：展示进度状态和最佳指标。
- 指标曲线：SVG 折线 + 点，呈现 best-so-far 走势。
- Trial 表格：展示参数提案、指标与状态。
- 消息区：按实验键维护用户消息历史。

### 5.5 状态与错误处理

- `loading`：首次加载实验数据。
- `fallback`：后端不可达时启用本地兜底数据。
- `submitting`：提交中禁用发送按钮并提示运行状态。
- `validation-error`：输入 JSON 不符合要求。
- `request-error`：后端非 2xx 返回时展示错误详情。

## 6. 数据契约

Demo 页面核心读取模型：

- `DemoExperimentResponse`
  - 标识字段：`category`、`taskName`、`modelName`
  - 进度字段：`done`、`total`
  - 指标字段：`metricName`、`bestMetric`、`curve`
  - 结果字段：trial 列表、日志、会话摘要、搜索空间

Demo 执行请求模型：

- `DemoOptimizeRequest`
  - `category`、`taskName`、`modelName/model`
  - `max_trials`
  - `search_space`
  - 可选 `command`、`n_jobs`

## 7. 非功能性约束

- 渲染安全：
  - 普通文本先转义再输出
  - `dangerouslySetInnerHTML` 仅用于可控渲染路径
- 性能：
  - 轮询频率需平衡实时性与后端压力
  - 日志列表需避免无限增长带来的渲染成本
- 兼容性：
  - 前端通过环境变量切换后端地址
  - 后端在 serverless 模式会禁用重计算端点

## 8. 后续设计扩展

- 增加实验维度 URL 状态，支持分享深链接。
- 增加命令预设与 schema 表单模式（补充 JSON 输入方式）。
- 增加 trial 详情抽屉，展示参数差异和趋势说明。
- 在 Demo 头部增加后端能力标识（serverless / worker）。
- 增加页面级观测指标（请求耗时、错误计数）。
