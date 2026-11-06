import { Buffer } from "node:buffer";

/**
 * Base64 for an image body. Uses the runtime's native encoder (nodejs_compat):
 * a JS loop took about 22 ms for 0.5 MB (measured 2026-11-06), over the Free plan's 10 ms CPU limit;
 * the native encoder took about 1 ms for 2 MB.
 */
export function toBase64(buf: ArrayBuffer): string {
  return Buffer.from(buf).toString("base64");
}
