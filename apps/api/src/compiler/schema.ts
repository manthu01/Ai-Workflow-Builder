import { z } from "zod";
import { NODE_KINDS } from "@awb/core";

/**
 * The shape we ask the model to return. Deliberately looser than the internal
 * {@link WorkflowGraph}: every config value is a string (all our node configs
 * are string-valued, with nested objects passed as JSON strings), which keeps
 * the JSON schema flat and reliable for structured outputs. The result is then
 * validated with the real per-kind schemas via `validateGraph`.
 */
export const CompilerGraphSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  nodes: z
    .array(
      z.object({
        id: z.string(),
        kind: z.enum(NODE_KINDS),
        label: z.string(),
        config: z.record(z.string(), z.string()),
      }),
    )
    .min(1),
  edges: z.array(
    z.object({
      id: z.string(),
      source: z.string(),
      target: z.string(),
      /** "true" or "false" for edges leaving a branch node; "" otherwise. */
      sourceHandle: z.string().default(""),
    }),
  ),
});

export type CompilerGraph = z.infer<typeof CompilerGraphSchema>;

/** JSON Schema handed to the Anthropic structured-outputs API. */
export const COMPILER_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name", "description", "nodes", "edges"],
  properties: {
    name: { type: "string" },
    description: { type: "string" },
    nodes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "kind", "label", "config"],
        properties: {
          id: { type: "string", description: "snake_case, unique, starts with a letter" },
          kind: { type: "string", enum: [...NODE_KINDS] },
          label: { type: "string" },
          config: {
            type: "object",
            description: "kind-specific string values; JSON objects passed as JSON strings",
            additionalProperties: { type: "string" },
          },
        },
      },
    },
    edges: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "source", "target", "sourceHandle"],
        properties: {
          id: { type: "string" },
          source: { type: "string" },
          target: { type: "string" },
          sourceHandle: {
            type: "string",
            description: '"true" or "false" for edges out of a branch node, else ""',
          },
        },
      },
    },
  },
} as const;
