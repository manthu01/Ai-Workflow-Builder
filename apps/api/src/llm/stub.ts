import type { CompilerGraph } from "../compiler/schema.js";
import type {
  CompileAttemptContext,
  CompilerKnowledgeBase,
  WorkflowCompilerProvider,
} from "./provider.js";

const DOCS_INTENT =
  /\b(docs?|documents?|documentation|polic(y|ies)|handbook|knowledge ?base|kb|faq|manuals?|guidelines?|wiki)\b/;

/** The KB whose name/description shares the most words with the request (ties: most recent). */
function pickKnowledgeBase(r: string, kbs: CompilerKnowledgeBase[]): CompilerKnowledgeBase {
  const words = new Set(r.split(/[^a-z0-9]+/).filter((w) => w.length > 2));
  const overlap = (kb: CompilerKnowledgeBase) =>
    `${kb.name} ${kb.description}`
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => words.has(w)).length;
  return kbs.reduce((best, kb) => (overlap(kb) > overlap(best) ? kb : best), kbs[0]!);
}

/**
 * Deterministic, offline compiler. Not smart - it keyword-matches - but it lets
 * the canvas, engine, and dry-run path be built and demoed without API spend.
 * Set COMPILER_MODE=claude for the real thing.
 */
export class StubCompilerProvider implements WorkflowCompilerProvider {
  readonly name = "stub";

  async generate(request: string, ctx?: CompileAttemptContext): Promise<CompilerGraph> {
    const r = request.toLowerCase();
    const wantsSlack = /slack|#[a-z]/.test(r);
    const kbs = ctx?.knowledgeBases ?? [];
    if (DOCS_INTENT.test(r) && kbs.length > 0) {
      return this.documentQa(request, pickKnowledgeBase(r, kbs), wantsSlack, r);
    }
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
    edges.push({
      id: "e_trigger_summarize",
      source: "trigger",
      target: "summarize",
      sourceHandle: "",
    });

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
        sourceHandle: "",
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
      edges.push({
        id: "e_summarize_api",
        source: "summarize",
        target: "call_api",
        sourceHandle: "",
      });
    }

    return {
      name: request.trim().slice(0, 60) || "Untitled workflow",
      description: `Stub-compiled from: ${request.trim()}`,
      nodes,
      edges,
    };
  }

  /** trigger -> retrieve -> llm (cited answer) [-> slack_post] */
  private documentQa(
    request: string,
    kb: CompilerKnowledgeBase,
    wantsSlack: boolean,
    r: string,
  ): CompilerGraph {
    const nodes: CompilerGraph["nodes"] = [
      {
        id: "trigger",
        kind: "trigger",
        label: "Question asked",
        config: {
          event: "webhook",
          samplePayload: JSON.stringify({
            question: "How many vacation days can I carry over?",
            user: "alex",
          }),
        },
      },
      {
        id: "search_docs",
        kind: "retrieve",
        label: `Search ${kb.name}`,
        config: { kbId: kb.id, query: "{{ trigger.question }}", topK: "5", mode: "hybrid", minScore: "0" },
      },
      {
        id: "answer",
        kind: "llm",
        label: "Answer with citations",
        config: {
          output: "text",
          tier: "balanced",
          requireCitations: "true",
          prompt:
            "Answer the question using only the context below.\n\nContext:\n{{ search_docs.context }}\n\nQuestion: {{ trigger.question }}",
        },
      },
    ];
    const edges: CompilerGraph["edges"] = [
      { id: "e_trigger_search", source: "trigger", target: "search_docs", sourceHandle: "" },
      { id: "e_search_answer", source: "search_docs", target: "answer", sourceHandle: "" },
    ];
    if (wantsSlack) {
      nodes.push({
        id: "post_to_slack",
        kind: "slack_post",
        label: "Reply in Slack",
        config: { channel: r.match(/#([a-z0-9_-]+)/)?.[0] ?? "#general", text: "{{ answer.text }}" },
      });
      edges.push({ id: "e_answer_slack", source: "answer", target: "post_to_slack", sourceHandle: "" });
    }
    return {
      name: request.trim().slice(0, 60) || "Answer from documents",
      description: `Stub-compiled from: ${request.trim()} (knowledge base: ${kb.name})`,
      nodes,
      edges,
    };
  }
}
