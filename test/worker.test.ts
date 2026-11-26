import { readU16, toArrayBuffer } from "../src/binary";

const MAX_RESPONSE_BYTES = 65535;
import { parseDnsMessage } from "../src/dns";
import { handleRequest } from "../src/index";
import { resetRuleCacheForTest } from "../src/rules";
import { envWithRules, makeInvalidRdataResponseFromQuery, makeQuery, makeResponseFromQuery, MemoryKv } from "./helpers";

function base64Url(data: Uint8Array): string {
  let binary = "";
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function ecsOption(query: Uint8Array): number[] {
  const info = parseDnsMessage(query);
  if (info.opt === null) return [];
  return Array.from(query.slice(info.opt.rdataStart, info.opt.rdataStart + 11));
}

describe("DoH worker", () => {
  beforeEach(() => {
    resetRuleCacheForTest();
    vi.restoreAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  it("routes domestic POST to DNSPod and injects ECS", async () => {
    const { env } = await envWithRules();
    let destination = "";
    let forwarded = new Uint8Array();
    let redirect: RequestRedirect | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        destination = String(input);
        forwarded = new Uint8Array(init?.body as ArrayBuffer);
        redirect = init?.redirect;
        return new Response(toArrayBuffer(makeResponseFromQuery(forwarded)), {
          headers: { "content-type": "application/dns-message" }
        });
      })
    );
    const response = await handleRequest(
      new Request("https://worker.example/doh", {
        method: "POST",
        headers: {
          "content-type": "application/dns-message",
          "cf-connecting-ip": "8.8.4.123"
        },
        body: toArrayBuffer(makeQuery("www.qq.com", 1))
      }),
      env
    );
    expect(response.status).toBe(200);
    expect(destination).toBe("https://doh.pub/dns-query");
    expect(redirect).toBe("manual");
    expect(ecsOption(forwarded)).toEqual([
      0, 8, 0, 7, 0, 1, 24, 0, 8, 8, 4
    ]);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("routes foreign GET to Google and removes client ECS", async () => {
    const { env } = await envWithRules();
    const destinations: string[] = [];
    let forwarded = new Uint8Array();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        destinations.push(String(input));
        forwarded = new Uint8Array(init?.body as ArrayBuffer);
        return new Response(toArrayBuffer(makeResponseFromQuery(forwarded)), {
          headers: { "content-type": "application/dns-message" }
        });
      })
    );
    const response = await handleRequest(
      new Request(`https://worker.example/doh?dns=${base64Url(makeQuery("example.net", 65))}`, {
        headers: { "cf-connecting-ip": "8.8.4.123" }
      }),
      env
    );
    expect(response.status).toBe(200);
    expect(destinations).toEqual(["https://dns.google/dns-query"]);
    expect(parseDnsMessage(forwarded).opt).toBeNull();
  });

  it("trusts only CF-Connecting-IP for domestic ECS", async () => {
    const { env } = await envWithRules();
    let forwarded = new Uint8Array();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
        forwarded = new Uint8Array(init?.body as ArrayBuffer);
        return new Response(toArrayBuffer(makeResponseFromQuery(forwarded)), {
          headers: { "content-type": "application/dns-message" }
        });
      })
    );
    const response = await handleRequest(
      new Request(`https://worker.example/doh?dns=${base64Url(makeQuery("qq.com", 66))}`, {
        headers: {
          "x-forwarded-for": "1.2.3.4, 10.0.0.1",
          "cf-connecting-ip": "8.8.4.123"
        }
      }),
      env
    );
    expect(response.status).toBe(200);
    expect(ecsOption(forwarded)).toEqual([0, 8, 0, 7, 0, 1, 24, 0, 8, 8, 4]);
  });

  it("does not inject ECS when CF-Connecting-IP is unavailable", async () => {
    const { env } = await envWithRules();
    let forwarded = new Uint8Array();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
        forwarded = new Uint8Array(init?.body as ArrayBuffer);
        return new Response(toArrayBuffer(makeResponseFromQuery(forwarded)), {
          headers: { "content-type": "application/dns-message" }
        });
      })
    );
    const response = await handleRequest(
      new Request(`https://worker.example/doh?dns=${base64Url(makeQuery("qq.com", 66))}`, {
        headers: { "x-forwarded-for": "1.2.3.4" }
      }),
      env
    );
    expect(response.status).toBe(200);
    expect(parseDnsMessage(forwarded).opt).toBeNull();
  });

  it("returns DNS SERVFAIL after exhausting the domestic group", async () => {
    const { env } = await envWithRules();
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        calls.push(String(input));
        throw new TypeError("upstream failed");
      })
    );
    const response = await handleRequest(
      new Request("https://worker.example/doh", {
        method: "POST",
        headers: { "content-type": "application/dns-message" },
        body: toArrayBuffer(makeQuery("qq.com"))
      }),
      env
    );
    const body = new Uint8Array(await response.arrayBuffer());
    expect(readU16(body, 2) & 0x000f).toBe(2);
    expect(calls).toEqual([
      "https://doh.pub/dns-query",
      "https://dns.alidns.com/dns-query"
    ]);
  });

  it("falls back when an upstream response stream exceeds the DNS size limit", async () => {
    const { env } = await envWithRules();
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        calls.push(String(input));
        if (calls.length === 1) {
          const body = new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array(MAX_RESPONSE_BYTES + 1));
              controller.close();
            }
          });
          return new Response(body, {
            headers: { "content-type": "application/dns-message" }
          });
        }
        const query = new Uint8Array(init?.body as ArrayBuffer);
        return new Response(toArrayBuffer(makeResponseFromQuery(query)), {
          headers: { "content-type": "application/dns-message" }
        });
      })
    );
    const response = await handleRequest(
      new Request("https://worker.example/doh", {
        method: "POST",
        headers: { "content-type": "application/dns-message" },
        body: toArrayBuffer(makeQuery("example.net"))
      }),
      env
    );
    expect(response.status).toBe(200);
    expect(calls).toEqual([
      "https://dns.google/dns-query",
      "https://cloudflare-dns.com/dns-query"
    ]);
  });

  it("falls back within the global group", async () => {
    const { env } = await envWithRules();
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        calls.push(String(input));
        if (calls.length === 1) return new Response(null, { status: 503 });
        const body = new Uint8Array(init?.body as ArrayBuffer);
        return new Response(toArrayBuffer(makeResponseFromQuery(body)), {
          headers: { "content-type": "application/dns-message" }
        });
      })
    );
    const response = await handleRequest(
      new Request("https://worker.example/doh", {
        method: "POST",
        headers: { "content-type": "application/dns-message" },
        body: toArrayBuffer(makeQuery("example.net"))
      }),
      env
    );
    expect(response.status).toBe(200);
    expect(calls).toEqual([
      "https://dns.google/dns-query",
      "https://cloudflare-dns.com/dns-query"
    ]);
  });

  it("falls back from DNSPod when it returns DNS SERVFAIL", async () => {
    const { env } = await envWithRules();
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        calls.push(String(input));
        const body = new Uint8Array(init?.body as ArrayBuffer);
        const dnsBody = makeResponseFromQuery(body);
        if (calls.length === 1) dnsBody[3] = ((dnsBody[3] ?? 0) & 0xf0) | 2;
        return new Response(toArrayBuffer(dnsBody), {
          headers: { "content-type": "application/dns-message" }
        });
      })
    );
    const response = await handleRequest(
      new Request("https://worker.example/doh", {
        method: "POST",
        headers: { "content-type": "application/dns-message" },
        body: toArrayBuffer(makeQuery("qq.com"))
      }),
      env
    );
    expect(calls).toEqual([
      "https://doh.pub/dns-query",
      "https://dns.alidns.com/dns-query"
    ]);
    expect(console.warn).toHaveBeenCalledWith("doh_upstream_failed", {
      group: "domestic",
      role: "primary",
      reason: "dns_servfail"
    });
    expect(readU16(new Uint8Array(await response.arrayBuffer()), 2) & 0xf).toBe(0);
  });

  it("serves a normal homepage and returns empty 404 for unknown paths", async () => {
    const { env } = await envWithRules();
    const homepage = await handleRequest(new Request("https://worker.example/"), env);
    expect(homepage.status).toBe(200);
    expect(homepage.headers.get("content-type")).toBe("text/html; charset=utf-8");
    const html = await homepage.text();
    expect(html).toContain("星桥工作台");
    expect(html.toLowerCase()).not.toContain("dns-query");

    const unknown = await handleRequest(new Request("https://worker.example/not-found"), env);
    expect(unknown.status).toBe(404);
    expect(await unknown.text()).toBe("");
  });

  it("handles JSON domestic queries through the same ECS pipeline", async () => {
    const { env } = await envWithRules();
    let destination = "";
    let forwarded = new Uint8Array();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        destination = String(input);
        forwarded = new Uint8Array(init?.body as ArrayBuffer);
        return new Response(toArrayBuffer(makeResponseFromQuery(forwarded)), {
          headers: { "content-type": "application/dns-message" }
        });
      })
    );
    const response = await handleRequest(
      new Request("https://worker.example/resolve?name=www.qq.com&type=A", {
        headers: { "cf-connecting-ip": "8.8.4.123" }
      }),
      env
    );
    const payload = (await response.json()) as {
      Status: number;
      Question: unknown;
      Answer: unknown;
    };
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(destination).toBe("https://doh.pub/dns-query");
    expect(ecsOption(forwarded)).toEqual([
      0, 8, 0, 7, 0, 1, 24, 0, 8, 8, 4
    ]);
    expect(payload.Status).toBe(0);
    expect(payload.Question).toEqual([{ name: "www.qq.com.", type: 1 }]);
    expect(payload.Answer).toEqual([]);
  });

  it("handles JSON foreign queries without ECS", async () => {
    const { env } = await envWithRules();
    let destination = "";
    let forwarded = new Uint8Array();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        destination = String(input);
        forwarded = new Uint8Array(init?.body as ArrayBuffer);
        return new Response(toArrayBuffer(makeResponseFromQuery(forwarded)), {
          headers: { "content-type": "application/dns-message" }
        });
      })
    );
    const response = await handleRequest(
      new Request("https://worker.example/resolve?name=example.net&type=AAAA", {
        headers: { "cf-connecting-ip": "8.8.4.123" }
      }),
      env
    );
    expect(response.status).toBe(200);
    expect(destination).toBe("https://dns.google/dns-query");
    expect(parseDnsMessage(forwarded).opt).toBeNull();
    const payload = (await response.json()) as {
      Status: number;
      Question: unknown;
    };
    expect(payload.Status).toBe(0);
    expect(payload.Question).toEqual([{ name: "example.net.", type: 28 }]);
  });

  it("passes JSON NXDOMAIN responses through as Status 3", async () => {
    const { env } = await envWithRules();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
        const body = makeResponseFromQuery(new Uint8Array(init?.body as ArrayBuffer));
        body[3] = ((body[3] ?? 0) & 0xf0) | 3;
        return new Response(toArrayBuffer(body), {
          headers: { "content-type": "application/dns-message" }
        });
      })
    );
    const response = await handleRequest(
      new Request("https://worker.example/resolve?name=missing.example.net&type=A"),
      env
    );
    const payload = (await response.json()) as { Status: number; Answer?: unknown[] };
    expect(response.status).toBe(200);
    expect(payload.Status).toBe(3);
    expect(payload.Answer).toEqual([]);
  });

  it("returns JSON SERVFAIL when upstream record data is invalid", async () => {
    const { env } = await envWithRules();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: string | URL | Request, init?: RequestInit) =>
        new Response(
          toArrayBuffer(
            makeInvalidRdataResponseFromQuery(new Uint8Array(init?.body as ArrayBuffer))
          ),
          { headers: { "content-type": "application/dns-message" } }
        )
      )
    );
    const response = await handleRequest(
      new Request("https://worker.example/resolve?name=example.net&type=A"),
      env
    );
    const payload = (await response.json()) as { Status: number; Question: unknown[] };
    expect(response.status).toBe(200);
    expect(payload.Status).toBe(2);
    expect(payload.Question).toEqual([{ name: "example.net.", type: 1 }]);
  });

  it("returns JSON errors for malformed requests", async () => {
    const { env } = await envWithRules();
    const bad = await handleRequest(
      new Request("https://worker.example/resolve?name=&type=A"),
      env
    );
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "bad_request" });

    const extra = await handleRequest(
      new Request("https://worker.example/resolve?name=example.net&edns_client_subnet=1.2.3.0/24"),
      env
    );
    expect(extra.status).toBe(400);
    expect(await extra.json()).toEqual({ error: "bad_request" });
  });

  it("rejects an oversized chunked DNS body before buffering it fully", async () => {
    const { env } = await envWithRules();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(4097));
        controller.close();
      }
    });
    const response = await handleRequest(
      new Request("https://worker.example/doh", {
        method: "POST",
        headers: { "content-type": "application/dns-message" },
        body,
        duplex: "half"
      } as RequestInit & { duplex: "half" }),
      env
    );
    expect(response.status).toBe(413);
    expect(await response.text()).toBe("");
  });

  it("returns FORMERR for malformed DNS and empty HTTP errors for bad transport", async () => {
    const { env } = await envWithRules();
    const malformed = await handleRequest(
      new Request("https://worker.example/doh", {
        method: "POST",
        headers: { "content-type": "application/dns-message" },
        body: toArrayBuffer(Uint8Array.of(1, 2, 3))
      }),
      env
    );
    expect(malformed.headers.get("content-type")).toBe("application/dns-message");
    expect(readU16(new Uint8Array(await malformed.arrayBuffer()), 2) & 0xf).toBe(1);

    const badGet = await handleRequest(
      new Request("https://worker.example/doh?dns=***"),
      env
    );
    expect(badGet.status).toBe(400);
    expect(await badGet.text()).toBe("");

    const wrongType = await handleRequest(
      new Request("https://worker.example/doh", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}"
      }),
      env
    );
    expect(wrongType.status).toBe(415);
  });

  it("rejects invalid upstream response identity", async () => {
    const { env } = await envWithRules();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
        const body = makeResponseFromQuery(new Uint8Array(init?.body as ArrayBuffer));
        body[0] = 0;
        body[1] = 1;
        return new Response(toArrayBuffer(body), {
          headers: { "content-type": "application/dns-message" }
        });
      })
    );
    const response = await handleRequest(
      new Request("https://worker.example/doh", {
        method: "POST",
        headers: { "content-type": "application/dns-message" },
        body: toArrayBuffer(makeQuery("example.net"))
      }),
      env
    );
    const body = new Uint8Array(await response.arrayBuffer());
    expect(readU16(body, 2) & 0xf).toBe(2);
  });

  it("returns SERVFAIL without leaking invalid environment configuration", async () => {
    const env = {
      RULES_KV: new MemoryKv().asBinding(),
      GLOBAL_DOH_URL: "http://127.0.0.1/dns-query"
    };
    const response = await handleRequest(
      new Request("https://worker.example/doh", {
        method: "POST",
        headers: { "content-type": "application/dns-message" },
        body: toArrayBuffer(makeQuery("example.net"))
      }),
      env
    );
    expect(response.status).toBe(200);
    expect(readU16(new Uint8Array(await response.arrayBuffer()), 2) & 0xf).toBe(2);
  });
});
