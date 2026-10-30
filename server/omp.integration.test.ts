import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve, basename } from "node:path";
import { tmpdir } from "node:os";
import { runRestrictedSession, createOmpRuntime } from "./omp";
import { GROUPS, validateRequest } from "./validation";

test("real SDK sends a tool-free request to a simulated loopback OpenAI provider and disposes", async () => {
  const sdk = await import("@oh-my-pi/pi-coding-agent");
  const temporary = await mkdtemp(join(tmpdir(), "jizura-sdk-test-"));
  const plan = {
    summary: "Simulated arrangement",
    lines: [{ index: 0, reason: "Fixture readability", layout: "plain" }],
  };
  const payloads: any[] = [];
  const fixture = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      expect(new URL(request.url).pathname).toBe("/v1/chat/completions");
      const payload = await request.json();
      payloads.push(payload);
      const chunk = (delta: any, finish_reason: string | null = null) => ({
        id: "fixture-completion",
        object: "chat.completion.chunk",
        created: 1,
        model: "fixture-model",
        choices: [{ index: 0, delta, finish_reason }],
      });
      return new Response(
        [
          chunk({ role: "assistant", content: "" }),
          chunk({ content: JSON.stringify(plan) }),
          chunk({}, "stop"),
        ]
          .map((data) => `data: ${JSON.stringify(data)}\n\n`)
          .join("") + "data: [DONE]\n\n",
        { headers: { "content-type": "text/event-stream" } },
      );
    },
  });
  let auth: InstanceType<typeof sdk.AuthStorage> | undefined;
  let session: any;
  let disposed = 0;
  try {
    auth = await sdk.AuthStorage.create(join(temporary, "auth.db"));
    // The SDK's prompt preflight uses registry auth even with getApiKey supplied.
    // This temporary in-memory override contains no real provider credentials.
    auth.keys.setRuntime("jizura-fixture", "harmless-loopback-fixture-key");
    const settings = sdk.Settings.isolated({
      "compaction.enabled": false,
      "retry.enabled": false,
      "advisor.enabled": false,
      "autolearn.enabled": false,
      "providers.cacheWarming": "off",
    });
    const registry = new sdk.ModelRegistry(
      auth,
      join(temporary, "models.yml"),
      { settings },
    );
    const model = {
      id: "fixture-model",
      name: "Local simulated model",
      api: "openai-completions",
      provider: "jizura-fixture",
      baseUrl: `http://127.0.0.1:${fixture.port}/v1`,
      identity: { class: "unknown" },
      compat: {},
      reasoning: false,
      input: ["text"],
      contextWindow: 32000,
      maxTokens: 4000,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    };
    const request = validateRequest({
      provider: model.provider,
      model: model.id,
      direction: "gentle",
      lines: [
        {
          index: 0,
          text: "Local fixture lyrics",
          start: 0,
          end: 1,
          locked: false,
        },
      ],
      catalog: Object.fromEntries(
        GROUPS.map((group) => [group, [{ id: "plain", name: "Plain" }]]),
      ),
    });
    const create = async (options: any) => {
      const result = await sdk.createAgentSession(options);
      session = result.session;
      const dispose = session.dispose.bind(session);
      session.dispose = async (...args: any[]) => {
        disposed++;
        return dispose(...args);
      };
      return result;
    };
    const result = await runRestrictedSession(
      create,
      {
        cwd: temporary,
        agentDir: temporary,
        model,
        settings,
        authStorage: auth,
        modelRegistry: registry,
        getApiKey: () => "harmless-loopback-fixture-key",
        sessionManager: sdk.SessionManager.inMemory(temporary),
        deadline: Date.now() + 15000,
      },
      request,
      AbortSignal.timeout(15000),
    );
    expect(result).toEqual(plan);
    expect(payloads.length).toBe(1);
    expect(payloads[0].model).toBe("fixture-model");
    expect(payloads[0].tools ?? []).toEqual([]);
    expect(
      payloads[0].messages.some((message: any) =>
        JSON.stringify(message.content).includes("Local fixture lyrics"),
      ),
    ).toBe(true);
    expect(disposed).toBe(1);
    expect(session.isDisposed).toBe(true);
  } finally {
    if (session && !disposed) await session.dispose();
    auth?.close();
    fixture.stop(true);
    if (
      resolve(temporary).startsWith(resolve(tmpdir())) &&
      basename(temporary).startsWith("jizura-sdk-test-")
    )
      await rm(temporary, { recursive: true, force: true });
  }
}, 30000);

test("model refresh observes another auth writer and models/settings changes without inference", async () => {
  const sdk = await import("@oh-my-pi/pi-coding-agent");
  const temporary = await mkdtemp(join(tmpdir(), "jizura-sdk-test-"));
  const reader = await sdk.AuthStorage.create(join(temporary, "auth.db"));
  const writer = await sdk.AuthStorage.create(join(temporary, "auth.db"));
  const provider = "jizura-refresh-fixture";
  const writeModels = (id: string) =>
    writeFile(
      join(temporary, "models.yml"),
      JSON.stringify({
        providers: {
          [provider]: {
            api: "openai-completions",
            auth: "oauth",
            baseUrl: "http://127.0.0.1:1/v1",
            models: [{ id, name: id }],
          },
        },
      }),
    );
  try {
    await writeModels("before-login");
    const runtime = createOmpRuntime({
      agentDir: temporary,
      cwd: temporary,
      authStorage: reader,
    });
    expect(
      (await runtime.listModels()).filter((m) => m.provider === provider),
    ).toEqual([]);
    await writer.credentials.set(provider, {
      type: "api_key",
      key: "harmless-fixture-key",
    });
    expect(
      (await runtime.listModels())
        .filter((m) => m.provider === provider)
        .map((m) => m.id),
    ).toEqual(["before-login"]);
    await writeModels("changed-model");
    expect(
      (await runtime.listModels())
        .filter((m) => m.provider === provider)
        .map((m) => m.id),
    ).toEqual(["changed-model"]);
    await writeFile(
      join(temporary, "config.yml"),
      JSON.stringify({ disabledProviders: [provider] }),
    );
    expect(
      (await runtime.listModels()).filter((m) => m.provider === provider),
    ).toEqual([]);
    await writeFile(join(temporary, "config.yml"), "{}\n");
    await writer.credentials.remove(provider);
    expect(
      (await runtime.listModels()).filter((m) => m.provider === provider),
    ).toEqual([]);
  } finally {
    reader.close();
    writer.close();
    if (
      resolve(temporary).startsWith(resolve(tmpdir())) &&
      basename(temporary).startsWith("jizura-sdk-test-")
    )
      await rm(temporary, { recursive: true, force: true });
  }
}, 30000);
