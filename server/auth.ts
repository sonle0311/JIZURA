import { AiError } from "./validation";
export interface AuthAdapter {
  listAccounts(): Promise<any>;
  login(provider: string, callbacks: any): Promise<unknown>;
  logout(provider: string, credentialId: string): Promise<{ removed: true }>;
}
export type FlowSnapshot = {
  id: string;
  provider: string;
  status: "starting" | "waiting" | "input" | "success" | "error" | "cancelled";
  expiresAt: number;
  auth?: { url: string; instructions?: string };
  prompt?: {
    id: string;
    message: string;
    placeholder?: string;
    secret: boolean;
    allowEmpty: boolean;
  };
  message?: string;
};
type Flow = {
  snapshot: FlowSnapshot;
  controller: AbortController;
  timer?: ReturnType<typeof setTimeout>;
  resolve?: (value: string) => void;
  reject?: (reason: any) => void;
  endedAt?: number;
};
const live = (f: Flow) =>
  ["starting", "waiting", "input"].includes(f.snapshot.status);
const text = (s: any, length = 4000) =>
  typeof s === "string" ? s.slice(0, length) : "";
export function createAuthManager(
  adapter: AuthAdapter,
  options: {
    now?: () => number;
    ttlMs?: number;
    terminalMs?: number;
    maxTerminal?: number;
  } = {},
) {
  const now = options.now ?? Date.now,
    ttl = options.ttlMs ?? 600000,
    terminal = options.terminalMs ?? 60000;
  const flows = new Map<string, Flow>();
  const pending = new Set<Flow>();
  function finish(f: Flow, status: FlowSnapshot["status"], message?: string) {
    if (!live(f)) return;
    clearTimeout(f.timer);
    f.endedAt = now();
    f.snapshot = {
      id: f.snapshot.id,
      provider: f.snapshot.provider,
      status,
      expiresAt: f.snapshot.expiresAt,
      ...(message ? { message } : {}),
    };
    const reject = f.reject;
    f.reject = undefined;
    f.resolve = undefined;
    reject?.(new Error("Login stopped"));
    if (status === "cancelled") f.controller.abort();
  }
  function clean() {
    for (const [id, f] of flows) {
      if (live(f) && now() >= f.snapshot.expiresAt)
        finish(f, "cancelled", "Login expired. Please retry.");
      if (f.endedAt !== undefined && now() - f.endedAt >= terminal)
        flows.delete(id);
    }
    const ended = [...flows].filter(([, f]) => !live(f));
    for (const [id] of ended.slice(
      0,
      Math.max(0, ended.length - (options.maxTerminal ?? 20)),
    ))
      flows.delete(id);
  }
  const snapshot = (f: Flow) => structuredClone(f.snapshot);
  function get(id: string) {
    clean();
    const f = flows.get(id);
    if (!f) throw new AiError("not_found", "Login not found or expired.", 404);
    return f;
  }
  return {
    active() {
      clean();
      return pending.size > 0 || [...flows.values()].some(live);
    },
    get(id: string) {
      return snapshot(get(id));
    },
    start(provider: string) {
      clean();
      if (pending.size > 0 || [...flows.values()].some(live))
        throw new AiError("busy", "A login is already running.", 409);
      const f: Flow = {
        snapshot: {
          id: crypto.randomUUID(),
          provider,
          status: "starting",
          expiresAt: now() + ttl,
        },
        controller: new AbortController(),
      };
      flows.set(f.snapshot.id, f);
      pending.add(f);
      f.timer = setTimeout(
        () => finish(f, "cancelled", "Login expired. Please retry."),
        ttl,
      );
      f.timer.unref?.();
      void Promise.resolve()
        .then(() =>
          adapter.login(provider, {
            signal: f.controller.signal,
            onAuth(info: any) {
              if (!live(f)) return;
              try {
                const u = new URL(info.url);
                if (!["http:", "https:"].includes(u.protocol)) return;
                f.snapshot.auth = {
                  url: u.href,
                  ...(typeof info.instructions === "string"
                    ? { instructions: text(info.instructions) }
                    : {}),
                };
                if (f.snapshot.status !== "input")
                  f.snapshot.status = "waiting";
              } catch {}
            },
            onProgress(_message: any) {
              if (live(f))
                f.snapshot.message =
                  "Login in progress. Complete the provider instructions.";
            },
            onPrompt(prompt: any) {
              if (!live(f)) return Promise.reject(new Error("Login stopped"));
              if (f.reject)
                return Promise.reject(
                  new Error("Concurrent prompts unsupported"),
                );
              f.snapshot.status = "input";
              f.snapshot.prompt = {
                id: crypto.randomUUID(),
                message: text(prompt.message),
                ...(typeof prompt.placeholder === "string"
                  ? { placeholder: text(prompt.placeholder) }
                  : {}),
                secret: prompt.secret === true,
                allowEmpty: prompt.allowEmpty === true,
              };
              return new Promise<string>((resolve, reject) => {
                f.resolve = resolve;
                f.reject = reject;
              });
            },
          }),
        )
        .then(
          () => finish(f, "success"),
          () =>
            finish(
              f,
              "error",
              "Login failed. Please retry or choose another login method.",
            ),
        )
        .finally(() => {
          pending.delete(f);
        });
      return snapshot(f);
    },
    input(id: string, promptId: any, value: any) {
      const f = get(id);
      if (!live(f) || !f.snapshot.prompt || f.snapshot.prompt.id !== promptId)
        throw new AiError(
          "stale_prompt",
          "This prompt is no longer active.",
          409,
        );
      if (
        typeof value !== "string" ||
        new TextEncoder().encode(value).length > 16384 ||
        (!value && !f.snapshot.prompt.allowEmpty)
      )
        throw new AiError(
          "invalid_request",
          "Enter a valid response (maximum 16 KiB).",
        );
      const resolve = f.resolve;
      f.resolve = undefined;
      f.reject = undefined;
      delete f.snapshot.prompt;
      f.snapshot.status = "waiting";
      resolve?.(value);
      return snapshot(f);
    },
    cancel(id: string) {
      const f = get(id);
      finish(f, "cancelled");
      return snapshot(f);
    },
  };
}
