import type { CompilerGraph } from "../compiler/schema.js";
import type { WorkflowCompilerProvider } from "./provider.js";

/**
 * Deterministic, offline compiler. Not smart - it keyword-matches - but it lets
 * the canvas, engine, and dry-run path be built and demoed without API spend.
 * Set COMPILER_MODE=claude for the real thing.
 */
export class StubCompilerProvider implements WorkflowCompilerProvider {
  readonly name = "stub";

  async generate(request: string): Promise<CompilerGraph> {
    const r = request.toLowerCase();
    const wantsSlack = /slack|#[a-z]/.test(r);
    const wantsPr = /\bpr\b|pull request|merged/.test(r);
    const wantsHttp = /\bapi\b|http|webhook|endpoint|post to (?!slack)/.test(r);

    const nodes: CompilerGraph["nodes"] = [];
    const edges: CompilerGraph["edges"] = [];

    const samplePayload = wantsPr
      ? JSON.stringify({
          action: "closed",
          pull_request: {
            title: "Add retry logic to the API client",
            body: "Adds exponential backoff and jitter to all outbound calls.",
            merged: true,
            html_url: "https://github.com/acme/app/pull/42",
          },
        })
      : JSON.stringify({ message: "hello world", source: "manual" });

    nodes.push({
      id: "trigger",
      kind: "trigger",
      label: wantsPr ? "PR merged" : "Manual trigger",
      config: {
        event: wantsPr || wantsHttp ? "webhook" : "manual",
        samplePayload,
      },
    });

    nodes.push({
      id: "summarize",
      kind: "llm",
      label: "Summarize",
      config: {
        output: "text",
        tier: "fast",
        prompt: wantsPr
          ? "Summarize this merged pull request in 2 sentences for a team channel.\n\nTitle: {{ trigger.pull_request.title }}\nDescription: {{ trigger.pull_request.body }}"
          : "Summarize the following in one sentence:\n\n{{ trigger.message }}",
      },
    });
    edges.push({ id: "e_trigger_summarize", source: "trigger", target: "summarize" });

    if (wantsSlack) {
      nodes.push({
        id: "post_to_slack",
        kind: "slack_post",
        label: "Post to Slack",
        config: {
          channel: (r.match(/#([a-z0-9_-]+)/)?.[0] ?? "#general"),
          text: wantsPr
            ? "Merged: {{ trigger.pull_request.title }}\n{{ summarize.text }}\n{{ trigger.pull_request.html_url }}"
            : "{{ summarize.text }}",
        },
      });
      edges.push({
        id: "e_summarize_slack",
        source: "summarize",
        target: "post_to_slack",
      });
    } else if (wantsHttp) {
      nodes.push({
        id: "call_api",
        kind: "http_request",
        label: "Call API",
        config: {
          method: "POST",
          url: "https://example.com/webhook",
          headers: JSON.stringify({ "content-type": "application/json" }),
          body: JSON.stringify({ summary: "{{ summarize.text }}" }),
        },
      });
      edges.push({ id: "e_summarize_api", source: "summarize", target: "call_api" });
    }

    return {
      name: request.trim().slice(0, 60) || "Untitled workflow",
      description: `Stub-compiled from: ${request.trim()}`,
      nodes,
      edges,
    };
  }
}
