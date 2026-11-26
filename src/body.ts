import { concatBytes } from "./binary";

export class BodyTooLargeError extends Error {
  constructor() {
    super("body_too_large");
    this.name = "BodyTooLargeError";
  }
}

interface BodySource {
  readonly body: ReadableStream<Uint8Array> | null;
}

export async function readBodyUpTo(
  source: BodySource,
  maxBytes: number
): Promise<Uint8Array> {
  if (maxBytes < 0) throw new RangeError("max_bytes_must_be_non_negative");
  if (source.body === null) return new Uint8Array();

  const reader = source.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined || value.byteLength === 0) continue;

      length += value.byteLength;
      if (length > maxBytes) throw new BodyTooLargeError();
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }

  return concatBytes(chunks);
}
