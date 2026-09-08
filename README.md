# AI Workflow Builder

Plain-English intent → a visual node graph → an executable, deployable automation pipeline.

Built to the spec in [`AI_Workflow_Blueprint.pdf`](./AI_Workflow_Blueprint.pdf). The
"Expansion" feature list in that document is intentionally **not** built yet — it comes later.

## Stack

| Layer | Choice | Why |
|---|---|---|
| Execution engine | **Temporal** (TypeScript SDK) | Durable, stateful, per-node retries — blueprint Phase 3, for free |
| API | **Hono** on Node | Small, fast HTTP layer |
| Compiler | **Claude** (`@anthropic-ai/sdk`, structured outputs) behind a provider interface | NL → DAG |
| Persistence | **PostgreSQL** + **Drizzle ORM** | Workflows, runs, per-node run rows |
| Canvas / chat UI | **React** + **Vite** + **React Flow** (`@xyflow/react`) + **Zustand** | Node graph + chat + run inspector |
| Local infra | **Docker Compose** | Postgres + Temporal dev server (+ Temporal UI on :8233) |

Monorepo via npm workspaces:

```
packages/core     shared DAG schema, node catalog, validation, topological sort, templating
apps/api          Hono server: /compile, workflow CRUD, run starter
apps/worker       Temporal worker: the executeWorkflow engine + per-node activities
apps/web          React canvas + chat + run panel
```

## Milestone 1 — the vertical slice (done)

A prompt flows end-to-end across all four blueprint phases:

1. **Phase 1 — input** — type a workflow in plain English in the chat panel.
2. **Phase 2 — compile** — `POST /api/workflows/compile` sends it to Claude (or the offline
   stub), which returns a validated DAG of typed nodes. It's auto-laid-out and saved.
3. **Phase 1 — canvas** — the graph renders live on the React Flow canvas.
4. **Phase 3 — execute** — "Dry run" starts a Temporal workflow that walks the DAG in
   topological order, running each node as its own activity (isolated retries, per-node
   state). Templating (`{{ trigger.pull_request.title }}`) resolves between nodes.
5. **Phase 4 — inspect** — the run panel shows every node's status, inputs, outputs, logs,
   and attempt count; node borders on the canvas turn green/red.

Node kinds so far: `trigger`, `llm`, `http_request`, `transform` (sandboxed JS expression),
`slack_post`. Dry runs never make external calls — HTTP is mocked, Slack is not sent, LLM
returns a deterministic mock (`DRY_RUN_LLM=live` overrides that).

## Milestone 2 — editable canvas (done)

The canvas is now a real editor, not just a viewer of the AI's output:

- **Inspector panel** — select any node to edit its label and typed config fields
  (text / textarea / select / JSON), driven by a node-catalog schema from the API.
- **Add / delete nodes** — a palette menu for every node kind; delete from the inspector
  or with the Delete key.
- **Connect / disconnect** — drag between handles to add edges; select + Delete to remove.
- **Live validation** — per-node config errors surface as a marker on the node, a list in
  the inspector, and an error count in the toolbar; runs are blocked while errors exist.
- **Auto-layout** button, and manual node positions are now preserved on save.
- Debounced autosave with a "Saved / Saving…" indicator.

## Setup

Prereqs: Node 20+, Docker Desktop.

```bash
npm install
cp .env.example .env          # add ANTHROPIC_API_KEY for the real compiler; set SECRET_KEY for prod
npm run infra:up              # Postgres + Temporal (Temporal UI: http://localhost:8233)
npm run db:push               # create tables
npm run dev                   # core (watch) + api :8787 + worker + web :5173
```

Open http://localhost:5173.

- `COMPILER_MODE=stub` (default) — no API key needed, keyword-matches a graph.
- `COMPILER_MODE=claude` — real compilation; needs `ANTHROPIC_API_KEY`. Model via `COMPILER_MODEL` (default `claude-sonnet-5`).

## Useful commands

```bash
npm run typecheck             # all workspaces
npm run build                 # all workspaces
npm run db:studio             # Drizzle Studio
npm run infra:down            # stop containers
```

## Milestone 3 — Secure Hub + Agent Deployment (done)

- **Secure Hub** — a credential vault (`connections`). Secrets are AES-256-GCM
  encrypted at rest, decrypted only inside the execution engine (the worker
  fetches them over a token-gated internal endpoint at activity time), and never
  returned to the browser or embedded in a graph. `slack_post` and `http_request`
  nodes can reference a connection; there's a Connections manager in the UI.
- **Agent Deployment** — "Deploy" compiles the current graph into a live webhook
  listener at `POST /api/hooks/<token>`. The graph is snapshotted at deploy time.
  Posting a JSON body starts a **live** run with that body as the trigger payload;
  deployments can be paused, deleted, and test-fired from the Deploy panel.
- Failed-node errors now surface the real cause instead of Temporal's wrapper.

## Milestone 4 — live run streaming (done)

