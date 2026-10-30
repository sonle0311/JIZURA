import { test, expect } from "bun:test";
import { createSyncHandler } from "./sync";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const base = "http://127.0.0.1:8766";
const metadata = {
  language: "vi",
  lines: [
    { index: 0, text: "Xin chào", locked: false },
    { index: 1, text: "Thế giới", locked: true },
  ],
};
const result = {
  language: "vi",
  duration: 1,
  lines: metadata.lines.map((x, i) => ({
    index: x.index,
    text: x.text,
    start: i * 0.4,
    end: i * 0.4 + 0.3,
    confidence: 0.9,
    status: "matched",
  })),
  warnings: [],
};
function wav() {
  const a = new Uint8Array(32044),
    v = new DataView(a.buffer);
  for (const [p, s] of [
    [0, "RIFF"],
    [8, "WAVE"],
    [12, "fmt "],
    [36, "data"],
  ] as const)
    for (let i = 0; i < s.length; i++) a[p + i] = s.charCodeAt(i);
  v.setUint32(4, a.length - 8, true);
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, 16000, true);
  v.setUint32(28, 32000, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  v.setUint32(40, 32000, true);
  return a;
}
function upload(meta: any = metadata, a = wav()) {
  const f = new FormData();
  f.append("metadata", JSON.stringify(meta));
  f.append("audio", new Blob([a], { type: "audio/wav" }), "../../ignored.wav");
  return new Request(base + "/api/sync/jobs", { method: "POST", body: f });
}
function fake() {
  let controller: any, resolve: any;
  const calls: string[][] = [];
  let killed = 0;
  return {
    calls,
    get killed() {
      return killed;
    },
    send(x: any) {
      controller.enqueue(new TextEncoder().encode(JSON.stringify(x) + "\n"));
    },
    finish(code = 0) {
      controller.close();
      resolve(code);
    },
    spawn(args: string[]) {
      calls.push(args);
      if (args.includes("--check"))
        return {
          stdout: new Blob([
            JSON.stringify({
              available: true,
              engine: "whisperx",
              device: "cpu",
            }) + "\n",
          ]).stream(),
          stderr: new Blob([]).stream(),
          exited: Promise.resolve(0),
          kill() {},
        };
      return {
        stdout: new ReadableStream({
          start(c) {
            controller = c;
          },
        }),
        stderr: new Blob([]).stream(),
        exited: new Promise<number>((r) => (resolve = r)),
        kill() {
          killed++;
        },
      };
    },
  };
}
async function tick() {
  await Bun.sleep(15);
}
async function settled(t: any) {
  const deadline = Date.now() + 2000;
  while ((await readdir(t.dir)).length && Date.now() < deadline)
    await Bun.sleep(2);
  await Bun.sleep(1);
}
async function setup(options: any = {}) {
  const dir = await mkdtemp(join(tmpdir(), "jizura-sync-test-"));
  const worker = fake();
  const rawHandle = createSyncHandler({
    python: "fixture-python",
    runtime: worker,
    tempRoot: dir,
    ...options,
  });
  const handle = async (request: Request) => {
    const before = worker.calls.length;
    const response = await rawHandle(request);
    if (response?.status === 202) {
      const deadline = Date.now() + 2000;
      while (worker.calls.length === before && Date.now() < deadline)
        await Bun.sleep(1);
      if (worker.calls.length === before)
        throw Error("Fixture worker did not start");
    }
    return response;
  };
  return {
    dir,
    worker,
    handle,
    async close() {
      await rm(dir, { recursive: true, force: true });
    },
  };
}
test("same-origin reads, methods and invalid uploads never start a worker", async () => {
  const t = await setup();
  try {
    expect(
      (await t.handle(
        new Request(base + "/api/sync/status", {
          headers: { origin: "https://evil.test" },
        }),
      ))!.status,
    ).toBe(403);
    expect(
      (await t.handle(new Request(base + "/api/sync/jobs", { method: "PUT" })))!
        .status,
    ).toBe(405);
    expect(
      (await t.handle(upload({ language: "vi", lines: [] })))!.status,
    ).toBe(400);
    expect((await t.handle(upload(metadata, new Uint8Array(44))))!.status).toBe(
      400,
    );
    expect(t.worker.calls.length).toBe(0);
  } finally {
    await t.close();
  }
});
test("job runs, validates source rows, cleans temporary files and caches readiness", async () => {
  const t = await setup();
  try {
    expect(
      await (await t.handle(new Request(base + "/api/sync/status")))!.json(),
    ).toMatchObject({ available: true, engine: "whisperx" });
    await t.handle(new Request(base + "/api/sync/status"));
    expect(t.worker.calls.length).toBe(1);
    const response = (await t.handle(upload()))!;
    expect(response.status).toBe(202);
    const job = await response.json();
    await tick();
    expect((await readdir(t.dir)).length).toBe(1);
    t.worker.send({ type: "progress", stage: "aligning", progress: 0.5 });
    t.worker.send({ type: "result", result });
    t.worker.finish();
    await settled(t);
    expect(
      await (await t.handle(
        new Request(base + "/api/sync/jobs/" + job.id),
      ))!.json(),
    ).toMatchObject({ status: "completed", result });
    expect(await readdir(t.dir)).toEqual([]);
  } finally {
    await t.close();
  }
});
test("cancel holds busy lock until uncooperative worker exits and cleanup completes", async () => {
  const t = await setup();
  try {
    const job = await (await t.handle(upload()))!.json();
    await tick();
    expect(
      (await t.handle(
        new Request(base + "/api/sync/jobs/" + job.id, { method: "DELETE" }),
      ))!.status,
    ).toBe(200);
    expect(t.worker.killed).toBe(1);
    expect((await t.handle(upload()))!.status).toBe(409);
    expect((await readdir(t.dir)).length).toBe(1);
    t.worker.finish();
    await settled(t);
    expect(await readdir(t.dir)).toEqual([]);
    expect(
      (await t.handle(new Request(base + "/api/sync/jobs/" + job.id)))!.status,
    ).toBe(200);
  } finally {
    await t.close();
  }
});
test("timeout kills child; malformed/reordered result fails safely", async () => {
  const t = await setup({ timeoutMs: 100 });
  try {
    const job = await (await t.handle(upload()))!.json();
    await Bun.sleep(150);
    expect(t.worker.killed).toBe(1);
    t.worker.finish();
    await settled(t);
    expect(
      await (await t.handle(
        new Request(base + "/api/sync/jobs/" + job.id),
      ))!.json(),
    ).toMatchObject({ status: "failed", error: { code: "timeout" } });
    const next = await (await t.handle(upload()))!.json();
    await tick();
    t.worker.send({
      type: "result",
      result: { ...result, lines: [...result.lines].reverse() },
    });
    t.worker.finish();
    await settled(t);
    expect(
      await (await t.handle(
        new Request(base + "/api/sync/jobs/" + next.id),
      ))!.json(),
    ).toMatchObject({ status: "failed", error: { code: "worker_error" } });
  } finally {
    await t.close();
  }
});

