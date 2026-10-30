import { test, expect } from "bun:test";
import { validateRequest, validatePlan } from "./validation";
import { createHandler } from "./server";
import { runRestrictedSession, restrictedOptions } from "./omp";

export const input = () => ({
  provider: "fixture",
  model: "test",
  direction: "gentle",
  lines: [
    { index: 0, text: "Hello", start: 0, end: 1, locked: false },
    { index: 1, text: "Locked", start: 1, end: 2, locked: true },
  ],
  catalog: Object.fromEntries(
    [
      "style",
      "layout",
      "enter",
      "hold",
      "exit",
      "decor",
      "treat",
      "bg",
      "cam",
      "trans",
    ].map((k) => [k, [{ id: "ok", name: "Allowed", tags: ["soft"] }]]),
  ),
});
const plan = () => ({
  summary: "Calm",
  lines: [{ index: 0, reason: "Clarity", layout: "ok", decor: ["ok"] }],
});
test("request validates timing, limits, catalogue and exact fields", () => {
  expect(validateRequest(input()).lines).toHaveLength(2);
  for (const mutate of [
    (x: any) => (x.lines[0].end = -1),
    (x: any) => (x.lines[0].locked = "no"),
    (x: any) => (x.catalog.fx = []),
    (x: any) => x.lines.push({ ...x.lines[0] }),
    (x: any) => (x.direction = "x".repeat(2001)),
    (x: any) => (x.secret = "bad"),
  ]) {
    const x = input();
    mutate(x);
    expect(() => validateRequest(x)).toThrow();
  }
});
test("plan covers every unlocked line exactly once and rejects arbitrary mutation", () => {
  expect(validatePlan(plan(), validateRequest(input()))).toEqual(plan());
  for (const x of [
    { ...plan(), lines: [] },
    { ...plan(), lines: [...plan().lines, ...plan().lines] },
    { ...plan(), lines: [{ index: 1, reason: "x" }] },
    { ...plan(), lines: [{ index: 0, reason: "x", layout: "unknown" }] },
    { ...plan(), audio: "bad" },
  ])
    expect(() => validatePlan(x, validateRequest(input()))).toThrow();
});
test("session is tool-free, private and disposed on success and error", async () => {
  const opts = restrictedOptions();
  expect(opts.toolNames).toEqual([]);
  expect(opts.restrictToolNames).toBe(true);
  expect(opts.noContextFiles).toBe(true);
  expect(opts.enableMCP).toBe(false);
  expect(opts.enableLsp).toBe(false);
  expect(opts.skills).toEqual([]);
  expect(opts.cacheWarming).toBe(false);
  expect(opts.autoTitle).toBe(false);
  for (const fail of [false, true]) {
    let disposed = 0;
    const session = {
      messages: [
        {
          role: "assistant",
          content: [{ type: "text", text: JSON.stringify(plan()) }],
        },
      ],
      prompt: async () => {
        if (fail) throw Error("secret");
      },
      abort: async () => {},
      dispose: async () => {
        disposed++;
      },
    };
    const run = runRestrictedSession(
      async () => ({ session }),
      {},
      input(),
      new AbortController().signal,
    );
    if (fail) await expect(run).rejects.toThrow();
    else expect(await run).toEqual(plan());
    expect(disposed).toBe(1);
  }
});
const request = (path: string, options: any = {}) =>
  new Request("http://127.0.0.1:8766" + path, options);
const post = (data: any = input(), extra: any = {}) =>
  request("/api/ai/arrange", {
    method: "POST",
    headers: { "content-type": "application/json", ...extra.headers },
    body: JSON.stringify(data),
    ...extra,
  });
