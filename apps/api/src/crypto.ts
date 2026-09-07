import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from "node:crypto";
import { env } from "./env.js";

/**
 * Derives a 32-byte key from SECRET_KEY. Accepts a base64/hex key of the right
 * length directly, otherwise hashes whatever string is provided so any value
 * works in dev. Secret plaintext is only ever handled here and in the routes
 * that call this - it never reaches the graph, the worker payloads, or the API
 * responses.
 */
function key(): Buffer {
  const raw = env.SECRET_KEY;
  for (const enc of ["base64", "hex"] as const) {
    try {
      const buf = Buffer.from(raw, enc);
      if (buf.length === 32) return buf;
    } catch {
      /* try next */
    }
  }
  return createHash("sha256").update(raw).digest();
}

/** Encrypt an object to a compact `iv:tag:ciphertext` base64 string. */
export function encryptJson(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext].map((b) => b.toString("base64")).join(":");
}

export function decryptJson<T = unknown>(blob: string): T {
  const [ivB64, tagB64, ctB64] = blob.split(":");
  if (!ivB64 || !tagB64 || !ctB64) throw new Error("malformed secret blob");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key(),
    Buffer.from(ivB64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ctB64, "base64")),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString("utf8")) as T;
}