test("WAV rejects trailing partial chunks and strict metadata/result bounds", async () => {
  const { validateSyncWav, validateSyncMetadata, validateSyncResult } =
    await import("./sync");
  const a = new Uint8Array(wav().length + 1);
  a.set(wav());
  new DataView(a.buffer).setUint32(4, a.length - 8, true);
  expect(() => validateSyncWav(a)).toThrow();
  for (const bad of [
    { ...metadata, extra: true },
    { ...metadata, lines: [...metadata.lines, metadata.lines[0]] },
    {
      ...metadata,
      lines: [{ index: 0, text: "x".repeat(30001), locked: false }],
    },
  ])
    expect(() => validateSyncMetadata(bad)).toThrow();
  for (const bad of [
    { ...result, lines: [result.lines[0]] },
    { ...result, lines: [result.lines[0], { ...result.lines[1], start: 0.1 }] },
    {
      ...result,
      lines: [{ ...result.lines[0], confidence: 2 }, result.lines[1]],
    },
    { ...result, duration: 600 },
  ])
    expect(() => validateSyncResult(bad, metadata, 1)).toThrow();
});
test("duplicate/unknown multipart fields and oversized streamed body do not execute", async () => {
  const t = await setup();
  try {
    for (const key of ["audio", "metadata", "surprise"]) {
      const req = upload();
      const f = await req.formData();
      f.append(key, "bad");
      expect(
        (await t.handle(
          new Request(base + "/api/sync/jobs", { method: "POST", body: f }),
        ))!.status,
      ).toBe(400);
    }
    const req = new Request(base + "/api/sync/jobs", {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=x" },
      body: new ReadableStream({
        start(c) {
          for (let i = 0; i < 25; i++) c.enqueue(new Uint8Array(1024 * 1024));
          c.close();
        },
      }),
      duplex: "half",
    } as any);
    expect((await t.handle(req))!.status).toBe(413);
    expect(t.worker.calls).toEqual([]);
  } finally {
    await t.close();
  }
});
test("terminal jobs expire after fifteen minutes and retention is capped at eight", async () => {
  let now = 0;
  const t = await setup({ now: () => now });
  try {
    const ids = [];
    for (let i = 0; i < 10; i++) {
      const job = await (await t.handle(upload()))!.json();
      ids.push(job.id);
      await tick();
      t.worker.send({ type: "result", result });
      t.worker.finish();
      await settled(t);
      now++;
    }
    expect(
      (await t.handle(new Request(base + "/api/sync/jobs/" + ids[0])))!.status,
    ).toBe(404);
    expect(
      (await t.handle(new Request(base + "/api/sync/jobs/" + ids[2])))!.status,
    ).toBe(200);
    now += 900001;
    expect(
      (await t.handle(new Request(base + "/api/sync/jobs/" + ids[9])))!.status,
    ).toBe(404);
  } finally {
    await t.close();
  }
});

