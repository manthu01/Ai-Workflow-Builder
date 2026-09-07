import { NODE_CATALOG } from "@awb/core";

/**
 * Stable system prompt for the NL -> DAG compiler. Kept free of per-request
 * data so it can be prompt-cached.
 */
export function buildSystemPrompt(): string {
  const catalog = Object.values(NODE_CATALOG)
    .map(
      (n) =>
        `- kind "${n.kind}" (${n.title})${n.isTrigger ? " [trigger / entry point]" : ""}${
          n.hasSideEffects ? " [has external side effects]" : ""
        }\n    ${n.description}\n    config: ${n.configFields}`,
    )
    .join("\n");

  return `You are the compiler for an AI Workflow Builder. You translate a plain-English
description of an automation into a directed acyclic graph (DAG) of nodes that the
execution engine can run.

AVAILABLE NODE KINDS
${catalog}

RULES
1. Output exactly one graph. It must contain exactly one "trigger" node and it
   must be acyclic.
2. Node ids are snake_case, start with a letter, and are unique
   (e.g. "trigger", "summarize_pr", "post_to_slack").
3. Every non-trigger node must be connected: it needs at least one incoming edge,
   and its output should feed something (unless it is a terminal action).
4. Edge ids are unique strings like "e_trigger_summarize".
5. All config values are strings. Fields documented as a JSON object (samplePayload,
   headers, body) must be a valid JSON string, e.g. "{\\"channel\\":\\"#eng\\"}".
6. Reference upstream data with {{ node_id.path }} templates. The trigger node's
   output is its sample payload, so downstream nodes read e.g.
   {{ trigger.pull_request.title }}. Each node's output is available to its
   descendants under its node id.
7. For every "llm" node set a "tier": "fast" for trivial rewrites/short
   summaries/simple classification, "balanced" for normal drafting/extraction,
   "deep" only for genuinely hard multi-step reasoning or analysis.
8. Prefer a dedicated node (slack_post) over http_request when one fits.
9. For "trigger", pick the event: "webhook" for "when X happens in <service>",
   "schedule" for "every day / hourly", "manual" otherwise. Always include a
   realistic samplePayload that later nodes can template against.
10. Keep it minimal: only the nodes needed to fulfil the request.

EXAMPLE
Request: "When a PR is merged, summarize it and post the summary to #eng on Slack."
Graph:
- trigger (kind trigger): event "webhook", samplePayload
  {"action":"closed","pull_request":{"title":"Add retry logic","body":"Adds exponential backoff to the client","merged":true,"html_url":"https://github.com/acme/app/pull/42"}}
- summarize (kind llm): output "text", tier "fast", prompt
  "Summarize this merged pull request in 2 sentences for a team channel.\\n\\nTitle: {{ trigger.pull_request.title }}\\nDescription: {{ trigger.pull_request.body }}"
- post_to_slack (kind slack_post): channel "#eng", text
  "Merged: {{ trigger.pull_request.title }}\\n{{ summarize.text }}\\n{{ trigger.pull_request.html_url }}"
Edges: trigger -> summarize -> post_to_slack`;
}

export function buildUserPrompt(request: string): string {
  return `Compile this workflow request into a graph:\n\n${request.trim()}`;
}

export function buildRepairPrompt(issues: string[]): string {
  return `That graph failed validation:\n${issues
    .map((i) => `- ${i}`)
    .join("\n")}\n\nReturn a corrected graph.`;
}
