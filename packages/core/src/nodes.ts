import { z } from "zod";

/**
 * The set of node kinds the compiler can emit and the engine can execute in
 * milestone 1. Every kind has a config schema (validated on save and before a
 * run) and a catalog entry (fed to the compiler prompt and the canvas palette).
 */
export const NODE_KINDS = [
  "trigger",
  "llm",
  "http_request",
  "transform",
  "branch",
  "loop",
  "approval",
  "slack_post",
] as const;

export type NodeKind = (typeof NODE_KINDS)[number];

export const TriggerConfig = z.object({
  /** How the deployed workflow will be invoked. */
  event: z.enum(["webhook", "manual", "schedule"]),
  /**
   * A JSON object (encoded as a string) representing an example trigger
   * payload. Dry runs feed this into the graph as the trigger node's output.
   */
  samplePayload: z.string().default("{}"),
});

/**
 * Complexity tiers the compiler assigns to LLM steps; each maps to a concrete
 * model at execution time (configurable via env). Keeps graphs free of specific
 * model ids.
 */
export const MODEL_TIERS = ["fast", "balanced", "deep"] as const;
export type ModelTier = (typeof MODEL_TIERS)[number];

export const LlmConfig = z.object({
  /** Prompt text. May contain {{ node_id.path }} references to upstream output. */
  prompt: z.string().min(1),
  /** "text" returns a string, "json" asks the model for a JSON object. */
  output: z.enum(["text", "json"]).default("text"),
  /** Which model tier to route this step to. */
  tier: z.enum(MODEL_TIERS).default("balanced"),
  /** Explicit model id; overrides the tier when set. */
  model: z.string().default(""),
});

export const HttpRequestConfig = z.object({
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("GET"),
  /** Target URL. Templated. */
  url: z.string().min(1),
  /** JSON object (string-encoded) of request headers. Templated. */
  headers: z.string().default("{}"),
  /** JSON object (string-encoded) request body for non-GET requests. Templated. */
  body: z.string().default("{}"),
  /** Optional connection id (kind "http_header") to inject an auth header on live runs. */
  connectionId: z.string().default(""),
});

export const TransformConfig = z.object({
  /**
   * A single JavaScript expression evaluated in a sandbox with `input` bound to
   * the merged upstream outputs. e.g. `{ title: input.trigger.pr.title.trim() }`
   */
  expression: z.string().min(1),
});

export const BranchConfig = z.object({
  /**
   * A JavaScript expression evaluated against `input` (merged upstream outputs).
   * A truthy result activates the "true" edges, falsy activates the "false"
   * edges; the other branch's downstream nodes are skipped.
   */
  expression: z.string().min(1),
});

export const LoopConfig = z.object({
  /** JS expression against `input` that must evaluate to an array. */
  items: z.string().min(1),
  /**
   * JS expression run once per element, with `item`, `index`, and `input` in
   * scope. The node's output is `{ results: [...], count }`.
   */
  expression: z.string().min(1),
});

export const ApprovalConfig = z.object({
  /** Message shown to the approver. May contain {{ node_id.field }} templates. */
  message: z.string().min(1),
  /** Free-text note about who should approve (informational only). */
  approvers: z.string().default(""),
});

export const SlackPostConfig = z.object({
  /** Channel name or id, e.g. "#eng" or "C0123". Templated. */
  channel: z.string().min(1),
  /** Message body. Templated. */
  text: z.string().min(1),
  /** Optional connection id (kind "slack") holding the bot token for live runs. */
  connectionId: z.string().default(""),
});

export const NODE_CONFIG_SCHEMAS = {
  trigger: TriggerConfig,
  llm: LlmConfig,
  http_request: HttpRequestConfig,
  transform: TransformConfig,
  branch: BranchConfig,
  loop: LoopConfig,
  approval: ApprovalConfig,
  slack_post: SlackPostConfig,
} satisfies Record<NodeKind, z.ZodTypeAny>;

export type NodeConfigFor<K extends NodeKind> = z.infer<
  (typeof NODE_CONFIG_SCHEMAS)[K]
>;

/** How the canvas should render an editor for one config field. */
export interface NodeFieldSpec {
  key: string;
  label: string;
  widget: "text" | "textarea" | "select" | "json" | "connection";
  options?: string[];
  /** For widget "connection": which connection kind to offer. */
  connectionKind?: "slack" | "http_header";
  placeholder?: string;
  help?: string;
  default: string;
  optional?: boolean;
}

export interface NodeCatalogEntry {
  kind: NodeKind;
  title: string;
  description: string;
  /** Whether this kind starts a workflow (has no inputs). */
  isTrigger: boolean;
  /** Whether executing this kind can cause an external side effect. */
  hasSideEffects: boolean;
  /** Human-readable summary of the config fields for the compiler prompt. */
  configFields: string;
  /** Structured field list the canvas uses to build the config form. */
  fields: NodeFieldSpec[];
}

