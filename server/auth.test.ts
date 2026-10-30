import { test, expect } from "bun:test";
import { createHandler } from "./server";
const base = "http://127.0.0.1:8766";
const req = (path: string, method = "GET", body?: any, headers: any = {}) =>
  new Request(base + "/api/ai/" + path, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
const tick = () => new Promise((r) => setTimeout(r, 0));
function fixture(login?: any) {
  let calls = 0;
  let removed: any[] = [];
  const runtime: any = {
    listModels: async () => [],
    arrange: async () => ({}),
    listAccounts: async () => ({
      providers: [],
      loginProviders: [{ id: "fake", name: "Fake", provider: "fake" }],
    }),
    login: async (p: any, c: any) => {
      calls++;
      return login?.(p, c);
    },
    logout: async (p: any, id: any) => {
      removed.push([p, id]);
      return { removed: true };
    },
  };
  return {
    handle: createHandler({ runtime }),
    get calls() {
      return calls;
    },
    removed,
  };
}
test("accounts reads do not login and cross-origin auth reads are blocked", async () => {
  const f = fixture();
  expect((await f.handle(req("accounts"))).status).toBe(200);
  expect(f.calls).toBe(0);
  expect(
    (
      await f.handle(
        req("accounts", "GET", undefined, { origin: "https://evil.test" }),
      )
    ).status,
  ).toBe(403);
  expect((await f.handle(req("login", "PUT", {}))).status).toBe(405);
});
test("explicit login exposes safe callbacks, prevents stale answers, clears secrets on success", async () => {
  let answer = "";
  const f = fixture(async (_: any, c: any) => {
    c.onAuth({ url: "https://example.test/auth", instructions: "Continue" });
    answer = await c.onPrompt({ message: "Key", secret: true });
  });
  const s = await (
    await f.handle(req("login", "POST", { provider: "fake" }))
  ).json();
  await tick();
  const flow = await (await f.handle(req("login/" + s.id))).json();
  expect(flow.status).toBe("input");
  expect(flow.prompt.secret).toBe(true);
  expect(
    (
      await f.handle(
        req("login/" + s.id + "/input", "POST", {
          promptId: "stale",
          value: "secret",
        }),
      )
    ).status,
  ).toBe(409);
  expect(
    (await f.handle(req("login", "POST", { provider: "fake" }))).status,
  ).toBe(409);
  expect(
    (
      await f.handle(
        req("login/" + s.id + "/input", "POST", {
          promptId: flow.prompt.id,
          value: "private-key",
        }),
      )
    ).status,
  ).toBe(200);
  await tick();
  const done = await (await f.handle(req("login/" + s.id))).json();
  expect(done.status).toBe("success");
  expect(JSON.stringify(done)).not.toContain("private-key");
  expect(done.auth).toBeUndefined();
  expect(answer).toBe("private-key");
});
test("cancel aborts a pending SDK prompt; raw failures and unsafe URLs never leak", async () => {
  const f = fixture(async (_: any, c: any) => {
    c.onAuth({ url: "javascript:alert(1)" });
    await c.onPrompt({ message: "Code" });
  });
  const s = await (
    await f.handle(req("login", "POST", { provider: "fake" }))
  ).json();
  await tick();
  expect(
    (await (await f.handle(req("login/" + s.id))).json()).auth,
  ).toBeUndefined();
  expect(
    (await (await f.handle(req("login/" + s.id, "DELETE"))).json()).status,
  ).toBe("cancelled");
  await tick();
  const bad = fixture(async () => {
    throw new Error("TOKEN-secret");
  });
  const b = await (
    await bad.handle(req("login", "POST", { provider: "fake" }))
  ).json();
  await tick();
  const d = await (await bad.handle(req("login/" + b.id))).json();
  expect(d.status).toBe("error");
  expect(JSON.stringify(d)).not.toContain("TOKEN");
});
import { createOmpRuntime } from "./omp";
import { createAuthManager } from "./auth";
test("cancel keeps mutation lock until provider settles and expiry removes retained snapshots", async () => {
  let clock = 0,
    release: any;
  const manager = createAuthManager(
    {
      listAccounts: async () => ({}),
      logout: async () => ({ removed: true }),
      login: async () => await new Promise((r) => (release = r)),
    },
    { now: () => clock, ttlMs: 100, terminalMs: 10 },
  );
  const f = manager.start("fake");
  await tick();
  manager.cancel(f.id);
  expect(manager.active()).toBe(true);
  release({});
  await tick();
  expect(manager.active()).toBe(false);
  clock = 11;
  expect(() => manager.get(f.id)).toThrow();
});
test("SDK account metadata whitelists credential rows and exact logout without live auth", async () => {
  const rows: any[] = [
    {
      id: 7,
      provider: "fake",
      credential: {
        type: "oauth",
        access: "TOPSECRET",
        refresh: "REFRESH",
        email: "private@example.com",
      },
    },
  ];
  let logins = 0;
  const authStorage: any = {
    credentials: {
      poll: async () => false,
      reload: async () => {},
      list: (p?: string) => rows.filter((r) => !p || r.provider === p),
      removeById: async (p: string, id: number) => {
        const i = rows.findIndex((r) => r.provider === p && r.id === id);
        if (i < 0) return false;
        rows.splice(i, 1);
        return true;
      },
    },
    oauth: {
      accounts: () => [
        {
          credentialId: 7,
          email: "private@example.com",
          accountId: "hidden-account",
        },
      ],
      login: async () => {
        logins++;
      },
    },
    keys: { source: () => ({ kind: "oauth" }) },
  };
  // Adapter metadata helper avoids loading discovery or any real credential store.
  const { accountMetadata, removeStoredCredential } = await import("./omp");
  const result = accountMetadata(
    authStorage,
    [{ provider: "fake", id: "x" }],
    [
      {
        id: "fake-login",
        name: "Fake",
        available: true,
        storeCredentialsAs: "fake",
      },
    ],
  );
  const encoded = JSON.stringify(result);
  expect(encoded).not.toContain("TOPSECRET");
  expect(encoded).not.toContain("private@");
  expect(encoded).not.toContain("hidden-account");
  expect(result.providers[0].accounts[0].id).toBe("7");
  expect(result.loginProviders[0].provider).toBe("fake");
  expect(logins).toBe(0);
  await expect(
    removeStoredCredential(authStorage, "other", "7"),
  ).rejects.toThrow();
  expect(rows.length).toBe(1);
  await removeStoredCredential(authStorage, "fake", "7");
  expect(rows.length).toBe(0);
});
test("auth methods, JSON limits, unknown providers and prompt sizes are guarded", async () => {
  const f = fixture(
    async (_: any, c: any) => await c.onPrompt({ message: "Code" }),
  );
  expect(
    (await f.handle(req("login", "POST", { provider: "missing" }))).status,
  ).toBe(400);
  expect(
    (
      await f.handle(
        new Request(base + "/api/ai/login", { method: "POST", body: "{}" }),
      )
    ).status,
  ).toBe(415);
  expect(
    (
      await f.handle(
        req(
          "logout",
          "POST",
          { provider: "fake", credentialId: "7" },
          { "content-length": "2000000" },
        ),
      )
    ).status,
  ).toBe(413);
  expect((await f.handle(req("login/unknown"))).status).toBe(404);
  const s = await (
    await f.handle(req("login", "POST", { provider: "fake" }))
  ).json();
  await tick();
  const current = await (await f.handle(req("login/" + s.id))).json();
  expect(
    (
      await f.handle(
        req("login/" + s.id + "/input", "POST", {
          promptId: current.prompt.id,
          value: "x".repeat(16385),
        }),
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await f.handle(
        req("logout", "POST", { provider: "fake", credentialId: "7" }),
      )
    ).status,
  ).toBe(409);
  expect((await f.handle(req("arrange", "POST", {}))).status).toBe(429);
  await f.handle(req("login/" + s.id, "DELETE"));
});
test("expiry aborts pending prompts and bounds retained terminal snapshots", async () => {
  let clock = 0;
  const manager = createAuthManager(
    {
      listAccounts: async () => ({}),
      logout: async () => ({ removed: true }),
      login: async (_: any, c: any) => await c.onPrompt({ message: "Code" }),
    },
    { now: () => clock, ttlMs: 100, maxTerminal: 2 },
  );
  const f = manager.start("fake");
  await tick();
  clock = 101;
  expect(manager.get(f.id).status).toBe("cancelled");
  await tick();
  expect(manager.active()).toBe(false);
  const second = manager.start("fake");
  manager.cancel(second.id);
  await tick();
  const third = manager.start("fake");
  manager.cancel(third.id);
  await tick();
  expect(() => manager.get(f.id)).toThrow();
});
test("runtime SDK adapter only logs in explicitly and rejects no stored identity", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join, resolve, basename } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "jizura-auth-test-"));
  let calls = 0;
  const runtime = createOmpRuntime({
    agentDir: dir,
    cwd: dir,
    authStorage: {
      oauth: {
        login: async () => {
          calls++;
          return undefined;
        },
      },
    },
  });
  try {
    expect(calls).toBe(0);
    await expect(
      runtime.login("fake", { signal: new AbortController().signal }),
    ).rejects.toThrow();
    expect(calls).toBe(1);
  } finally {
    if (
      resolve(dir).startsWith(resolve(tmpdir())) &&
      basename(dir).startsWith("jizura-auth-test-")
    )
      await rm(dir, { recursive: true, force: true });
  }
});
test("public runtime excludes MCP credential namespaces and refuses their logout", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join, resolve, basename } = await import("node:path");
  const sdk = await import("@oh-my-pi/pi-coding-agent");
  const dir = await mkdtemp(join(tmpdir(), "jizura-auth-scope-"));
  const auth = await sdk.AuthStorage.create(join(dir, "auth.db"));
  const provider = "mcp_oauth:profile:default:https://mcp.atlassian.com/v1/mcp";
  try {
    await auth.credentials.set(provider, {
      type: "oauth",
      access: "fake-access",
      refresh: "fake-refresh",
      expires: 9999999999999,
      email: "test@example.com",
    });
    const id = String(auth.credentials.list(provider)[0].id);
    const runtime = createOmpRuntime({
      agentDir: dir,
      cwd: dir,
      authStorage: auth,
    });
    const metadata = await runtime.listAccounts();
    expect(metadata.providers.some((p) => p.id === provider)).toBe(false);
    await expect(runtime.logout(provider, id)).rejects.toThrow();
    expect(auth.credentials.list(provider)).toHaveLength(1);
  } finally {
    auth.close();
    if (
      resolve(dir).startsWith(resolve(tmpdir())) &&
      basename(dir).startsWith("jizura-auth-scope-")
    )
      await rm(dir, { recursive: true, force: true });
  }
});
test("known custom model providers stay visible with zero available models", async () => {
  const { accountMetadata } = await import("./omp");
  const auth: any = {
    credentials: {
      list: (provider: string) =>
        provider === "custom-disabled"
          ? [{ id: 4, provider, credential: { type: "api_key", key: "fake" } }]
          : [],
    },
    oauth: { accounts: () => [] },
    keys: { source: () => undefined },
  };
  const metadata = accountMetadata(
    auth,
    [],
    [],
    [{ provider: "custom-disabled", id: "disabled-model" }],
  );
  expect(metadata.providers).toHaveLength(1);
  expect(metadata.providers[0].id).toBe("custom-disabled");
  expect(metadata.providers[0].modelCount).toBe(0);
});
