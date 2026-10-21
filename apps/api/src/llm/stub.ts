import type { CompilerGraph } from "../compiler/schema.js";
import type {
  CompileAttemptContext,
  CompilerDraft,
  CompilerKnowledgeBase,
  WorkflowCompilerProvider,
} from "./provider.js";

const DOCS_INTENT =
  /\b(docs?|documents?|documentation|polic(y|ies)|handbook|knowledge ?base|kb|faq|manuals?|guidelines?|wiki)\b/;
const SCHEDULE_INTENT =
  /\b(every|daily|hourly|weekly|nightly|each (morning|day|night|week|hour|monday|tuesday|wednesday|thursday|friday)|at \d{1,2}(:\d\d)? ?(am|pm))\b/;
const WEBHOOK_INTENT =
  /\b(webhook|arrives?|comes? in|incoming|is (created|opened|submitted)|submission|pull request|github|new (issue|order|signup|lead))\b/;
const LLM_INTENT =
  /\b(llm|ai|model|summari[sz]e|summary|classify|translate|draft|write|rewrite|sentiment|extract|decide|answer|rate|score|combine|report|reply)\b/;
const APPROVAL_INTENT =
  /\b(approv\w*|ask me|wait for (my|a|the|human|legal|manager)\b|sign[- ]?off|human review)/;
const LOOP_INTENT = /\b(for (each|every)|each (item|order|ticket|string|entry|row|product|record|user))\b/;
const PARALLEL_INTENT = /\b(in parallel|at the same time|simultaneously|concurrently)\b/;
const NOTHING_INTENT = /\b(do nothing|drop it|ignore it|skip it|nothing else)\b/;
const SINK_VERB = /\b(post|posting|send|sending|forward|log|page|submit|push|deliver)\b[^.;]*$/;

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

interface Url {
  url: string;
  at: number;
  /** A destination (POST) rather than a source to read from (GET). */
  sink: boolean;
}

function findUrls(text: string): Url[] {
  return [...text.matchAll(/https?:\/\/[^\s,;)"']+/g)].map((m) => {
    const url = m[0].replace(/[.]+$/, "");
    const before = text.slice(Math.max(0, m.index! - 40), m.index!);
    return { url, at: m.index!, sink: /\bto\s*$/.test(before) || SINK_VERB.test(before) };
  });
}

