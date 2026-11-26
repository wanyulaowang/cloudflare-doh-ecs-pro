import {
  getRules,
  inspectRuleData,
  isDomesticDomain,
  resetRuleCacheForTest,
  updateRules
} from "../src/rules";
import type { RuleManifest } from "../src/types";
import { toArrayBuffer } from "../src/binary";
import { MAX_RULE_BYTES } from "../src/rules";
import { envWithRules, makeRuleBytes, MemoryKv } from "./helpers";

describe("byte-level rules", () => {
  beforeEach(() => resetRuleCacheForTest());

  it.each([
    ["LF without final newline", "\n", false],
    ["LF with final newline", "\n", true],
    ["CRLF without final newline", "\r\n", false],
    ["CRLF with final newline", "\r\n", true]
  ])("indexes %s", async (_name, newline, finalNewline) => {
    const data = makeRuleBytes(newline, finalNewline);
    const rules = { data, index: inspectRuleData(data) };
    expect(isDomesticDomain(rules, "0.zone")).toBe(true);
    expect(isDomesticDomain(rules, "www.qq.com")).toBe(true);
    expect(isDomesticDomain(rules, "img.news.qq.com")).toBe(true);
    expect(isDomesticDomain(rules, "z-last.cn")).toBe(true);
    expect(isDomesticDomain(rules, "exact.qq.net")).toBe(true);
    expect(isDomesticDomain(rules, "www.exact.qq.net")).toBe(false);
    expect(isDomesticDomain(rules, "fakeqq.com")).toBe(false);
    expect(isDomesticDomain(rules, "qq.com.example")).toBe(false);
    expect(isDomesticDomain(rules, "ignored.example")).toBe(false);
  });

  it("rejects HTML, NUL, empty, unsorted and misordered rules", () => {
    const encode = (text: string) => new TextEncoder().encode(text);
    expect(() => inspectRuleData(encode("<html>" + "x".repeat(40)))).toThrowError(
      "rules_html_response"
    );
    expect(() => inspectRuleData(encode(`a.com\nb.com\n${"\0"}x\n${"c".repeat(30)}`))).toThrowError(
      "rules_non_ascii"
    );
    expect(() => inspectRuleData(encode("b.com\na.com\n" + "z.com\n".repeat(8)))).toThrowError(
      "rules_not_strictly_sorted"
    );
    expect(() =>
      inspectRuleData(encode("a.com\nfull:z.com\nb.com\n" + "c".repeat(30)))
    ).toThrowError("rules_region_order");
    expect(() => inspectRuleData(encode("a.com\n\n" + "z.com\n".repeat(10)))).toThrowError(
      "rules_empty_line"
    );
  });

  it("loads active rules and falls back to previous", async () => {
    const current = await envWithRules();
    const loaded = await getRules(current.env, 1000, true);
    expect(loaded?.version).toBe(current.version);
    expect(isDomesticDomain(loaded!, "qq.com")).toBe(true);

    resetRuleCacheForTest();
    const manifest = JSON.parse(
      current.kv.values.get("rules:active") as string
    ) as RuleManifest;
    manifest.previous = manifest.active;
    manifest.active = "rules:data:not-propagated";
    manifest.size = 123;
    current.kv.values.set("rules:active", JSON.stringify(manifest));
    const fallback = await getRules(current.env, 2000, true);
    expect(fallback?.version).toBe(current.version);
  });

  it("rejects active rules whose KV hash differs from the manifest", async () => {
    const current = await envWithRules();
    const stored = current.kv.values.get(current.version);
    if (!(stored instanceof ArrayBuffer)) throw new Error("test rules missing");
    const data = new Uint8Array(stored);
    const lastIndex = data.byteLength - 1;
    data[lastIndex] = (data[lastIndex] ?? 0) ^ 1;
    current.kv.values.set(current.version, data.buffer.slice(0));

    const loaded = await getRules(current.env, 1000, true);
    expect(loaded).toBeNull();
  });

  it("writes and verifies raw version data before switching manifest", async () => {
    const kv = new MemoryKv();
    const rules = makeRuleBytes();
    const response = new Response(toArrayBuffer(rules), {
      status: 200,
      headers: { "content-type": "text/plain" }
    });
    const fetcher = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      response.clone()
    );
    const result = await updateRules(
      { RULES_KV: kv.asBinding() },
      fetcher as unknown as typeof fetch
    );
    expect(result).toBe("updated");
    expect(fetcher.mock.calls[0]?.[1]?.redirect).toBe("manual");
    const manifest = JSON.parse(kv.values.get("rules:active") as string) as RuleManifest;
    const stored = kv.values.get(manifest.active);
    expect(stored).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(stored as ArrayBuffer)).toEqual(rules);

    const unchanged = await updateRules(
      { RULES_KV: kv.asBinding() },
      fetcher as unknown as typeof fetch
    );
    expect(unchanged).toBe("unchanged");
  });

  it("times out when the rules source stalls", async () => {
    const kv = new MemoryKv();
    const fetcher = vi.fn(
      (_input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        })
    );
    await expect(
      updateRules(
        { RULES_KV: kv.asBinding() },
        fetcher as unknown as typeof fetch,
        1
      )
    ).rejects.toThrowError("rules_download_timeout");
    expect(kv.values.size).toBe(0);
  });

  it("repairs active rules when unchanged upstream data is missing or damaged", async () => {
    const current = await envWithRules();
    const rules = makeRuleBytes();
    const stored = current.kv.values.get(current.version);
    if (!(stored instanceof ArrayBuffer)) throw new Error("test rules missing");
    const damaged = new Uint8Array(stored);
    const lastIndex = damaged.byteLength - 1;
    damaged[lastIndex] = (damaged[lastIndex] ?? 0) ^ 1;
    current.kv.values.set(current.version, damaged.buffer.slice(0));

    const fetcher = vi.fn(async () =>
      new Response(toArrayBuffer(rules), {
        headers: { "content-type": "text/plain" }
      })
    );
    const result = await updateRules(
      current.env,
      fetcher as unknown as typeof fetch
    );
    expect(result).toBe("updated");
    const repaired = current.kv.values.get(current.version);
    expect(repaired).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(repaired as ArrayBuffer)).toEqual(rules);

    const loaded = await getRules(current.env, Date.now(), true);
    expect(loaded?.version).toBe(current.version);
    expect(isDomesticDomain(loaded!, "qq.com")).toBe(true);
  });

  it("cancels a rules response body rejected by content type", async () => {
    const kv = new MemoryKv();
    const rejected = {
      cancelled: false,
      stream: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(1024));
        },
        cancel() {
          rejected.cancelled = true;
        }
      })
    };
    const fetcher = vi.fn(async () =>
      new Response(rejected.stream, {
        headers: { "content-type": "text/html" }
      })
    );
    await expect(
      updateRules({ RULES_KV: kv.asBinding() }, fetcher as unknown as typeof fetch)
    ).rejects.toThrowError("rules_download_html");
    expect(rejected.cancelled).toBe(true);
    expect(kv.values.size).toBe(0);
  });

  it("does not switch manifest when KV readback verification fails", async () => {
    const kv = new MemoryKv();
    kv.failReadback = true;
    const rules = makeRuleBytes();
    const fetcher = vi.fn(async () =>
      new Response(toArrayBuffer(rules), { headers: { "content-type": "text/plain" } })
    );
    await expect(
      updateRules({ RULES_KV: kv.asBinding() }, fetcher as unknown as typeof fetch)
    ).rejects.toThrowError("rules_kv_verification_failed");
    expect(kv.values.has("rules:active")).toBe(false);
  });

  it("rejects an oversized rules stream before writing KV", async () => {
    const kv = new MemoryKv();
    const oversized = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_RULE_BYTES + 1));
        controller.close();
      }
    });
    const fetcher = vi.fn(async () =>
      new Response(oversized, { headers: { "content-type": "text/plain" } })
    );
    await expect(
      updateRules({ RULES_KV: kv.asBinding() }, fetcher as unknown as typeof fetch)
    ).rejects.toThrowError("rules_download_too_large");
    expect(kv.values.size).toBe(0);
  });

  it("rejects bad downloads before writing KV", async () => {
    const kv = new MemoryKv();
    const html = vi.fn(async () =>
      new Response("<html>" + "x".repeat(40), {
        headers: { "content-type": "text/html" }
      })
    );
    await expect(
      updateRules({ RULES_KV: kv.asBinding() }, html as unknown as typeof fetch)
    ).rejects.toThrowError("rules_download_html");
    expect(kv.values.size).toBe(0);
  });
});
