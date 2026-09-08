import { sql } from "drizzle-orm";
import type { WorkflowGraph } from "@awb/core";
import { db, schema } from "./db/client.js";
import { autoLayoutSafe } from "./routes/_shared.js";
import { newId } from "./id.js";

const g = (graph: WorkflowGraph) => autoLayoutSafe(graph);

const BUILT_IN: {
  name: string;
  description: string;
  category: string;
  graph: WorkflowGraph;
}[] = [
  {
    name: "PR merged → Slack summary",
    description: "When a PR is merged, summarize it and post to a Slack channel.",
    category: "dev",
    graph: g({
      name: "PR merged → Slack summary",
      nodes: [
        {
          id: "trigger",
          kind: "trigger",
          label: "PR merged",
          config: {
            event: "webhook",
            samplePayload: JSON.stringify({
              pull_request: {
                title: "Add retry logic",
                body: "Adds exponential backoff",
                html_url: "https://github.com/acme/app/pull/42",
              },
            }),
          },
          position: { x: 0, y: 0 },
        },
        {
          id: "summarize",
          kind: "llm",
          label: "Summarize",
          config: {
            output: "text",
            tier: "fast",
            prompt:
              "Summarize this merged PR in 2 sentences.\n\nTitle: {{ trigger.pull_request.title }}\nBody: {{ trigger.pull_request.body }}",
          },
          position: { x: 0, y: 0 },
        },
        {
          id: "post_to_slack",
          kind: "slack_post",
          label: "Post to Slack",
          config: {
            channel: "#eng",
            text: "Merged: {{ trigger.pull_request.title }}\n{{ summarize.text }}\n{{ trigger.pull_request.html_url }}",
          },
          position: { x: 0, y: 0 },
        },
      ],
      edges: [
        { id: "e1", source: "trigger", target: "summarize", sourceHandle: "" },
        { id: "e2", source: "summarize", target: "post_to_slack", sourceHandle: "" },
      ],
    }),
  },
  {
    name: "High-value order → approval → fulfil",
    description:
      "Branch on order value; large orders wait for a human approval before fulfilment.",
    category: "ops",
    graph: g({
      name: "High-value order → approval → fulfil",
      nodes: [
        {
          id: "trigger",
          kind: "trigger",
          label: "New order",
          config: {
            event: "webhook",
            samplePayload: JSON.stringify({ id: "ord_1", amount: 900, email: "jo@acme.com" }),
          },
          position: { x: 0, y: 0 },
        },
        {
          id: "big",
          kind: "branch",
          label: "Over $500?",
          config: { expression: "input.trigger.amount > 500" },
          position: { x: 0, y: 0 },
        },
        {
          id: "gate",
          kind: "approval",
          label: "Approve order",
          config: {
            message: "Approve fulfilment of order {{ trigger.id }} (${{ trigger.amount }})?",
            approvers: "ops",
          },
          position: { x: 0, y: 0 },
        },
        {
          id: "fulfil",
          kind: "transform",
          label: "Fulfil",
          config: { expression: "{ fulfilled: input.trigger.id }" },
          position: { x: 0, y: 0 },
        },
      ],
      edges: [
        { id: "e1", source: "trigger", target: "big", sourceHandle: "" },
        { id: "e2", source: "big", target: "gate", sourceHandle: "true" },
        { id: "e3", source: "big", target: "fulfil", sourceHandle: "false" },
        { id: "e4", source: "gate", target: "fulfil", sourceHandle: "" },
      ],
    }),
  },
  {
    name: "Daily incident digest",
    description: "Every morning, fetch open incidents and post a formatted digest.",
    category: "ops",
    graph: g({
      name: "Daily incident digest",
      nodes: [
        {
          id: "trigger",
          kind: "trigger",
          label: "Every day 9am",
          config: { event: "schedule", samplePayload: "{}" },
          position: { x: 0, y: 0 },
        },
        {
          id: "fetch",
          kind: "http_request",
          label: "Fetch incidents",
          config: {
            method: "GET",
            url: "https://api.example.com/incidents?status=open",
            headers: "{}",
            body: "{}",
            connectionId: "",
          },
          position: { x: 0, y: 0 },
        },
        {
          id: "format",
          kind: "loop",
          label: "Format each",
          config: {
            items: "input.fetch.body.incidents || []",
            expression: "`• ${item.title} (${item.severity})`",
          },
          position: { x: 0, y: 0 },
        },
        {
          id: "digest",
          kind: "slack_post",
          label: "Post digest",
          config: { channel: "#ops", text: "Open incidents:\n{{ format.results }}" },
          position: { x: 0, y: 0 },
        },
      ],
      edges: [
        { id: "e1", source: "trigger", target: "fetch", sourceHandle: "" },
        { id: "e2", source: "fetch", target: "format", sourceHandle: "" },
        { id: "e3", source: "format", target: "digest", sourceHandle: "" },
      ],
    }),
  },
];

/** Insert the built-in templates once (skips any that already exist by name). */
export async function seedTemplates(): Promise<void> {
  try {
    const existing = await db
      .select({ name: schema.templates.name })
      .from(schema.templates)
      .where(sql`${schema.templates.builtIn} = true`);
    const have = new Set(existing.map((r) => r.name));
    const toAdd = BUILT_IN.filter((t) => !have.has(t.name));
    if (toAdd.length === 0) return;
    await db.insert(schema.templates).values(
      toAdd.map((t) => ({
        id: newId("tpl"),
        name: t.name,
        description: t.description,
        category: t.category,
        graph: t.graph,
        author: "built-in",
        builtIn: true,
      })),
    );
    console.log(`[seed] added ${toAdd.length} built-in templates`);
  } catch (err) {
    console.error("[seed] template seed failed", err);
  }
}
