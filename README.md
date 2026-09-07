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

## Setup

Prereqs: Node 20+, Docker Desktop.

```bash
npm install
cp .env.example .env          # then add ANTHROPIC_API_KEY if you want the real compiler
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

## Roadmap (next milestones)

- Live run progress streaming (Temporal signals/queries → WebSocket) for a real-time debugger
- Editable canvas: add/remove/reconnect nodes, per-node config forms
- Real trigger sources (webhook listener) and deploy step (Phase 4 "Agent Deployment")
- Secret vault for `http_request` / `slack_post` credentials (Phase 3 "Secure Hub")
- Then the blueprint's Expansion features
