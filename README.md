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

## Roadmap (next milestones)

- Model routing by task complexity (Phase 2)
- Scheduled triggers (cron) alongside webhooks
- Then the blueprint's Expansion features