const channelsIn = (text: string) => [...new Set(text.match(/#[a-z0-9_-]+/g) ?? [])];
const slackIn = (text: string) =>
  channelsIn(text).length ? channelsIn(text) : /\bslack\b/.test(text) ? ["#general"] : [];

/** snake_case id from a URL's host and path, e.g. "weather_today". */
function idFromUrl(url: string): string {
  const { hostname, pathname } = new URL(url);
  const words = [hostname.split(".")[0]!, ...pathname.split("/")]
    .map((w) => w.toLowerCase().replace(/[^a-z0-9]+/g, "_"))
    .filter((w) => w && !["api", "www", "v1", "v2"].includes(w));
  return words.slice(-2).join("_") || "endpoint";
}

const sentence = (s: string) => {
  const t = s.trim().replace(/^[,;:\s]+|[,;:.\s]+$/g, "");
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/**
 * Builds the graph node by node. Each step records the "frontier" (the nodes
 * the next step hangs off) and the template reference holding the latest
 * content, so later nodes can say {{ that.text }}.
 */
class Builder {
  nodes: CompilerGraph["nodes"] = [];
  edges: CompilerGraph["edges"] = [];
  private used = new Set<string>();

  id(base: string): string {
    const clean = base.replace(/[^a-z0-9_]/g, "_").replace(/^[^a-z]+/, "") || "step";
    let id = clean;
    for (let i = 2; this.used.has(id); i++) id = `${clean}_${i}`;
    this.used.add(id);
    return id;
  }

  add(base: string, kind: CompilerGraph["nodes"][number]["kind"], label: string, config: Record<string, string>) {
    const id = this.id(base);
    this.nodes.push({ id, kind, label, config });
    return id;
  }

  link(from: string[], to: string, handle = "") {
    for (const source of from) {
      this.edges.push({ id: `e_${source}_${to}${handle ? `_${handle}` : ""}`, source, target: to, sourceHandle: handle });
    }
  }
}

/** A branch condition as a JS expression over `input` (all upstream outputs by node id). */
function branchExpression(cond: string, llm: string | undefined, source: string | undefined): string {
  const content = llm ? `input.${llm}?.text ?? JSON.stringify(input.${llm}?.json)` : "JSON.stringify(input)";
  const threshold = cond.match(/\b(amount|total|price|value|score|count)\b[^0-9]*(over|above|greater than|more than|exceeds|under|below|less than)\s*\$?(\d[\d,]*)/);
  if (threshold) {
    const [, field, op, n] = threshold;
    const holder = llm ? `input.${llm}?.json?.${field} ?? input.trigger?.${field}` : `input.trigger?.${field}`;
    const cmp = /under|below|less/.test(op!) ? "<" : ">";
    return `Number(${holder}) ${cmp} ${n!.replace(/,/g, "")}`;
  }
  if (/confiden|grounded|not sure|unsure|can'?t answer/.test(cond) && llm) return `input.${llm}?.grounded === false`;
  if (/merged/.test(cond)) return "input.trigger?.pull_request?.merged === true";
  if (/\bdown\b|fail|error|outage/.test(cond)) {
    return `/down|fail|error/i.test(JSON.stringify(input.${source ?? "trigger"}))`;
  }
  const word = cond.match(/\b(negative|positive|spam|urgent|angry|bug|refund)\b/)?.[1];
  if (word) return `String(${content}).toLowerCase().includes("${word}")`;
  return `/* ${cond.replace(/\*\//g, "")} */ true`;
}

/**
 * Deterministic, offline compiler: no model call, so it costs nothing and runs
 * anywhere (the public demo uses it). It reads the request with keyword rules
 * rather than understanding it: trigger type, URLs to read from or send to,
 * knowledge bases, loops, LLM steps, one if/otherwise branch, approvals, Slack
 * channels and images. Requests outside those patterns get a plain
 * trigger -> llm graph. Set COMPILER_MODE=claude for the real compiler.
 */
export class StubCompilerProvider implements WorkflowCompilerProvider {
  readonly name = "stub";

  async generate(request: string, ctx?: CompileAttemptContext): Promise<CompilerDraft> {
    // No model call, so no token usage to report.
    return { graph: this.draft(request, ctx) };
  }

  private draft(request: string, ctx?: CompileAttemptContext): CompilerGraph {
    const r = request.toLowerCase().replace(/\s+/g, " ").trim();
    const b = new Builder();

    // Split "... if X, A; otherwise B" into the part before the branch and its two paths.
    const ifAt = r.search(/\bif\b/);
    const elseAt = ifAt >= 0 ? r.slice(ifAt).search(/\b(otherwise|else|if not)\b/) : -1;
    const before = ifAt >= 0 ? r.slice(0, ifAt) : r;
    const thenText = ifAt >= 0 ? r.slice(ifAt, elseAt >= 0 ? ifAt + elseAt : undefined) : "";
    const elseText = ifAt >= 0 && elseAt >= 0 ? r.slice(ifAt + elseAt) : "";
    const cond = thenText.match(/^if (.+?)(,|;| then | ask | send | post | alert | page | require | reply | forward |$)/)?.[1] ?? "";

    // --- trigger ---
    const isPr = /\bpr\b|pull request|merged/.test(r);
    const event = SCHEDULE_INTENT.test(r) ? "schedule" : WEBHOOK_INTENT.test(r) ? "webhook" : "manual";
    const kbs = ctx?.knowledgeBases ?? [];
    const kb = DOCS_INTENT.test(r) && kbs.length > 0 ? pickKnowledgeBase(r, kbs) : undefined;
    const sample: Record<string, unknown> = isPr
      ? {
          action: "closed",
          pull_request: {
            title: "Add retry logic to the API client",
            body: "Adds exponential backoff and jitter to all outbound calls.",
            merged: true,
            html_url: "https://github.com/acme/app/pull/42",
          },
        }
      : kb
        ? { question: "How many vacation days can I carry over?", user: "alex" }
        : { message: "hello world", source: event };
    // Give the sample payload any numeric field a condition mentions, so the branch can fire in a dry run.
    for (const field of new Set(r.match(/\b(amount|total|price|value)\b/g) ?? [])) sample[field] = 1250;
    if (LOOP_INTENT.test(r)) sample.items = [{ id: 1, title: "First", amount: 10 }, { id: 2, title: "Second", amount: 25 }];
    const trigger = b.add(
      "trigger",
      "trigger",
      isPr ? "PR merged" : kb ? "Question asked" : event === "schedule" ? "On schedule" : event === "webhook" ? "Webhook received" : "Manual trigger",
      { event, samplePayload: JSON.stringify(sample) },
    );
    let frontier = [trigger];
    let content = "{{ trigger }}";

    // --- sources, read in parallel: a knowledge base and/or URLs to fetch ---
    const urls = findUrls(r);
    const wantsApproval = APPROVAL_INTENT.test(r);
    const hasSink = urls.some((u) => u.sink) || slackIn(r).length > 0;
    // "Run X, but have someone approve it first": with nothing else to gate, the approval guards the last call.
    if (wantsApproval && !hasSink && urls.length) urls[urls.length - 1]!.sink = true;

    const sources: string[] = [];
    let retrieve: string | undefined;
    if (kb) {
      retrieve = b.add("search_docs", "retrieve", `Search ${kb.name}`, {
        kbId: kb.id,
        query: isPr ? "{{ trigger.pull_request.title }}" : "{{ trigger.question }}",
        topK: "5",
        mode: "hybrid",
        minScore: "0",
      });
      sources.push(retrieve);
    }
    for (const u of urls.filter((u) => !u.sink)) {
      sources.push(b.add(`fetch_${idFromUrl(u.url)}`, "http_request", `Fetch ${new URL(u.url).hostname}`, { method: "GET", url: u.url }));
    }
    if (sources.length) {
      for (const s of sources) b.link(frontier, s);
      frontier = sources;
      content = sources.length === 1 && !retrieve ? `{{ ${sources[0]}.body }}` : content;
    }

    // --- loop over a list ---
    if (LOOP_INTENT.test(r)) {
      const src = sources.find((s) => s !== retrieve);
      const items = src
        ? `Array.isArray(input.${src}.body) ? input.${src}.body : (input.${src}.body?.items ?? [])`
        : "input.trigger.items ?? []";
      const expression = /tax/.test(r)
        ? `({ ...item, total: Math.round(Number(item.amount ?? 0) * ${1 + Number(r.match(/(\d+)\s*%/)?.[1] ?? 20) / 100} * 100) / 100 })`
        : /trim|lowercase|clean/.test(r)
          ? "String(item).trim().toLowerCase()"
          : /\bid\b.*\btitle\b/.test(r)
            ? "({ id: item.id, title: item.title })"
            : "item";
      const loop = b.add("for_each", "loop", "For each item", { items, expression });
      b.link(frontier, loop);
      frontier = [loop];
      content = "{{ for_each.results }}";
    }

    // --- LLM steps (several in parallel when asked for, then combined) ---
    const tier = /\b(fast|cheap|quick)\b/.test(r) ? "fast" : "balanced";
    const output = /\bjson\b/.test(r) ? "json" : "text";
    const tasks = PARALLEL_INTENT.test(r)
      ? [...r.matchAll(/\bwrite (an? [a-z -]+?)(?=,| and |\.|;|$)/g)].map((m) => m[1]!)
      : [];
    let llm: string | undefined;
    if (tasks.length >= 2) {
      const writers = tasks.map((t) =>
        b.add(`write_${t.replace(/^an? /, "")}`, "llm", sentence(`write ${t}`), {
          prompt: `${sentence(`write ${t}`)} based on:\n\n${content}`,
          output: "text",
          tier,
        }),
      );
      for (const w of writers) b.link(frontier, w);
      const combine = b.add("combine", "transform", "Combine", {
        expression: `[${writers.map((w) => `input.${w}.text`).join(", ")}].join("\\n\\n")`,
      });
      b.link(writers, combine);
      frontier = [combine];
      content = "{{ combine }}";
    } else if (kb || (urls.length + slackIn(r).length === 0 && !/\b(banner|badge|card)\b/.test(r)) || LLM_INTENT.test(before) || (!cond && LLM_INTENT.test(r)) || (cond && LLM_INTENT.test(cond))) {
      const task = sentence(
        before.match(/\b((summari[sz]e|classify|translate|draft|write|rate|extract|answer|decide|combine)[^,.;]*)/)?.[1] ??
          (kb ? "answer the question" : "summarize this"),
      );
      llm = b.add(kb ? "answer" : "ai_step", "llm", kb ? "Answer with citations" : task.slice(0, 60), {
        prompt: kb
          ? "Answer the question using only the context below.\n\nContext:\n{{ search_docs.context }}\n\nQuestion: {{ trigger.question }}"
          : `${task}.\n\n${sources.length > 1 ? sources.map((s) => `${s}: {{ ${s}.body }}`).join("\n") : `Input:\n${content}`}`,
        output,
        tier,
        ...(kb ? { requireCitations: "true" } : {}),
      });
      b.link(frontier, llm);
      frontier = [llm];
      content = output === "json" ? `{{ ${llm}.json }}` : `{{ ${llm}.text }}`;
    }

    // --- images ---
    const assetKinds = (["banner", "badge", "card"] as const).filter((k) => new RegExp(`\\b${k}\\b`).test(r));
    if (assetKinds.length && /\b(image|generate|create|make)\b/.test(r)) {
      const title = request.match(/['"“]([^'"”]+)['"”]/)?.[1] ?? "Hello from AI Workflow Builder";
      const assets = assetKinds.map((k) => b.add(`${k}_image`, "asset", `Generate ${k}`, { template: k, title }));
      for (const a of assets) b.link(frontier, a);
      frontier = assets;
    }

    /** Adds a clause's side effects after `from`; returns the last nodes. */
    const sinksFor = (text: string, from: string[], handle = ""): string[] => {
      const out: string[] = [];
      for (const channel of slackIn(text)) {
        const id = b.add(`post_${channel.slice(1)}`, "slack_post", `Post to ${channel}`, {
          channel,
          text: isPr ? `Merged: {{ trigger.pull_request.title }}\n${content}` : content,
        });
        out.push(id);
      }
      for (const u of findUrls(text).filter((u) => urls.find((x) => x.url === u.url)?.sink)) {
        out.push(
          b.add(`send_${idFromUrl(u.url)}`, "http_request", `Send to ${new URL(u.url).hostname}`, {
            method: "POST",
            url: u.url,
            headers: JSON.stringify({ "content-type": "application/json" }),
            body: JSON.stringify({ data: content }),
          }),
        );
      }
      for (const id of out) b.link(from, id, handle);
      return out;
    };
    const approval = (from: string[], handle = "") => {
      const id = b.add("approval", "approval", "Wait for approval", {
        message: `Please review before it goes out:\n\n${content}`,
        approvers: "",
      });
      b.link(from, id, handle);
      return id;
    };

    if (cond) {
      // Side effects mentioned before the "if" happen on every run.
      sinksFor(before, frontier);
      const branch = b.add("branch", "branch", sentence(`if ${cond}`).slice(0, 60), {
        expression: branchExpression(cond, llm, sources.find((s) => s !== retrieve)),
      });
      b.link(frontier, branch);
      const paths: [string, string][] = [["true", thenText], ["false", elseText]];
      for (const [handle, text] of paths) {
        if (!text || NOTHING_INTENT.test(text)) continue;
        if (APPROVAL_INTENT.test(text)) {
          const gate = approval([branch], handle);
          // "if unsure ask me to approve, otherwise reply in Slack": once approved, do what the other path does.
          const own = sinksFor(text, [gate]);
          if (!own.length) sinksFor(handle === "true" ? elseText : thenText, [gate]);
        } else {
          sinksFor(text, [branch], handle);
        }
      }
    } else if (wantsApproval) {
      // Side effects named before the approval go out at once; the rest wait for it.
      const approvalAt = r.search(APPROVAL_INTENT);
      const preSinkText = r.slice(0, approvalAt);
      const sentBefore = slackIn(preSinkText).length > 0 && !/\bbefore\b/.test(r.slice(approvalAt - 30, approvalAt + 40));
      if (sentBefore) sinksFor(preSinkText, frontier);
      const gate = approval(frontier);
      sinksFor(sentBefore ? r.slice(approvalAt) : r, [gate]);
    } else {
      sinksFor(r, frontier);
    }

    return {
      name: sentence(request).slice(0, 60) || "Untitled workflow",
      description: `Compiled offline (stub, no AI) from: ${request.trim()}${kb ? ` (knowledge base: ${kb.name})` : ""}`,
      nodes: b.nodes,
      edges: b.edges,
    };
  }
}
