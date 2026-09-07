import {
  jsonb,
  pgTable,
  text,
  timestamp,
  integer,
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
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
    trigger: text("trigger", { enum: ["manual", "webhook"] }).notNull().default("manual"),
    deploymentId: text("deployment_id"),
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

export const nodeRuns = pgTable(
  "node_runs",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    nodeId: text("node_id").notNull(),
    status: text("status", {
      enum: ["pending", "running", "succeeded", "failed", "skipped"],
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
