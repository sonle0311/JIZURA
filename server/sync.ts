import { mkdtemp, writeFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { AiError } from "./validation";
export const SYNC_UPLOAD_LIMIT = 24 * 1024 * 1024;
const OUTPUT_LIMIT = 1024 * 1024;
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
interface Source {
  mode?: "align" | "transcribe";
  language: string;
  lines: { index: number; text: string; locked: boolean }[];
}
export interface SyncProcess {
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  exited: Promise<number>;
  kill(): void;
}
export interface SyncRuntime {
  spawn(args: string[]): SyncProcess;
}
interface Options {
  runtime?: SyncRuntime;
  root?: string;
  tempRoot?: string;
  python?: string;
  timeoutMs?: number;
  uploadTimeoutMs?: number;
  now?: () => number;
}
interface Job {
  id: string;
  status: string;
  stage: string;
  progress?: number;
  result?: any;
  error?: { code: string; message: string };
}
function json(data: any, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
function bad(message = "Invalid alignment request."): never {
  throw new AiError("invalid_request", message);
}
function stopChild(child?: SyncProcess) {
  try {
    child?.kill();
  } catch {}
}
function plain(x: any) {
  return x && typeof x === "object" && !Array.isArray(x);
}
function keys(x: any, allowed: string[]) {
  return plain(x) && Object.keys(x).every((k) => allowed.includes(k));
}
export function validateSyncMetadata(x: any): Source {
  if (
    !keys(x, ["mode", "language", "lines"]) ||
    (x.mode !== undefined && !["align", "transcribe"].includes(x.mode)) ||
    typeof x.language !== "string" ||
    !/^(?:auto|[a-z]{2,3})$/.test(x.language) ||
    !Array.isArray(x.lines) ||
    (x.mode === "transcribe" ? x.lines.length !== 0 : !x.lines.length) ||
    x.lines.length > 200
  )
    bad();
  let chars = 0;
  const indices = new Set<number>();
  for (const r of x.lines) {
    if (
      !keys(r, ["index", "text", "locked"]) ||
      !Number.isSafeInteger(r.index) ||
      r.index < 0 ||
      indices.has(r.index) ||
      typeof r.text !== "string" ||
      !r.text.trim() ||
      /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(r.text) ||
      typeof r.locked !== "boolean"
    )
      bad();
    indices.add(r.index);
    chars += r.text.length;
  }
  if (chars > 30000) bad();
  return x;
}
export function validateSyncWav(a: Uint8Array) {
  if (a.length < 44) bad("Use mono 16 kHz PCM WAV audio.");
  const v = new DataView(a.buffer, a.byteOffset, a.byteLength);
  const s = (p: number, n: number) =>
    new TextDecoder().decode(a.subarray(p, p + n));
  if (
    s(0, 4) !== "RIFF" ||
    s(8, 4) !== "WAVE" ||
    v.getUint32(4, true) !== a.length - 8
  )
    bad("Invalid WAV header.");
  let fmt = false,
    data = false,
    duration = 0;
  let p = 12;
  for (; p + 8 <= a.length;) {
    const n = v.getUint32(p + 4, true),
      end = p + 8 + n;
    if (end > a.length) bad();
    const id = s(p, 4);
    if (id === "fmt ") {
      if (
        fmt ||
        n < 16 ||
        v.getUint16(p + 8, true) !== 1 ||
        v.getUint16(p + 10, true) !== 1 ||
        v.getUint32(p + 12, true) !== 16000 ||
        v.getUint32(p + 16, true) !== 32000 ||
        v.getUint16(p + 20, true) !== 2 ||
        v.getUint16(p + 22, true) !== 16
      )
        bad("Use mono 16 kHz 16-bit PCM WAV audio.");
      fmt = true;
    }
    if (id === "data") {
      if (data || !n || n % 2) bad();
      data = true;
      duration = n / 32000;
    }
    p = end + (n % 2);
    if (p > a.length) bad();
  }
  if (p !== a.length || !fmt || !data || duration <= 0 || duration > 600)
    bad("Audio must be at most 600 seconds.");
  return duration;
}
export function validateSyncResult(x: any, source: Source, duration: number) {
  const direct = source.mode === "transcribe";
  if (
    !keys(x, ["language", "duration", "lines", "warnings"]) ||
    typeof x.language !== "string" ||
    !/^(?:[a-z]{2,3}(?:-[a-z]{2,4})?)$/.test(x.language) ||
    !Number.isFinite(x.duration) ||
    Math.abs(x.duration - duration) > 0.05 ||
    !Array.isArray(x.lines) ||
    (direct ? x.lines.length > 200 : x.lines.length !== source.lines.length) ||
    !Array.isArray(x.warnings) ||
    x.warnings.length > 100 ||
    !x.warnings.every(
      (w: any) =>
        typeof w === "string" && w.length <= 300 && !/[\x00-\x1f]/.test(w),
    )
  )
    throw Error("protocol");
  let end = 0;
  let start = -Infinity, chars = 0;
  for (let i = 0; i < x.lines.length; i++) {
    const r = x.lines[i],
      s = source.lines[i];
    if (
      !keys(r, ["index", "text", "start", "end", "confidence", "status"]) ||
      r.index !== (direct ? i : s.index) ||
      (direct ? typeof r.text !== "string" || !r.text.trim() || /[\x00-\x1f]/.test(r.text) : r.text !== s.text) ||
      !Number.isFinite(r.confidence) ||
      r.confidence < 0 ||
      r.confidence > 1 ||
      !(direct ? ["matched", "review"] : ["matched", "review", "unmatched"]).includes(r.status)
    )
      throw Error("protocol");
    if (r.start === null && r.end === null) {
      if (r.status !== "unmatched") throw Error("protocol");
      continue;
    }
    if (
      r.status === "unmatched" ||
      !Number.isFinite(r.start) ||
      !Number.isFinite(r.end) ||
      r.start < end ||
      (direct && r.start - start < 0.05 - 1e-8) ||
      r.end <= r.start ||
      r.end > x.duration
    )
      throw Error("protocol");
    end = r.end;
    start = r.start;
    chars += r.text.length;
    if (direct && chars > 30000) throw Error("protocol");
  }
  return x;
}
async function boundedBody(request: Request, timeoutMs: number) {
  if (Number(request.headers.get("content-length")) > SYNC_UPLOAD_LIMIT)
    throw new AiError("too_large", "Upload exceeds 24 MiB.", 413);
  if (!request.body) bad();
  const reader = request.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  let rejectStopped!: (reason: AiError) => void;
  const stopped = new Promise<never>((_, reject) => {
    rejectStopped = reject;
  });
  const stop = (error: AiError) => {
    rejectStopped(error);
    void reader.cancel().catch(() => {});
  };
  const abort = () => stop(new AiError("cancelled", "Upload cancelled.", 499));
  request.signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(
    () => stop(new AiError("timeout", "Upload timed out.", 408)),
    timeoutMs,
  );
  if (request.signal.aborted) abort();
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), stopped]);
      if (done) break;
      size += value.length;
      if (size > SYNC_UPLOAD_LIMIT) {
        void reader.cancel().catch(() => {});
        throw new AiError("too_large", "Upload exceeds 24 MiB.", 413);
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let p = 0;
    for (const c of chunks) {
      bytes.set(c, p);
      p += c.length;
    }
    return bytes;
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener("abort", abort);
    reader.releaseLock();
  }
}
async function consume(
  stream: ReadableStream<Uint8Array>,
  limit: number,
  onLine?: (line: string) => void,
) {
  const reader = stream.getReader();
  let size = 0,
    buffer = "",
    decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw Error("output limit");
      if (onLine) {
        buffer += decoder.decode(value, { stream: true });
        let p;
        while ((p = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, p);
          buffer = buffer.slice(p + 1);
          if (line.trim()) onLine(line);
        }
      }
    }
    if (onLine) {
      buffer += decoder.decode();
      if (buffer.trim()) onLine(buffer);
    }
  } finally {
    reader.releaseLock();
  }
}
export function createSyncHandler({
  runtime,
  root = projectRoot,
  tempRoot = tmpdir(),
  python,
  timeoutMs = 20 * 60 * 1000,
  uploadTimeoutMs = 30000,
  now = Date.now,
}: Options = {}) {
  const engine: SyncRuntime = runtime ?? {
    spawn(args) {
      const p = Bun.spawn(args, {
        cwd: root,
        stdout: "pipe",
        stderr: "pipe",
        stdin: "ignore",
      });
      return {
        stdout: p.stdout,
        stderr: p.stderr,
        exited: p.exited,
        kill() {
          p.kill();
        },
      };
    },
  };
  const jobs = new Map<
    string,
    { snapshot: Job; finished?: number; cancel?: () => void }
  >();
  let busy = false,
    readiness: Promise<any> | undefined,
    checked = 0;
  async function command() {
    if (python) return python;
    if (process.env.JIZURA_SYNC_PYTHON) return process.env.JIZURA_SYNC_PYTHON;
    const p = join(
      root,
      ".venv-sync",
      process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
    );
    try {
      await access(p);
      return p;
    } catch {
      return "python";
    }
  }
  function prune() {
    const terminal = [...jobs.entries()].filter(
      ([, j]) => j.finished !== undefined,
    );
    for (const [id, j] of terminal)
      if (now() - j.finished! > 15 * 60 * 1000) jobs.delete(id);
    const kept = [...jobs.entries()].filter(
      ([, j]) => j.finished !== undefined,
    );
    while (kept.length > 8) jobs.delete(kept.shift()![0]);
  }
  async function check() {
    if (readiness && now() - checked < 30000) return readiness;
    checked = now();
    readiness = (async () => {
      let child: SyncProcess | undefined;
      let timer: any;
      try {
        child = engine.spawn([
          await command(),
          join(root, "alignment/worker.py"),
          "--check",
        ]);
        // Cold torch/WhisperX imports on Windows can take over 30 seconds.
        timer = setTimeout(() => stopChild(child), 60000);
        let data: any;
        await Promise.all([
          consume(child.stdout, 16384, (l) => {
            if (data) throw Error();
            data = JSON.parse(l);
          }),
          consume(child.stderr, 65536),
          child.exited.then((c) => {
            if (c !== 0) throw Error();
          }),
        ]);
        if (
          !plain(data) ||
          typeof data.available !== "boolean" ||
          data.engine !== "whisperx"
        )
          throw Error();
        return {
          available: data.available,
          engine: "whisperx",
          device: "cpu",
          message: data.available
            ? "Local alignment engine is ready."
            : "Install the local engine with python alignment/setup.py.",
        };
      } catch {
        stopChild(child);
        if (child) {
          try {
            await child.exited;
          } catch {}
        }
        return {
          available: false,
          engine: "whisperx",
          device: "cpu",
          message: "Install the local engine with python alignment/setup.py.",
        };
      } finally {
        clearTimeout(timer);
      }
    })();
    return readiness;
  }
  async function run(
    entry: { snapshot: Job; finished?: number; cancel?: () => void },
    source: Source,
    audio: Uint8Array,
    duration: number,
  ) {
    const job = entry.snapshot;
    let dir: string | undefined,
      child: SyncProcess | undefined,
      timer: any,
      stopped = false;
    entry.cancel = () => {
      if (stopped) return;
      stopped = true;
      job.status = "cancelled";
      job.stage = "cancelled";
      stopChild(child);
    };
    try {
      dir = await mkdtemp(join(tempRoot, "jizura-sync-"));
      await writeFile(join(dir, "input.wav"), audio);
      await writeFile(join(dir, "metadata.json"), JSON.stringify(source));
      if (stopped) return;
      child = engine.spawn([
        await command(),
        join(root, "alignment/worker.py"),
        "--audio",
        join(dir, "input.wav"),
        "--metadata",
        join(dir, "metadata.json"),
      ]);
      if (stopped) {
        stopChild(child);
        return;
      }
      job.status = "running";
      job.stage = "starting";
      timer = setTimeout(() => {
        if (stopped) return;
        stopped = true;
        job.status = "failed";
        job.stage = "failed";
        job.error = { code: "timeout", message: "Alignment timed out." };
        stopChild(child);
      }, timeoutMs);
      let result: any;
      const protocol = (l: string) => {
        const event = JSON.parse(l);
        if (event.type === "progress" && !result) {
          if (
            typeof event.stage !== "string" ||
            !/^[a-zA-Z0-9 _-]{1,80}$/.test(event.stage) ||
            (event.progress !== undefined &&
              (!Number.isFinite(event.progress) ||
                event.progress < 0 ||
                event.progress > 1))
          )
            throw Error();
          if (!stopped) {
            job.stage = event.stage;
            job.progress = event.progress;
          }
        } else if (event.type === "result" && !result) {
          result = validateSyncResult(event.result, source, duration);
        } else throw Error();
      };
      const streams = Promise.all([
        consume(child.stdout, OUTPUT_LIMIT, protocol),
        consume(child.stderr, OUTPUT_LIMIT),
      ]).catch((e) => {
        stopChild(child);
        throw e;
      });
      const outcomes = await Promise.allSettled([streams, child.exited]);
      if (stopped) return;
      if (
        outcomes[0].status === "rejected" ||
        outcomes[1].status === "rejected" ||
        outcomes[1].value !== 0 ||
        !result
      )
        throw Error();
      job.status = "completed";
      job.stage = "completed";
      job.progress = 1;
      job.result = result;
    } catch {
      if (!stopped) {
        job.status = "failed";
        job.stage = "failed";
        job.error = {
          code: "worker_error",
          message:
            "Local alignment failed. Check the engine installation and retry.",
        };
      }
    } finally {
      clearTimeout(timer);
      if (child) {
        try {
          await child.exited;
        } catch {}
      }
      if (dir) {
        try {
          await rm(dir, { recursive: true, force: true });
        } catch {
          job.status = "failed";
          job.error = {
            code: "cleanup_error",
            message: "Could not remove temporary alignment files.",
          };
          return;
        }
      }
      entry.cancel = undefined;
      entry.finished = now();
      busy = false;
      prune();
    }
  }
  return async function handle(request: Request): Promise<Response | null> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/sync/")) return null;
    try {
      if (
        !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
        (request.headers.has("origin") &&
          request.headers.get("origin") !== url.origin) ||
        request.headers.get("sec-fetch-site") === "cross-site"
      )
        throw new AiError(
          "forbidden",
          "Same-origin loopback access is required.",
          403,
        );
      prune();
      if (url.pathname === "/api/sync/status") {
        if (request.method !== "GET")
          throw new AiError("method_not_allowed", "Use GET.", 405);
        return json(await check());
      }
      if (url.pathname === "/api/sync/jobs") {
        if (request.method !== "POST")
          throw new AiError("method_not_allowed", "Use POST.", 405);
        if (busy)
          throw new AiError("busy", "Another alignment job is running.", 409);
        if (
          !/^multipart\/form-data\s*;/i.test(
            request.headers.get("content-type") || "",
          )
        )
          throw new AiError(
            "unsupported_media_type",
            "Use multipart/form-data.",
            415,
          );
        busy = true;
        let accepted = false;
        try {
          const bytes = await boundedBody(request, uploadTimeoutMs);
          let form: FormData;
          try {
            form = await new Response(bytes, {
              headers: { "content-type": request.headers.get("content-type")! },
            }).formData();
          } catch {
            bad("Invalid multipart body.");
          }
          const seen = new Set<string>();
          for (const [key] of form!) {
            if (!["metadata", "audio"].includes(key) || seen.has(key)) bad();
            seen.add(key);
          }
          const meta = form!.get("metadata"),
            file = form!.get("audio");
          if (
            typeof meta !== "string" ||
            !(file instanceof Blob) ||
            seen.size !== 2
          )
            bad();
          let source: Source;
          try {
            source = validateSyncMetadata(JSON.parse(meta));
          } catch {
            bad();
          }
          const audio = new Uint8Array(await file.arrayBuffer()),
            duration = validateSyncWav(audio);
          request.signal.throwIfAborted();
          const entry = {
            snapshot: {
              id: crypto.randomUUID(),
              status: "queued",
              stage: "queued",
            } as Job,
          };
          jobs.set(entry.snapshot.id, entry);
          accepted = true;
          const response = json(entry.snapshot, 202);
          void run(entry, source!, audio, duration);
          return response;
        } finally {
          if (!accepted) busy = false;
        }
      }
      const match = /^\/api\/sync\/jobs\/([a-f0-9-]{36})$/.exec(url.pathname);
      if (!match) throw new AiError("not_found", "Job not found.", 404);
      if (!["GET", "DELETE"].includes(request.method))
        throw new AiError("method_not_allowed", "Use GET or DELETE.", 405);
      const entry = jobs.get(match[1]);
      if (!entry) throw new AiError("not_found", "Job not found.", 404);
      if (request.method === "DELETE") entry.cancel?.();
      return json(entry.snapshot);
    } catch (e) {
      if (e instanceof AiError)
        return json({ error: { code: e.code, message: e.message } }, e.status);
      return json(
        {
          error: {
            code: "invalid_request",
            message: "Invalid alignment request.",
          },
        },
        400,
      );
    }
  };
}