export const NODE_CATALOG: Record<NodeKind, NodeCatalogEntry> = {
  trigger: {
    kind: "trigger",
    title: "Trigger",
    description:
      "Entry point. Fires the workflow from a webhook, a manual run, or a schedule.",
    isTrigger: true,
    hasSideEffects: false,
    configFields:
      'event: "webhook" | "manual" | "schedule"; samplePayload: string (JSON object literal used as example input for dry runs)',
    fields: [
      {
        key: "event",
        label: "Event",
        widget: "select",
        options: ["webhook", "manual", "schedule"],
        default: "manual",
      },
      {
        key: "samplePayload",
        label: "Sample payload (JSON)",
        widget: "json",
        default: "{}",
        help: "Fed into the graph as this node's output during dry runs.",
      },
    ],
  },
  llm: {
    kind: "llm",
    title: "LLM Step",
    description:
      "Calls a language model with a templated prompt. Use for summarizing, drafting, classifying, or extracting structured data.",
    isTrigger: false,
    hasSideEffects: false,
    configFields:
      'prompt: string (supports {{ node_id.field }} templates); output: "text" | "json"',
    fields: [
      {
        key: "prompt",
        label: "Prompt",
        widget: "textarea",
        default: "",
        placeholder: "Summarize {{ trigger.message }} in one sentence.",
        help: "Use {{ node_id.field }} to reference upstream output.",
      },
      {
        key: "output",
        label: "Output",
        widget: "select",
        options: ["text", "json"],
        default: "text",
      },
      {
        key: "tier",
        label: "Model tier",
        widget: "select",
        options: ["fast", "balanced", "deep"],
        default: "balanced",
        help: "fast = cheap/simple, balanced = default, deep = hard reasoning.",
      },
    ],
  },
  http_request: {
    kind: "http_request",
    title: "HTTP Request",
    description:
      "Calls an external HTTP API. Use for any integration without a dedicated node.",
    isTrigger: false,
    hasSideEffects: true,
    configFields:
      "method: GET|POST|PUT|PATCH|DELETE; url: string; headers: string (JSON object); body: string (JSON object). All templated.",
    fields: [
      {
        key: "method",
        label: "Method",
        widget: "select",
        options: ["GET", "POST", "PUT", "PATCH", "DELETE"],
        default: "GET",
      },
      { key: "url", label: "URL", widget: "text", default: "", placeholder: "https://api.example.com/things" },
      { key: "headers", label: "Headers (JSON)", widget: "json", default: "{}" },
      { key: "body", label: "Body (JSON)", widget: "json", default: "{}" },
      {
        key: "connectionId",
        label: "Auth connection",
        widget: "connection",
        connectionKind: "http_header",
        default: "",
        optional: true,
        help: "Injects a stored auth header on live runs.",
      },
    ],
  },
  transform: {
    kind: "transform",
    title: "Transform",
    description:
      "Reshapes data between steps with a single JavaScript expression. No side effects.",
    isTrigger: false,
    hasSideEffects: false,
    configFields:
      "expression: string (one JS expression; `input` is bound to the merged upstream outputs)",
    fields: [
      {
        key: "expression",
        label: "Expression",
        widget: "textarea",
        default: "input",
        placeholder: "{ title: input.trigger.pull_request.title }",
        help: "One JS expression. `input` is the merged upstream outputs.",
      },
    ],
  },
  branch: {
    kind: "branch",
    title: "Branch (if / else)",
    description:
      "Evaluates a condition and routes the workflow down its 'true' or 'false' path. Use for non-linear logic.",
    isTrigger: false,
    hasSideEffects: false,
    configFields:
      "expression: string (JS boolean expression against `input`; true -> true edges, false -> false edges)",
    fields: [
      {
        key: "expression",
        label: "Condition",
        widget: "textarea",
        default: "true",
        placeholder: "input.trigger.pull_request.merged === true",
        help: "JS expression. Truthy takes the 'true' path, falsy the 'false' path.",
      },
    ],
  },
  loop: {
    kind: "loop",
    title: "Loop (map over a list)",
    description:
      "Runs a per-item expression over an array from upstream and collects the results.",
    isTrigger: false,
    hasSideEffects: false,
    configFields:
      "items: string (JS expression -> array); expression: string (JS per item, with `item`/`index`/`input`)",
    fields: [
      {
        key: "items",
        label: "List",
        widget: "text",
        default: "input.trigger.items",
        placeholder: "input.trigger.pull_requests",
        help: "JS expression that resolves to an array.",
      },
      {
        key: "expression",
        label: "Per-item expression",
        widget: "textarea",
        default: "item",
        placeholder: "{ id: item.id, title: item.title.trim() }",
        help: "`item`, `index`, and `input` are in scope. Output is { results, count }.",
      },
    ],
  },
  approval: {
    kind: "approval",
    title: "Approval gate",
    description:
      "Pauses the workflow before a sensitive step until a human approves or rejects it in the run panel.",
    isTrigger: false,
    hasSideEffects: false,
    configFields:
      "message: string (shown to the approver, templated); approvers: string (informational)",
    fields: [
      {
        key: "message",
        label: "Approval message",
        widget: "textarea",
        default: "Approve this step?",
        placeholder: "Send ${{ transform.amount }} refund to {{ trigger.customer.email }}?",
        help: "Shown to whoever reviews the run. Supports {{ node_id.field }} templates.",
      },
      { key: "approvers", label: "Who approves (note)", widget: "text", default: "" },
    ],
  },
  slack_post: {
    kind: "slack_post",
    title: "Post to Slack",
    description: "Posts a message to a Slack channel.",
    isTrigger: false,
    hasSideEffects: true,
    configFields: "channel: string; text: string. Both templated.",
    fields: [
      { key: "channel", label: "Channel", widget: "text", default: "#general", placeholder: "#eng" },
      { key: "text", label: "Message", widget: "textarea", default: "", placeholder: "{{ summarize.text }}" },
      {
        key: "connectionId",
        label: "Slack connection",
        widget: "connection",
        connectionKind: "slack",
        default: "",
        optional: true,
        help: "Bot token used on live runs. Falls back to SLACK_BOT_TOKEN if unset.",
      },
    ],
  },
};

/** Default config object for a node kind, from its field specs. */
export function defaultNodeConfig(kind: NodeKind): Record<string, string> {
  const config: Record<string, string> = {};
  for (const f of NODE_CATALOG[kind].fields) config[f.key] = f.default;
  return config;
}
