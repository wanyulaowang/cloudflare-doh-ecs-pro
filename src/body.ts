import { concatBytes } from "./binary";

export class BodyTooLargeError extends Error {
  constructor() {
    super("body_too_large");
    this.name = "BodyTooLargeError";
  }
}

export class BodyReadTimeoutError extends Error {
  constructor() {
    super("body_read_timeout");
    this.name = "BodyReadTimeoutError";
  }
}

interface BodySource {
  readonly body: ReadableStream<Uint8Array> | null;
}

const BODY_TIMEOUT = Symbol("body_timeout");

function bodyTimeout(timeoutMs: number): {
  promise: Promise<typeof BODY_TIMEOUT>;
  clear: () => void;
} {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<typeof BODY_TIMEOUT>((resolve) => {
    timeoutId = setTimeout(() => resolve(BODY_TIMEOUT), timeoutMs);
  });
  return {
    promise,
    clear: () => {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    }
  };
}

export async function readBodyUpTo(
  source: BodySource,
  maxBytes: number,
  timeoutMs?: number
): Promise<Uint8Array> {
  if (maxBytes < 0) throw new RangeError("max_bytes_must_be_non_negative");
  if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
    throw new RangeError("body_timeout_must_be_positive");
  }
  if (source.body === null) return new Uint8Array();

  const reader = source.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;

  try {
    while (true) {
      const readPromise = reader.read();
      // 避免 timeout 先触发后，后续读取 Promise 拒绝变成 unhandled rejection。
      readPromise.catch(() => undefined);

      let result: ReadableStreamReadResult<Uint8Array> | typeof BODY_TIMEOUT;
      if (timeoutMs === undefined) {
        result = await readPromise;
      } else {
        const timeout = bodyTimeout(timeoutMs);
        try {
          result = await Promise.race([readPromise, timeout.promise]);
        } finally {
          timeout.clear();
        }
      }

      if (result === BODY_TIMEOUT) throw new BodyReadTimeoutError();
      if (result.done) break;
      if (result.value === undefined || result.value.byteLength === 0) continue;

      length += result.value.byteLength;
      if (length > maxBytes) throw new BodyTooLargeError();
      chunks.push(result.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }

  return concatBytes(chunks);
}
