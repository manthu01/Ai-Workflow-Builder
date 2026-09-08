import {
  jsonb,
  pgTable,
  text,
  timestamp,
  integer,
  boolean,
  index,
} from "drizzle-orm/pg-core";
import type { WorkflowGraph } from "@awb/core";

export const workflows = pgTable("workflows", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  /** The full node graph. Source of truth for the canvas and the engine. */
  graph: jsonb("graph").$type<WorkflowGraph>().notNull(),
  /** The natural-language prompt this workflow was compiled from, if any. */
  sourcePrompt: text("source_prompt"),
  /** Expansion #2: let the engine repair a failed node's config and retry once. */
  selfHeal: boolean("self_heal").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Immutable snapshots of a workflow's graph (Expansion #5). One is written on
 * compile, on an explicit save, on deploy, before a rollback, and lazily before
 * a run whose graph differs from the latest snapshot.
 */
export const workflowVersions = pgTable(
  "workflow_versions",
  {
    id: text("id").primaryKey(),
    workflowId: text("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    graph: jsonb("graph").$type<WorkflowGraph>().notNull(),
    label: text("label"),
    source: text("source", {
      enum: ["compile", "edit", "deploy", "run", "rollback"],
    }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("workflow_versions_wf_idx").on(t.workflowId)],
);

/** Expansion #3: an ingested OpenAPI spec, distilled to callable operations. */
export const apiBlueprints = pgTable("api_blueprints", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  baseUrl: text("base_url").notNull().default(""),
  operations: jsonb("operations")
    .$type<
      {
        operationId: string;
        method: string;
        path: string;
        summary: string;
        params: { name: string; in: string; required: boolean }[];
      }[]
    >()
    .notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Expansion #8: a published workflow others can browse and clone. */
export const templates = pgTable("templates", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  category: text("category").notNull().default("general"),
  graph: jsonb("graph").$type<WorkflowGraph>().notNull(),
  author: text("author").notNull().default("community"),
  builtIn: boolean("built_in").notNull().default(false),
  cloneCount: integer("clone_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const runs = pgTable(
  "runs",
  {
    id: text("id").primaryKey(),
    workflowId: text("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    mode: text("mode", { enum: ["dry", "live"] }).notNull(),
    /** How the run was started. */
    trigger: text("trigger", { enum: ["manual", "webhook", "schedule"] })
      .notNull()
      .default("manual"),
    deploymentId: text("deployment_id"),
    scheduleId: text("schedule_id"),
    status: text("status", { enum: ["running", "succeeded", "failed"] }).notNull(),
    temporalWorkflowId: text("temporal_workflow_id").notNull(),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("runs_workflow_idx").on(t.workflowId)],
);

/**
 * Stored credentials ("Secure Hub"). `secret` holds an AES-256-GCM encrypted
 * JSON blob; the plaintext never leaves the API process and is never returned
 * over the wire.
 */
export const connections = pgTable("connections", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  kind: text("kind", { enum: ["slack", "http_header"] }).notNull(),
  secret: text("secret").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A workflow compiled into a live webhook listener. `graphSnapshot` freezes the
 * graph as deployed so later edits don't silently change what fires.
 */
export const deployments = pgTable(
  "deployments",
  {
    id: text("id").primaryKey(),
    workflowId: text("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    status: text("status", { enum: ["active", "paused"] }).notNull().default("active"),
    graphSnapshot: jsonb("graph_snapshot").$type<WorkflowGraph>().notNull(),
    fireCount: integer("fire_count").notNull().default(0),
    lastFiredAt: timestamp("last_fired_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("deployments_workflow_idx").on(t.workflowId)],
);

/**
 * A workflow set to run on a cron schedule (the blueprint's "background service"
 * deployment form). The API's in-process scheduler fires these.
 */
export const schedules = pgTable(
  "schedules",
  {
    id: text("id").primaryKey(),
    workflowId: text("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    cron: text("cron").notNull(),
    timezone: text("timezone").notNull().default("UTC"),
    status: text("status", { enum: ["active", "paused"] }).notNull().default("active"),
    graphSnapshot: jsonb("graph_snapshot").$type<WorkflowGraph>().notNull(),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    runCount: integer("run_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("schedules_workflow_idx").on(t.workflowId)],
);

/** Expansion #6: work handed off to a local runner on the user's machine. */
export const localTasks = pgTable(
  "local_tasks",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull(),
    nodeId: text("node_id").notNull(),
    temporalWorkflowId: text("temporal_workflow_id").notNull(),
    command: text("command").notNull(),
    status: text("status", { enum: ["pending", "running", "done", "error"] })
      .notNull()
      .default("pending"),
    result: jsonb("result").$type<{
      stdout: string;
      stderr: string;
      exitCode: number;
    }>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("local_tasks_status_idx").on(t.status)],
);

export const nodeRuns = pgTable(
  "node_runs",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    nodeId: text("node_id").notNull(),
    kind: text("kind").notNull().default(""),
    status: text("status", {
      enum: ["pending", "running", "awaiting", "succeeded", "failed", "skipped"],
    }).notNull(),
    input: jsonb("input"),
    output: jsonb("output"),
    error: text("error"),
    logs: jsonb("logs").$type<string[]>().notNull().default([]),
    attempts: integer("attempts").notNull().default(1),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("node_runs_run_idx").on(t.runId)],
);
