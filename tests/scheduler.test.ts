import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/src/store.ts";
import { LocalProvider } from "../server/src/provider.ts";
import { AnalysisService } from "../server/src/ai.ts";
import type { Actor } from "../shared/domain.ts";
test("due plans run once, advance nextRun and retain reports after another scheduler tick", async (t) => {
  t.mock.timers.enable({
    apis: ["Date"],
    now: new Date("2026-09-06T02:00:00Z"),
  });
  const dir = mkdtempSync(join(tmpdir(), "qf-scheduler-")),
    store = new Store(dir);
  store.initialize();
  const provider = new LocalProvider(store),
    service = new AnalysisService(provider),
    actor: Actor = {
      id: "admin",
      name: "Admin",
      role: "admin",
      tenantId: "demo",
    };
  try {
    t.mock.timers.setTime(Date.parse("2026-09-07T01:00:00Z"));
    await service.tick();
    const first = await provider.read(actor);
    assert.equal(first.reports.filter((r) => r.planId === "daily").length, 1);
    assert.equal(first.reports.filter((r) => r.planId === "weekly").length, 1);
    assert.equal(
      first.plans.find((p) => p.id === "daily")!.nextRun,
      "2026-09-08T00:30:00.000Z",
    );
    await service.tick();
    assert.equal(
      (await provider.read(actor)).reports.length,
      first.reports.length,
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
    t.mock.timers.reset();
  }
});
