import { Client, Connection } from "@temporalio/client";
import type { WorkflowExecutionInput } from "@awb/core";
import { env } from "../env.js";

let clientPromise: Promise<Client> | undefined;

export function getTemporalClient(): Promise<Client> {
  if (!clientPromise) {
    clientPromise = Connection.connect({ address: env.TEMPORAL_ADDRESS }).then(
      (connection) => new Client({ connection, namespace: env.TEMPORAL_NAMESPACE }),
    );
  }
  return clientPromise;
}

export type ExecuteWorkflowInput = WorkflowExecutionInput;