test("malformed readiness output kills and awaits its child before returning safe unavailable", async () => {
  let killed = 0,
    finish: any;
  const exit = new Promise<number>((r) => (finish = r));
  const handle = createSyncHandler({
    runtime: {
      spawn() {
        return {
          stdout: new Blob(["not json\n"]).stream(),
          stderr: new Blob([]).stream(),
          exited: exit,
          kill() {
            killed++;
          },
        };
      },
    },
  });
  let returned = false;
  const response = handle(new Request(base + "/api/sync/status")).then((x) => {
    returned = true;
    return x;
  });
  await tick();
  expect(killed).toBe(1);
  expect(returned).toBe(false);
  finish(1);
  expect(await (await response)!.json()).toMatchObject({
    available: false,
    engine: "whisperx",
  });
});

test("main server routes sync jobs without changing existing JSON cap", async () => {
  const { createHandler } = await import("./server");
  const t = await setup();
  try {
    const handle = createHandler({
      syncHandler: t.handle,
      runtime: {
        async listModels() {
          return [];
        },
        async arrange() {
          throw Error("must not execute");
        },
      },
    });
    expect((await handle(upload()))!.status).toBe(202);
    await tick();
    t.worker.finish(1);
    await settled(t);
    const request = new Request(base + "/api/ai/arrange", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: " ".repeat(1024 * 1024 + 1),
    });
    expect((await handle(request)).status).toBe(413);
  } finally {
    await t.close();
  }
});

test("oversized worker output is terminated, redacted and cleaned after exit", async () => {
  const t = await setup();
  try {
    const job = await (await t.handle(upload()))!.json();
    await tick();
    t.worker.send({ type: "progress", stage: "x".repeat(1024 * 1024 + 1) });
    await tick();
    expect(t.worker.killed).toBe(1);
    expect((await t.handle(upload()))!.status).toBe(409);
    t.worker.finish(1);
    await settled(t);
    const response = await (await t.handle(
      new Request(base + "/api/sync/jobs/" + job.id),
    ))!.json();
    expect(response).toMatchObject({
      status: "failed",
      error: { code: "worker_error" },
    });
    expect(JSON.stringify(response).length).toBeLessThan(500);
    expect(await readdir(t.dir)).toEqual([]);
  } finally {
    await t.close();
  }
});

