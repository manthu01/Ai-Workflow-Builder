export interface BlueprintOperation {
  operationId: string;
  method: string;
  path: string;
  summary: string;
  params: { name: string; in: string; required: boolean }[];
}

const METHODS = ["get", "post", "put", "patch", "delete"];

const slug = (s: string) => s.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "");

/**
 * Distils an OpenAPI (v2 or v3) document into a flat list of callable
 * operations. Inline params only - no $ref resolution, which is fine for the
 * "teach the compiler your API" use case.
 */
export function parseOpenApi(spec: unknown): {
  baseUrl: string;
  operations: BlueprintOperation[];
} {
  const s = (spec ?? {}) as Record<string, unknown>;
  const servers = s.servers as { url?: string }[] | undefined;
  const baseUrl =
    servers?.[0]?.url ??
    (typeof s.host === "string"
      ? `${(s.schemes as string[] | undefined)?.[0] ?? "https"}://${s.host}${s.basePath ?? ""}`
      : "");

  const paths = (s.paths ?? {}) as Record<string, Record<string, unknown>>;
  const operations: BlueprintOperation[] = [];

  for (const [path, methods] of Object.entries(paths)) {
    for (const [method, op] of Object.entries(methods)) {
      if (!METHODS.includes(method.toLowerCase())) continue;
      const o = (op ?? {}) as Record<string, unknown>;
      const params = ((o.parameters ?? []) as Record<string, unknown>[])
        .filter((p) => typeof p.name === "string")
        .map((p) => ({
          name: String(p.name),
          in: String(p.in ?? "query"),
          required: Boolean(p.required),
        }));
      if (o.requestBody) {
        params.push({
          name: "body",
          in: "body",
          required: Boolean((o.requestBody as { required?: unknown }).required),
        });
      }
      operations.push({
        operationId:
          typeof o.operationId === "string" && o.operationId
            ? o.operationId
            : `${method.toLowerCase()}_${slug(path)}`,
        method: method.toUpperCase(),
        path,
        summary: String(o.summary ?? o.description ?? ""),
        params,
      });
    }
  }
  return { baseUrl, operations };
}