Runs no longer block. `POST …/runs` returns a `runId` immediately; the engine
workflow exposes its per-node state through a Temporal query, and
`GET /api/runs/:id/stream` (Server-Sent Events) relays it. The canvas lights up
node-by-node as the engine executes — the active node pulses, finished nodes go
green/red, edges animate — and the final run is persisted in the background
whether or not anyone is watching. Opening a stream for a finished run replays
the stored result.

## Milestone 5 — model routing + scheduled triggers (done)

- **Model routing** (Phase 2 "Model Selection") — a heuristic complexity router
  scores the compile request (length, conditionals, step count, integrations,
  reasoning verbs) and picks a tier → model: `fast` (Haiku), `balanced` (Sonnet),
  `deep` (Opus). The compiler also assigns each `llm` node a tier, editable in
  the inspector; tiers map to concrete models via env so graphs stay model-free.
- **Scheduled triggers** (Phase 4 "background service") — a workflow can run on a
  cron schedule. `POST /api/workflows/:id/schedule` snapshots the graph; the API's
  in-process scheduler fires due schedules as `trigger=schedule` live runs with a
  `{ scheduledFor, cron }` payload. Pause / resume / delete from the Deploy panel,
  with cron presets and the browser's timezone.

## Expansion #4 — conditional branching & parallel paths (done)

The engine is no longer linear:

- Every node whose inputs are ready runs **in parallel** (each is its own
  Temporal activity), so independent steps fan out.
- A **`branch` node** evaluates a JS condition; its outgoing edges carry a
  `"true"` / `"false"` handle and only the taken side stays live. The other
  side's descendants are skipped, and skips propagate.
- Merge nodes use an **OR-join** — they run as soon as any one live path
  reaches them, with the merged outputs of whichever upstreams completed.

## Expansion #1 — Human-in-the-Loop approvals (done)

An **`approval` node** pauses the run before a sensitive step. When the engine
reaches it the workflow blocks on a Temporal signal and the node shows as
`awaiting` in the run panel with the (templated) approval message and
Approve / Reject buttons. `POST /api/runs/:id/approve` signals the decision;
approve resumes the workflow, reject fails the node and skips everything
downstream. The run stays open (no polling cost beyond the progress stream)
until a decision arrives.

## Expansion #5 — version control & rollbacks (done)

Every workflow keeps an append-only list of graph **snapshots**. One is written
on compile, on an explicit "Save version", on deploy, and before each run —
deduped by a position-independent signature so unchanged graphs don't pile up.
The **History** tab lists them with source and timestamp; "Restore" rolls the
working graph back to that version (snapshotting the current state first, so the
rollback is itself reversible).

## Expansion #7 — analytics dashboard (done)

A **Builder / Analytics** toggle in the top bar. The Analytics view aggregates
every run and node execution: stat tiles (runs, success rate, avg run time, node
executions), a 14-day stacked runs-over-time chart, a per-node-kind performance
table (count, success rate, p50/p95 latency), a failures-by-node bar chart, and a
recent-runs table. `node_runs` now carries the node `kind` for grouping.

## Expansion #2 — AI self-healing (done)

Per-workflow **Self-heal** toggle (top bar). When on, a node that fails after its
Temporal retries is sent — its kind, config, the error, and the input it
received — to the model, which returns a corrected config. The engine applies it
and retries the node once; a heal that works shows as `succeeded` with a
`self-healed` badge and a was → now config diff in the run panel, a heal that
doesn't leaves the node failed with the reason logged. Healable kinds:
`http_request`, `slack_post`, `llm`, `transform`, `branch`. Needs `ANTHROPIC_API_KEY`.

## Loop / iterator node (done)

A **`loop` node** maps a per-item JS expression over an array from upstream:
`items` resolves to the array, `expression` runs once per element with `item`,
`index`, and `input` in scope, and the output is `{ results, count }` for
downstream nodes to aggregate.

## Expansion #9 & #10 — sandboxed code + 2D asset nodes (done)

- **`code` node** runs a multi-line JS function body in a separate `worker_threads`
  Worker with its own globals, a memory cap, and a hard timeout (the thread is
  terminated on overrun). `input` is in scope; `return` a value.
- **`asset` node** generates and minifies an SVG (card / badge / banner) from a
  templated title, subtitle, and accent colour; output carries `svg`, a base64
  `dataUri`, and dimensions, and the run panel previews the image inline.

## Expansion #8 — community template marketplace (done)

A third **Templates** view. `templates` table + routes: browse, `POST` publishes
the current workflow (button in the Builder toolbar), `POST …/clone` forks a
template into a fresh workflow and drops you back in the Builder, delete for
community entries. Three built-in templates are seeded on first boot.

## Status

Blueprint core (4 phases) + Expansion #4, #1, #5, #7, #2, #8, #9, #10, plus a
loop/iterator node. Remaining Expansion features: #3 OpenAPI ingestion, #6 local
execution node.
