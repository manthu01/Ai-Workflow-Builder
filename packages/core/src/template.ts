/**
 * Minimal, dependency-free templating used by node configs.
 *
 * `{{ node_id.path.to.value }}` is replaced with the value at that path in the
 * execution context (a map of node id -> that node's output). A reference that
 * resolves to an object/array is JSON-stringified; a missing reference throws so
 * the failure is visible in the debugger rather than silently producing "".
 */
export type TemplateContext = Record<string, unknown>;

const REF = /\{\{\s*([a-zA-Z0-9_.[\]]+)\s*\}\}/g;

export function resolvePath(root: unknown, path: string): unknown {
  const parts = path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter(Boolean);
  let cur: unknown = root;
  for (const part of parts) {
    if (cur == null || typeof cur !== "object") {
      throw new Error(`cannot read "${part}" of ${JSON.stringify(cur)} (path "${path}")`);
    }
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

export function renderString(input: string, ctx: TemplateContext): string {
  return input.replace(REF, (_match, path: string) => {
    const value = resolvePath(ctx, path);
    if (value === undefined) throw new Error(`template reference "${path}" is undefined`);
    return typeof value === "string" ? value : JSON.stringify(value);
  });
}

/** Recursively render every string leaf in a value. */
export function renderDeep<T>(value: T, ctx: TemplateContext): T {
  if (typeof value === "string") return renderString(value, ctx) as T;
  if (Array.isArray(value)) return value.map((v) => renderDeep(v, ctx)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = renderDeep(v, ctx);
    return out as T;
  }
  return value;
}

/** Parse a string that is expected to hold a JSON object; `{}` on empty. */
export function parseJsonObject(raw: string, label: string): Record<string, unknown> {
  const trimmed = raw.trim();
  if (!trimmed) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    throw new Error(`${label} is not valid JSON: ${(err as Error).message}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return parsed as Record<string, unknown>;
}
