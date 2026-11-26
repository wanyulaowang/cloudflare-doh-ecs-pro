import { concatBytes } from "../src/binary";
import { BodyReadTimeoutError, BodyTooLargeError, readBodyUpTo } from "../src/body";

function streamFrom(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(chunks[index] ?? new Uint8Array());
      index += 1;
    }
  });
}

describe("limited body reading", () => {
  it("reads a body without buffering beyond the limit", async () => {
    const first = Uint8Array.of(1, 2, 3);
    const second = Uint8Array.of(4, 5, 6);
    const body = await readBodyUpTo({ body: streamFrom([first, second]) }, 6);
    expect(Array.from(body)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("rejects and cancels a stream that exceeds the limit", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Uint8Array.of(1, 2, 3, 4, 5, 6));
      },
      cancel() {
        cancelled = true;
      }
    });

    await expect(readBodyUpTo({ body: stream }, 5)).rejects.toBeInstanceOf(
      BodyTooLargeError
    );
    expect(cancelled).toBe(true);
  });

  it("times out and cancels a stream that never produces a chunk", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start() {
        // Deliberately do not enqueue or close.
      },
      cancel() {
        cancelled = true;
      }
    });
    await expect(readBodyUpTo({ body: stream }, 4096, 1)).rejects.toBeInstanceOf(
      BodyReadTimeoutError
    );
    expect(cancelled).toBe(true);
  });

  it("rejects a positive body immediately when maxBytes is zero", async () => {
    const stream = streamFrom([Uint8Array.of(1)]);
    await expect(readBodyUpTo({ body: stream }, 0)).rejects.toBeInstanceOf(
      BodyTooLargeError
    );
  });

  it("returns an empty body from a stream that closes without data", async () => {
    const stream = streamFrom([new Uint8Array(0)]);
    expect(await readBodyUpTo({ body: stream }, 4096)).toEqual(new Uint8Array(0));
  });

  it("returns an empty body for a null stream", async () => {
    expect(await readBodyUpTo({ body: null }, 4096)).toEqual(new Uint8Array(0));
  });

  it("concatenates chunks consistently", async () => {
    const chunks = [Uint8Array.of(1), Uint8Array.of(2), Uint8Array.of(3)];
    expect(await readBodyUpTo({ body: streamFrom(chunks) }, 3)).toEqual(
      concatBytes(chunks)
    );
  });
});
