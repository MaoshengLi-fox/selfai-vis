# Demo Page Design Document (`/demo`)

## 1. Scope

This document defines the dedicated page design for the `/demo` route, including:

- information architecture
- interaction model
- frontend state model
- backend API dependencies
- error handling and fallback behavior
- extensibility guidelines

## 2. Product Goal

`/demo` is the interactive console of SelfAI-Vis. It should let users:

- inspect available experiments grouped by category/task/model
- submit optimization commands safely in JSON
- observe live runtime behavior (status, logs, curve, trial outputs)
- continue to operate with reduced capability when backend is unavailable

## 3. Page Information Architecture

Top-to-bottom layout:

1. Header region
   - page title
   - active experiment label
   - global inline error text
2. Experiment switcher region
   - category cards
   - task selector
   - model selector
3. Main work region (two-column)
   - left: Agent Workspace
   - right: Selected Experiment View
4. Runtime logs region

## 4. Module Design

## 4.1 Header Module

Responsibilities:

- show current selected experiment (`shortName`)
- show request/validation errors
- provide return navigation to homepage section (`/#abstract`)

## 4.2 Experiment Switcher Module

Responsibilities:

- group experiments by category, then task, then model
- maintain user selection in 3 dimensions:
  - selected category
  - selected task for each category
  - selected model for each category+task
- show quick summary per card:
  - status
  - done/total progress
  - best metric

Data normalization and grouping are handled by:

- `toSafeExperiment(...)`
- `categoryGroups` (`useMemo`)

## 4.3 Agent Workspace Module (Left Column)

Contains:

- message list (user-submitted JSON history per experiment key)
- JSON input editor

JSON editor behavior:

- if JSON is parseable: render tree editor with typed controls
  - string -> text input
  - number -> numeric input
  - boolean -> select
  - null -> fixed label/select
- if JSON is invalid: fallback to raw textarea

Submission rules:

- `max_trials` must be a positive integer
- `search_space` must be an object
- submit button disabled when loading/submitting

## 4.4 Selected Experiment View (Right Column)

Contains:

- Experiment Status card
  - name/objective/status/progress/metric/best metric
- Performance Curve card
  - best-so-far metric series as SVG polyline
- Trial Results card
  - latest trials with proposal, metric, status

## 4.5 Runtime Logs Module

Responsibilities:

- display merged runtime logs for selected experiment
- auto-scroll to bottom when user is following live output
- stop auto-follow when user manually scrolls upward

Log merge behavior:

- if next logs are identical -> keep existing reference
- if next logs extend previous by prefix -> append delta only
- if log stream is replaced/reset -> accept next logs

## 5. Frontend State Model

Main state clusters:

- data state
  - `experiments`
  - `loading`
  - `errorText`
- selection state
  - `selectedCategory`
  - `selectedTaskByCategory`
  - `selectedModelByCategoryTask`
- command state
  - `command`
  - `submitting`
- per-experiment session state
  - `userMessages`
  - `liveLogsByKey`

Derived state:

- grouped category/task/model structure
- currently selected experiment
- selected experiment message key
- runtime log source (live vs initial)

## 6. API Contract and Network Flow

## 6.1 Initial Load

- `GET /api/v1/demo/experiments`
- success: normalize payload to safe experiment objects
- failure: show fallback experiment + error hint

## 6.2 Command Submission

- `POST /api/v1/demo/optimize`
- request payload:
  - `category`
  - `taskName`
  - `modelName` / `model`
  - `max_trials`
  - `search_space`
  - optional `command`
  - `n_jobs`
- success:
  - update matching experiment in list
  - keep formatted JSON in editor
- failure:
  - show `Failed to run demo optimize: ...`

## 6.3 Polling

Polling starts when selected experiment is running or command is submitting:

- periodic `GET /api/v1/demo/experiments` (current interval: 700ms)
- locate current experiment by composite key (`category::task::model`)
- update experiment record + merged log lines

## 7. UX States and Error Handling

Primary UI states:

- `loading`: first data fetch
- `ready`: data loaded
- `submitting`: command in flight
- `running`: poll-driven live updates
- `fallback`: backend unreachable, synthetic local experiment shown
- `error`: validation error or request error text displayed inline

Design choice:

- polling failures are silent to avoid noisy transient network errors
- explicit errors are shown only for user-triggered actions

## 8. Accessibility and Usability Notes

- experiment cards and selectors are keyboard-focusable native controls
- form submission uses semantic `<form>`
- chart includes `role="img"` and `aria-label`
- JSON tree editor improves readability over raw text-only input

## 9. Performance Considerations

- grouping and selection resolution are memoized
- one-time initial load protected by `hasLoadedRef`
- log auto-follow avoids expensive scroll operations when user is reviewing history
- recommended future optimization: adaptive polling interval (e.g., 700ms -> 2s when idle)

## 10. Extensibility Guidelines

Recommended next-step capabilities:

- URL-synced selection state for deep linking
- preset command templates per task/model
- schema-driven form mode alongside JSON mode
- trial detail drawer with parameter diff and metric delta
- capability badge in header (worker vs serverless backend)

Implementation guidance:

- preserve current experiment key convention to keep message/log state stable
- add fields in `toSafeExperiment(...)` to keep defensive normalization centralized
- avoid introducing API coupling directly in presentation-only child components
