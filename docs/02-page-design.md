# SelfAI-Vis Page Design Document

## 1. Scope

This document defines page-level design for:

- Home paper page (`/`)
- Interactive demo page (`/demo`)

It focuses on information architecture, UI composition, interaction flows, data dependencies, and implementation constraints based on the current codebase.

## 2. Design Goals

- Present NeurIPS paper content in a readable, web-native format.
- Provide an interactive experiment console for model-task optimization workflows.
- Keep the demo usable even when backend APIs are unavailable (fallback behavior).
- Preserve low-friction local development for frontend and backend teams.

## 3. Global Structure

## 3.1 Route Map

- `/`: paper rendering and navigation
- `/demo`: experiment workbench

## 3.2 Shared Design Principles

- Progressive disclosure: show high-level summary first, then details.
- Readability first: math/table/figure content must remain understandable.
- Safe interaction: validate user input before backend submission.
- Resilience: degraded UX must still be functional when backend is offline.

## 4. Home Page (`/`) Design

## 4.1 Information Architecture

1. Top navigation (brand + external links + demo CTA)
2. Hero section (title, authors, affiliations, action buttons)
3. Main layout:
   - left: table of contents
   - right: article body
4. References section
5. Footer

## 4.2 Content Rendering Pipeline

The page transforms LaTeX sources from `web/SelfAI___NeurIPS_2026/` into structured blocks:

- section paragraphs
- h3/h4 headings
- equations
- figures
- tables
- inline citations

Core rendering responsibilities:

- `tokenize(...)` classifies LaTeX blocks into UI block types.
- `renderMath(...)` uses KaTeX for math rendering.
- Bib parsing builds ordered references and clickable citation links.
- TOC IDs are generated for section and subsection anchors.

## 4.3 Interaction Design

- Sticky TOC enables quick in-page section jumps.
- Citation numbers link to reference list entries.
- External actions (`Paper`, `Code`) open in new tabs.
- `Try Demo` pushes users into interactive flow.

## 4.4 States

- `normal`: LaTeX and bib load successfully.
- `partial`: missing section file returns empty content but page still renders.
- `math-fallback`: KaTeX failure falls back to escaped `<code>` content.

## 5. Demo Page (`/demo`) Design

## 5.1 Information Architecture

1. Header + active experiment status
2. Experiment switcher (Category -> Task -> Model)
3. Two-column main grid:
   - left: Agent Workspace (messages + JSON input)
   - right: Selected Experiment View (status, curve, trials)
4. Runtime Logs panel

## 5.2 Core User Journey

1. Load experiments from `GET /api/v1/demo/experiments`.
2. User chooses category/task/model.
3. User edits JSON command (`max_trials`, `search_space`).
4. Frontend validates payload.
5. Submit to `POST /api/v1/demo/optimize`.
6. Poll experiment endpoint for updates while running.
7. Observe logs, curve, and trial table until completion.

## 5.3 Interaction Design Details

- Selection model:
  - category-level selection
  - task selection scoped by category
  - model selection scoped by category+task
- JSON editor:
  - tree editor for parsed JSON primitives
  - textarea fallback for invalid JSON text
- Log panel:
  - auto-follow when user is near bottom
  - stop auto-follow when user scrolls away
- Polling:
  - periodic refresh while running/submitting
  - silent failure handling during polling loop

## 5.4 Visual Components

- Experiment cards: concise status summary and best metric.
- Metric chart: SVG polyline + dots using best-so-far values.
- Trial table: latest trial proposals and metric values.
- Message history: persisted user-side per experiment key.

## 5.5 States and Errors

- `loading`: first fetch of experiments.
- `fallback`: backend unavailable, load local fallback experiment.
- `submitting`: disable submit button and show running label.
- `validation-error`: show inline error text for invalid JSON schema.
- `request-error`: show backend failure detail when API returns non-2xx.

## 6. Data Contracts

Primary response model consumed by demo page:

- `DemoExperimentResponse`
  - experiment identity (`category`, `taskName`, `modelName`)
  - progress (`done`, `total`)
  - metric context (`metricName`, `bestMetric`, `curve`)
  - trial snapshots, logs, conversation, search space

Request model for demo run:

- `DemoOptimizeRequest`
  - `category`, `taskName`, `modelName/model`
  - `max_trials`
  - `search_space`
  - optional `command`, `n_jobs`

## 7. Non-Functional Design Constraints

- Rendering safety:
  - sanitize plain text before HTML injection
  - carefully limit `dangerouslySetInnerHTML` to known rendered output paths
- Performance:
  - polling interval should balance responsiveness vs API pressure
  - long log arrays should be managed to avoid unbounded UI cost
- Compatibility:
  - frontend assumes backend URL from environment variable
  - backend serverless mode disables heavy endpoints by design

## 8. Future Design Extensions

- Add experiment-level URL state for shareable deep links.
- Add command presets and schema-aware form mode (in addition to JSON mode).
- Add trial detail drawer with parameter diff and metric trend context.
- Add backend capability badge (serverless vs worker) in demo header.
- Add page-level observability (request timings, API error counters).
