import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../server/src/store.ts";
import { LocalProvider } from "../server/src/provider.ts";
import { AnalysisService } from "../server/src/ai.ts";
import { businessDate } from "../server/src/dates.ts";
import type { Actor } from "../shared/domain.ts";
test("model-backed reports preserve intervening writes and failures do not save fabricated reports", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qf-model-")),
    store = new Store(dir);
  store.initialize();
  const provider = new LocalProvider(store),
    analysis = new AnalysisService(provider),
    actor: Actor = {
      id: "admin",
      name: "Admin",
      tenantId: "demo",
      role: "admin",
    };
  let status = 200,
    release: (() => void) | undefined,
    arrive: (() => void) | undefined;
  const arrived = new Promise<void>((resolve) => (arrive = resolve));
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const payload = JSON.parse(body);
    assert.equal(payload.model, "test-model");
    assert.equal(req.headers.authorization, "Bearer fixture-key");
    if (status === 200) {
      arrive?.();
      await new Promise<void>((resolve) => (release = resolve));
    }
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(
      status === 200
        ? JSON.stringify({
            choices: [
              { message: { content: "来自测试模型的分析，数据覆盖不足。" } },
            ],
          })
        : JSON.stringify({ error: "provider failed" }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const saved = {
    url: process.env.AI_BASE_URL,
    key: process.env.AI_API_KEY,
    model: process.env.AI_MODEL,
  };
  process.env.AI_BASE_URL =
    "http://127.0.0.1:" + (server.address() as { port: number }).port + "/v1/";
  process.env.AI_API_KEY = "fixture-key";
  process.env.AI_MODEL = "test-model";
  try {
    const pending = analysis.generate(
      actor,
      { start: businessDate(), end: businessDate() },
      "model-fixture",
    );
    await arrived;
    const before = await provider.read(actor);
    await provider.command(actor, {
      type: "parameters.save",
      data: {
        escalationMinutes: 42,
        acceptReminderMinutes: 7,
        holdReminderMinutes: 12,
      },
      expectedRevision: before.revision,
      requestId: randomUUID(),
    });
    release!();
    const report = await pending;
    assert.equal(report.mode, "model");
    assert.ok(report.summary.includes("测试模型"));
    const after = await provider.read(actor);
    assert.equal(after.parameters.escalationMinutes, 42);
    assert.equal(after.reports.length, 1);
    status = 503;
    await assert.rejects(
      () =>
        analysis.generate(
          actor,
          { start: businessDate(), end: businessDate() },
          "failed-fixture",
        ),
      /模型服务暂时不可用/,
    );
    assert.equal((await provider.read(actor)).reports.length, 1);
  } finally {
    for (const [key, value] of [
      ["AI_BASE_URL", saved.url],
      ["AI_API_KEY", saved.key],
      ["AI_MODEL", saved.model],
    ])
      if (value === undefined) delete process.env[key!];
      else process.env[key!] = value;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
