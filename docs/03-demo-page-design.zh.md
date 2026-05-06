# Demo 页面设计文档（`/demo`）

## 1. 范围

本文档专门定义 `/demo` 页面设计，包括：

- 信息架构
- 交互模型
- 前端状态模型
- 后端接口依赖
- 错误处理与 fallback 策略
- 后续扩展规范

## 2. 产品目标

`/demo` 是 SelfAI-Vis 的交互控制台，核心目标是让用户可以：

- 按 category/task/model 浏览实验
- 通过 JSON 安全地下发优化命令
- 实时观察运行状态（状态、日志、曲线、trial）
- 在后端不可用时保持降级可用

## 3. 页面信息架构

页面自上而下结构：

1. 顶部 Header 区
   - 页面标题
   - 当前激活实验标识
   - 全局错误提示
2. 实验切换区
   - category 卡片
   - task 选择器
   - model 选择器
3. 主工作区（左右双栏）
   - 左栏：Agent Workspace
   - 右栏：Selected Experiment View
4. 运行日志区

## 4. 模块设计

### 4.1 Header 模块

职责：

- 显示当前选中实验（`shortName`）
- 展示请求/校验错误信息
- 提供回到主页锚点（`/#abstract`）导航

### 4.2 实验切换模块

职责：

- 按 category -> task -> model 分层组织实验
- 维护三维选择状态：
  - 当前 category
  - 每个 category 下选中的 task
  - 每个 category+task 下选中的 model
- 每个卡片展示摘要：
  - status
  - done/total
  - best metric

核心实现依赖：

- `toSafeExperiment(...)`
- `categoryGroups`（`useMemo`）

### 4.3 Agent Workspace 模块（左栏）

包含：

- 消息历史（按实验键记录用户提交过的 JSON）
- JSON 输入编辑器

JSON 编辑器行为：

- JSON 可解析时：显示树形编辑器与类型控件
  - string -> 文本输入
  - number -> 数值输入
  - boolean -> 下拉框
  - null -> 固定标签/选择
- JSON 不可解析时：回退为原始 textarea

提交校验规则：

- `max_trials` 必须为正整数
- `search_space` 必须为对象
- `loading/submitting` 时禁用提交按钮

### 4.4 实验视图模块（右栏）

包含：

- Experiment Status 卡片
  - name/objective/status/progress/metric/best metric
- Performance Curve 卡片
  - best-so-far 指标折线（SVG）
- Trial Results 卡片
  - trial proposal、metric、status

### 4.5 Runtime Logs 模块

职责：

- 展示当前实验的运行日志
- 用户处于底部时自动跟随最新输出
- 用户上滚后停止自动跟随

日志合并策略：

- 新旧日志相同 -> 复用原引用
- 新日志以前缀扩展 -> 仅追加增量
- 日志被重置/替换 -> 采用新日志

## 5. 前端状态模型

主要状态分组：

- 数据状态
  - `experiments`
  - `loading`
  - `errorText`
- 选择状态
  - `selectedCategory`
  - `selectedTaskByCategory`
  - `selectedModelByCategoryTask`
- 命令状态
  - `command`
  - `submitting`
- 实验会话状态
  - `userMessages`
  - `liveLogsByKey`

派生状态：

- category/task/model 分组结果
- 当前选中实验对象
- 当前实验消息键
- 日志来源（实时日志 vs 初始日志）

## 6. 接口契约与网络流程

### 6.1 初始加载

- `GET /api/v1/demo/experiments`
- 成功：归一化为安全实验对象
- 失败：进入 fallback 实验并提示错误

### 6.2 命令提交

- `POST /api/v1/demo/optimize`
- 请求字段：
  - `category`
  - `taskName`
  - `modelName` / `model`
  - `max_trials`
  - `search_space`
  - 可选 `command`
  - `n_jobs`
- 成功：
  - 更新对应实验对象
  - 编辑区保留格式化 JSON
- 失败：
  - 展示 `Failed to run demo optimize: ...`

### 6.3 轮询刷新

当实验处于运行中或提交中时启动轮询：

- 周期请求 `GET /api/v1/demo/experiments`（当前间隔 700ms）
- 通过复合键（`category::task::model`）定位实验
- 更新实验对象与日志

## 7. 交互状态与错误处理

主要状态：

- `loading`：首次加载
- `ready`：可交互
- `submitting`：命令提交中
- `running`：轮询更新中
- `fallback`：后端不可达，显示本地兜底实验
- `error`：输入或请求错误提示

设计取舍：

- 轮询错误静默处理，避免网络抖动频繁打断
- 用户主动操作失败时才显式展示错误

## 8. 可访问性与可用性说明

- 选择卡片与下拉均为原生可聚焦控件
- 命令提交使用语义化 `<form>`
- 曲线图具备 `role="img"` 与 `aria-label`
- 树形 JSON 编辑降低复杂输入难度

## 9. 性能考虑

- 分组与选择解析均使用 memo 化
- 初次加载通过 `hasLoadedRef` 防止重复触发
- 日志自动跟随仅在需要时滚动，减少无效布局计算
- 后续建议：引入自适应轮询（运行中快轮询，空闲时慢轮询）

## 10. 扩展设计建议

建议迭代能力：

- 选择状态 URL 化，支持深链接分享
- 按 task/model 提供命令模板
- 增加 schema 表单模式（与 JSON 模式并存）
- 增加 trial 详情抽屉（参数差异 + 指标变化）
- 头部增加后端能力标识（worker / serverless）

实现建议：

- 保持现有 experiment key 规则，避免消息/日志状态漂移
- 新增数据字段优先在 `toSafeExperiment(...)` 中集中归一化
- 纯展示子组件不要直接耦合 API 调用