test("HTTP redacts models and rejects bad origin, methods, models, body and private files", async () => {
  const handler = createHandler({
    runtime: {
      listModels: async () => [
        { provider: "fixture", id: "test", name: "Test", apiKey: "secret" },
      ],
      arrange: async () => plan(),
    },
  });
  expect(await (await handler(request("/api/ai/models"))).json()).toEqual({
    models: [{ provider: "fixture", id: "test", name: "Test" }],
  });
  expect((await handler(post())).status).toBe(200);
  expect(
    (
      await handler(
        post(input(), {
          headers: {
            origin: "https://evil.test",
            "content-type": "application/json",
          },
        }),
      )
    ).status,
  ).toBe(403);
  expect(
    (await handler(request("/api/ai/models", { method: "POST" }))).status,
  ).toBe(405);
  expect((await handler(post({ ...input(), model: "other" }))).status).toBe(
    400,
  );
  expect(
    (await handler(post({ ...input(), direction: "x".repeat(1048577) })))
      .status,
  ).toBe(413);
  for (const path of [
    "/server/omp.ts",
    "/.git/config",
    "/package.json",
    "/%2e%2e%2fpackage.json",
    "/app/body.html",
  ])
    expect((await handler(request(path))).status).toBe(404);
  expect((await handler(request("/vi/"))).status).toBe(200);
});
test("HTTP bounds concurrency, cancels and hides provider exceptions", async () => {
  let entered!: () => void;
  const ready = new Promise<void>((r) => (entered = r));
  let aborted = false;
  const handler = createHandler({
    timeoutMs: 30,
    runtime: {
      listModels: async () => [
        { provider: "fixture", id: "test", name: "Test" },
      ],
      arrange: async (_x: any, signal: AbortSignal) => {
        entered();
        await new Promise((_r, reject) =>
          signal.addEventListener(
            "abort",
            () => {
              aborted = true;
              reject(Error("secret token"));
            },
            { once: true },
          ),
        );
      },
    },
  });
  const first = handler(post());
  await ready;
  expect((await handler(post())).status).toBe(429);
  const response = await first;
  expect(response.status).toBe(504);
  expect(aborted).toBe(true);
  expect(JSON.stringify(await response.json())).not.toContain("secret");
  const controller = new AbortController();
  const pending = handler(post(input(), { signal: controller.signal }));
  await new Promise((r) => setTimeout(r, 2));
  controller.abort();
  expect((await pending).status).toBe(499);
});
test("HTTP timeout is bounded even when a provider ignores cancellation, retaining busy until cleanup", async () => {
  let finish!: () => void;
  let entered!: () => void;
  const ready = new Promise<void>((r) => (entered = r));
  const handler = createHandler({
    timeoutMs: 10,
    runtime: {
      listModels: async () => [
        { provider: "fixture", id: "test", name: "Test" },
      ],
      arrange: async () => {
        entered();
        await new Promise<void>((r) => (finish = r));
        return plan();
      },
    },
  });
  const pending = handler(post());
  await ready;
  expect((await pending).status).toBe(504);
  expect((await handler(post())).status).toBe(429);
  finish();
  await new Promise((r) => setTimeout(r, 1));
  expect((await handler(request("/api/ai/models"))).status).toBe(200);
});
test("plan requires a visual choice and catalogue is bounded to 36 items per group", () => {
  expect(() =>
    validatePlan(
      { summary: "x", lines: [{ index: 0, reason: "x" }] },
      validateRequest(input()),
    ),
  ).toThrow();
  const x = input();
  x.catalog.layout = Array.from({ length: 37 }, (_, n) => ({
    id: String(n),
    name: "x",
  }));
  expect(() => validateRequest(x)).toThrow();
});
test("HTTP bounded streaming body, invalid JSON and read timeout", async () => {
  const handler = createHandler({
    timeoutMs: 15,
    runtime: { listModels: async () => [], arrange: async () => plan() },
  });
  const stream = new ReadableStream({
    start(c) {
      c.enqueue(new Uint8Array(1048577));
      c.close();
    },
  });
  expect(
    (
      await handler(
        request("/api/ai/arrange", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: stream,
          duplex: "half",
        }),
      )
    ).status,
  ).toBe(413);
  expect(
    (
      await handler(
        request("/api/ai/arrange", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{",
        }),
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await handler(
        request("/api/ai/arrange", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: new ReadableStream({}),
          duplex: "half",
        }),
      )
    ).status,
  ).toBe(504);
});
test("SDK cancellation aborts and disposes the active session", async () => {
  const controller = new AbortController();
  let disposed = false,
    aborted = false,
    started!: () => void,
    rejectPrompt!: (e: any) => void;
  const ready = new Promise<void>((r) => (started = r));
  const session = {
    messages: [],
    prompt: async () => {
      started();
      await new Promise((_r, reject) => (rejectPrompt = reject));
    },
    abort: async () => {
      aborted = true;
      rejectPrompt(Error("cancelled"));
    },
    dispose: async () => {
      disposed = true;
    },
  };
  const pending = runRestrictedSession(
    async () => ({ session }),
    {},
    input(),
    controller.signal,
  );
  await ready;
  controller.abort();
  await expect(pending).rejects.toThrow();
  expect(aborted).toBe(true);
  expect(disposed).toBe(true);
});
