import { env } from "./env.js";

export interface SlackConnection {
  kind: "slack";
  secret: { botToken: string };
}
export interface HttpHeaderConnection {
  kind: "http_header";
  secret: { headerName: string; headerValue: string };
}
export type ResolvedConnection = SlackConnection | HttpHeaderConnection;

/**
 * Fetches a decrypted connection secret from the API at execution time. The
 * plaintext lives only in this activity's memory - it is never part of a
 * Temporal payload or the workflow history.
 */
export async function resolveConnection(id: string): Promise<ResolvedConnection> {
  const res = await fetch(`${env.AWB_API_URL}/api/connections/internal/${id}/resolve`, {
    method: "POST",
    headers: { "x-internal-token": env.INTERNAL_TOKEN },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(`could not resolve connection ${id}: ${body.error ?? res.status}`);
  }
  return (await res.json()) as ResolvedConnection;
}

export interface ResolvedBlueprint {
  baseUrl: string;
  operations: {
    operationId: string;
    method: string;
    path: string;
    summary: string;
    params: { name: string; in: string; required: boolean }[];
  }[];
}

export async function resolveBlueprint(id: string): Promise<ResolvedBlueprint> {
  const res = await fetch(`${env.AWB_API_URL}/api/blueprints/internal/${id}/resolve`, {
    method: "POST",
    headers: { "x-internal-token": env.INTERNAL_TOKEN },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(`could not resolve blueprint ${id}: ${body.error ?? res.status}`);
  }
  return (await res.json()) as ResolvedBlueprint;
}
