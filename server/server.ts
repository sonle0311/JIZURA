import { resolve, dirname, sep } from "node:path";
import { realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  AiError,
  validateRequest,
  validatePlan,
  type ArrangementRequest,
} from "./validation";
import { createOmpRuntime } from "./omp";
import { createSyncHandler, SYNC_UPLOAD_LIMIT } from "./sync";
import { createAuthManager, type AuthAdapter } from "./auth";
export interface Runtime extends Partial<AuthAdapter> {
  listModels(): Promise<{ provider: string; id: string; name: string }[]>;
  arrange(request: ArrangementRequest, signal: AbortSignal): Promise<any>;
}
const LIMIT = 1024 * 1024;
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
function json(data: any, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
function safeModels(models: any[]) {
  return models
    .filter(
      (m) =>
        m &&
        [m.provider, m.id, m.name].every(
          (v) => typeof v === "string" && v.length > 0 && v.length <= 300,
        ),
    )
    .map((m) => ({ provider: m.provider, id: m.id, name: m.name }));
}
async function abortable<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  let abort!: () => void;
  const stopped = new Promise<never>((_resolve, reject) => {
    abort = () => reject(new Error("aborted"));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
  try {
    return await Promise.race([promise, stopped]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}
async function readBody(request: Request, signal: AbortSignal) {
  if (Number(request.headers.get("content-length")) > LIMIT)
    throw new AiError("too_large", "Request exceeds 1 MB.", 413);
  if (!request.body)
    throw new AiError("invalid_request", "Request body is required.");
  const reader = request.body.getReader();
  let length = 0;
  const chunks: Uint8Array[] = [];
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > LIMIT) {
        await reader.cancel();
        throw new AiError("too_large", "Request exceeds 1 MB.", 413);
      }
      chunks.push(value);
    }
    signal.throwIfAborted();
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const c of chunks) {
      bytes.set(c, offset);
      offset += c.length;
    }
    try {
      return JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      );
    } catch {
      throw new AiError("invalid_request", "Request must be valid JSON.");
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}
export function createHandler({
  runtime = createOmpRuntime(),
  timeoutMs = 120000,
  staticRoot = root,
  syncHandler = createSyncHandler(),
}: {
  runtime?: Runtime;
  timeoutMs?: number;
  staticRoot?: string;
  syncHandler?: ReturnType<typeof createSyncHandler>;
} = {}) {
  let busy = false;
  let authMutation = false;
  const auth = createAuthManager(runtime as AuthAdapter);
  return async function handle(request: Request): Promise<Response> {
    const syncResponse = await syncHandler(request);
    if (syncResponse) return syncResponse;
    const controller = new AbortController();
    let timedOut = false;
    const disconnect = () => controller.abort();
    request.signal.addEventListener("abort", disconnect, { once: true });
    if (request.signal.aborted) disconnect();
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    let ownsBusy = false;
    try {
      const url = new URL(request.url);
      if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
        throw new AiError("forbidden", "Loopback access is required.", 403);
      if (url.pathname.startsWith("/api/")) {
        const authRoute =
          /^\/api\/ai\/(?:accounts|logout|login(?:\/[^/]+(?:\/input)?)?)$/.test(
            url.pathname,
          );
        if (authRoute) {
          if (
            (request.headers.has("origin") &&
              request.headers.get("origin") !== url.origin) ||
            request.headers.get("sec-fetch-site") === "cross-site"
          )
            throw new AiError(
              "forbidden",
              "Cross-origin requests are not allowed.",
              403,
            );
          const path = url.pathname.slice("/api/ai/".length);
          const parts = path.split("/");
          const expected =
            path === "accounts" || (parts[0] === "login" && parts.length === 2)
              ? request.method === "DELETE" && parts[0] === "login"
                ? "DELETE"
                : "GET"
              : "POST";
          if (request.method !== expected)
            throw new AiError("method_not_allowed", "Unsupported method.", 405);
          if (!runtime.listAccounts || !runtime.login || !runtime.logout)
            throw new AiError(
              "unavailable",
              "Account management is unavailable.",
              503,
            );
          if (path === "accounts")
            return json(
              await abortable(runtime.listAccounts(), controller.signal),
            );
          if (parts[0] === "login" && parts.length === 2)
            return json(
              request.method === "DELETE"
                ? auth.cancel(parts[1])
                : auth.get(parts[1]),
            );
          if (
            !/^application\/json(?:\s*;|$)/i.test(
              request.headers.get("content-type") || "",
            )
          )
            throw new AiError(
              "unsupported_media_type",
              "Use application/json.",
              415,
            );
          if (path === "login" || path === "logout") {
            if (busy || authMutation || auth.active())
              throw new AiError(
                "busy",
                "Generation or account changes are running. Please retry.",
                409,
              );
            authMutation = true;
            try {
              const data = await readBody(request, controller.signal);
              if (
                !data ||
                typeof data.provider !== "string" ||
                data.provider.length > 300
              )
                throw new AiError("invalid_request", "Select a provider.");
              if (path === "logout") {
                if (
                  typeof data.credentialId !== "string" ||
                  !/^[1-9][0-9]*$/.test(data.credentialId)
                )
                  throw new AiError(
                    "invalid_request",
                    "Select a stored credential.",
                  );
                return json(
                  await runtime.logout(data.provider, data.credentialId),
                );
              }
              const accounts = await runtime.listAccounts();
              if (
                !accounts.loginProviders.some(
                  (p: any) => p.id === data.provider,
                )
              )
                throw new AiError(
                  "invalid_request",
                  "Select an available login provider.",
                );
              controller.signal.throwIfAborted();
              return json(auth.start(data.provider));
            } finally {
              authMutation = false;
            }
          }
          const data = await readBody(request, controller.signal);
          return json(auth.input(parts[1], data?.promptId, data?.value));
        }
        if (url.pathname === "/api/ai/models") {
          if (request.method !== "GET")
            throw new AiError("method_not_allowed", "Use GET.", 405);
          return json({
            models: safeModels(
              await abortable(runtime.listModels(), controller.signal),
            ),
          });
        }
        if (url.pathname !== "/api/ai/arrange")
          throw new AiError("not_found", "Not found.", 404);
        if (request.method !== "POST")
          throw new AiError("method_not_allowed", "Use POST.", 405);
        if (
          (request.headers.has("origin") &&
            request.headers.get("origin") !== url.origin) ||
          request.headers.get("sec-fetch-site") === "cross-site"
        )
          throw new AiError(
            "forbidden",
            "Cross-origin requests are not allowed.",
            403,
          );
        if (
          !/^application\/json(?:\s*;|$)/i.test(
            request.headers.get("content-type") || "",
          )
        )
          throw new AiError(
            "unsupported_media_type",
            "Use application/json.",
            415,
          );
        if (busy || authMutation || auth.active())
          throw new AiError(
            "busy",
            "Another arrangement is running. Please retry shortly.",
            429,
          );
        busy = true;
        ownsBusy = true;
        const data = validateRequest(
          await readBody(request, controller.signal),
        );
        const models = safeModels(
          await abortable(runtime.listModels(), controller.signal),
        );
        if (
          !models.some(
            (m) => m.provider === data.provider && m.id === data.model,
          )
        )
          throw new AiError("invalid_model", "Select an authenticated model.");
        controller.signal.throwIfAborted();
        const inference = runtime.arrange(data, controller.signal);
        ownsBusy = false;
        const completion = inference.finally(() => {
          busy = false;
        });
        const result = await abortable(completion, controller.signal);
        controller.signal.throwIfAborted();
        return json(validatePlan(result, data));
      }
      if (request.method !== "GET" && request.method !== "HEAD")
        throw new AiError("method_not_allowed", "Use GET or HEAD.", 405);
      let path;
      try {
        path = decodeURIComponent(url.pathname);
      } catch {
        throw new AiError("not_found", "Not found.", 404);
      }
      if (
        !/^(?:\/(?:index\.html)?|\/(?:en|vi|id|ko|zh-hans|zh-hant)\/(?:index\.html)?|\/vendor\/mp4-muxer\.min\.js)$/.test(
          path,
        )
      )
        throw new AiError("not_found", "Not found.", 404);
      const filePath = resolve(
        staticRoot,
        "." + path + (path.endsWith("/") ? "index.html" : ""),
      );
      let canonical;
      try {
        canonical = await realpath(filePath);
      } catch {
        throw new AiError("not_found", "Not found.", 404);
      }
      const canonicalRoot = await realpath(staticRoot);
      if (!canonical.startsWith(canonicalRoot + sep))
        throw new AiError("not_found", "Not found.", 404);
      const file = Bun.file(canonical);
      return new Response(request.method === "HEAD" ? null : file, {
        headers: {
          "content-type": path.endsWith(".js")
            ? "application/javascript; charset=utf-8"
            : "text/html; charset=utf-8",
          "x-content-type-options": "nosniff",
        },
      });
    } catch (error) {
      if (controller.signal.aborted)
        return json(
          {
            error: {
              code: timedOut ? "timeout" : "cancelled",
              message: timedOut
                ? "Generation timed out. Please retry."
                : "Generation cancelled.",
            },
          },
          timedOut ? 504 : 499,
        );
      if (error instanceof AiError)
        return json(
          { error: { code: error.code, message: error.message } },
          error.status,
        );
      return json(
        {
          error: {
            code: "provider_error",
            message:
              "The AI service is unavailable. Check your Oh My Pi configuration and retry.",
          },
        },
        502,
      );
    } finally {
      clearTimeout(timer);
      request.signal.removeEventListener("abort", disconnect);
      if (ownsBusy) busy = false;
    }
  };
}
if (import.meta.main) {
  const port = Number(process.env.PORT || 8766);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw Error("Invalid PORT");
  Bun.serve({
    hostname: "127.0.0.1",
    port,
    idleTimeout: 130,
    maxRequestBodySize: SYNC_UPLOAD_LIMIT,
    fetch: createHandler(),
  });
  console.log(`JIZURA: http://127.0.0.1:${port}/vi/`);
}