test("aborted stalled upload cancels its reader and releases job reservation", async () => {
  const t = await setup();
  const controller = new AbortController();
  let cancelled = false;
  try {
    const request = new Request(base + "/api/sync/jobs", {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=x" },
      signal: controller.signal,
      body: new ReadableStream({
        cancel() {
          cancelled = true;
        },
      }),
      duplex: "half",
    } as any);
    const pending = t.handle(request);
    await tick();
    controller.abort();
    const response = await Promise.race([
      pending,
      Bun.sleep(200).then(() => null),
    ]);
    expect(response?.status).toBe(499);
    expect(cancelled).toBe(true);
    expect(t.worker.calls).toEqual([]);
    expect((await t.handle(upload()))!.status).toBe(202);
    t.worker.finish(1);
    await settled(t);
  } finally {
    await t.close();
  }
});
test("stalled upload times out and a subsequent valid job is accepted", async () => {
  const t = await setup({ uploadTimeoutMs: 20 });
  let cancelled = false;
  try {
    const request = new Request(base + "/api/sync/jobs", {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=x" },
      body: new ReadableStream({
        cancel() {
          cancelled = true;
        },
      }),
      duplex: "half",
    } as any);
    const response = await Promise.race([
      t.handle(request),
      Bun.sleep(200).then(() => null),
    ]);
    expect(response?.status).toBe(408);
    expect(cancelled).toBe(true);
    expect(t.worker.calls).toEqual([]);
    expect((await t.handle(upload()))!.status).toBe(202);
    t.worker.finish(1);
    await settled(t);
  } finally {
    await t.close();
  }
});

test("direct transcription accepts empty source and validates independent recognized rows", async () => {
  const { validateSyncMetadata, validateSyncResult } = await import("./sync");
  const source = { mode: "transcribe", language: "auto", lines: [] };
  expect(validateSyncMetadata(source)).toEqual(source);
  expect(() => validateSyncMetadata({ ...source, mode: "unknown" })).toThrow();
  expect(() => validateSyncMetadata({ ...source, lines: metadata.lines })).toThrow();
  expect(validateSyncResult(result, source, 1)).toEqual(result);
  expect(validateSyncResult({ ...result, lines: [] }, source, 1).lines).toEqual([]);
  const first = result.lines[0];
  for (const lines of [
    [{ ...first, text: "" }], [{ ...first, text: "bad\u0000" }],
    [{ ...first, text: "first\nsecond" }], [{ ...first, text: "first\tsecond" }],
    [{ ...first, text: "x".repeat(30001) }], [{ ...first, index: 1 }],
    [{ ...first, start: null, end: null, status: "unmatched" }],
    [{ ...first, start: -.1 }], [{ ...first, end: NaN }],
    [{ ...first, end: .01 }, { ...first, index: 1, start: .02, end: .2 }],
    Array.from({length:201},(_,index)=>({...first,index,start:index*.1,end:index*.1+.05})),
  ]) expect(() => validateSyncResult({ ...result, lines }, source, 1)).toThrow();
});

test("direct transcription jobs accept worker rows unrelated to source lyrics", async () => {
  const t = await setup();
  try {
    const response = (await t.handle(upload({mode:"transcribe",language:"auto",lines:[]})))!;
    expect(response.status).toBe(202);
    const job = await response.json();
    t.worker.send({type:"result",result});
    t.worker.finish();
    await settled(t);
    expect(await (await t.handle(new Request(base+"/api/sync/jobs/"+job.id)))!.json()).toMatchObject({status:"completed",result});
  } finally { await t.close(); }
});
