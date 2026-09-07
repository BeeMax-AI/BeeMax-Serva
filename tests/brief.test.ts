import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seed } from "../server/src/seed.ts";
import { briefData } from "../server/src/brief-data.ts";
import { renderBrief } from "../server/src/brief-pdf.ts";
import { Store } from "../server/src/store.ts";
import { createApp } from "../server/src/http.ts";
import type { Ticket } from "../shared/domain.ts";
const now = new Date("2026-09-07T12:00:00+08:00");
const ticket = (patch: Partial<Ticket> = {}): Ticket => ({
  id: "t",
  subject: "服务请求",
  reference: "A",
  type: "报修",
  groupId: "g",
  assigneeId: null,
  status: "DISPATCHED",
  priority: "中",
  createdAt: "2026-09-07T00:00:00+08:00",
  acceptedAt: null,
  closedAt: null,
  version: 1,
  events: [],
  ...patch,
});
test("brief separates period flows from current backlog and respects UTC+8 boundaries", () => {
  const w = seed("test");
  w.tickets = [
    ticket(),
    ticket({
      createdAt: "2026-09-06T15:59:59Z",
      status: "CLOSED",
      closedAt: "2026-09-07T03:00:00Z",
    }),
    ticket({ createdAt: "invalid" }),
    ticket({ createdAt: "2026-09-07T04:00:01Z" }),
    ticket({
      createdAt: "2026-09-07T01:00:00Z",
      status: "CLOSED",
      closedAt: "2026-09-06T01:00:00Z",
    }),
  ];
  const data = briefData(w, "2026-09-07", "2026-09-07", now);
  assert.equal(data.created, 2);
  assert.equal(data.closed, 1);
  assert.equal(data.open, 3);
  assert.deepEqual(data.trend, [{ date: "2026-09-07", created: 2, closed: 1 }]);
  assert.equal(
    data.types.reduce((sum, row) => sum + row.value, 0),
    data.created,
  );
});
test("brief ranks attention and staff using valid period acceptances with current load", () => {
  const w = seed("test");
  w.people = [];
  w.groups = [{ id: "g", name: "服务组" }];
  w.tickets = [
    ticket({ id: "held", status: "ON_HOLD", assigneeId: "a" }),
    ticket({ id: "new", status: "NO_ACCEPT" }),
    ticket({
      id: "urgent",
      status: "ESCALATED_L2",
      assigneeId: "a",
      acceptedAt: "2026-09-07T01:00:00+08:00",
    }),
    ticket({
      id: "closed",
      status: "CLOSED",
      assigneeId: "b",
      createdAt: "2026-09-06T00:00:00+08:00",
      acceptedAt: "2026-09-07T00:00:00+08:00",
      closedAt: "2026-09-07T02:00:00+08:00",
    }),
    ticket({
      id: "bad",
      status: "CLOSED",
      assigneeId: "c",
      acceptedAt: "2026-09-06T00:00:00+08:00",
    }),
  ];
  const data = briefData(w, "2026-09-07", "2026-09-07", now);
  assert.deepEqual(
    data.attention.map((t) => t.id),
    ["urgent", "new", "held"],
  );
  assert.deepEqual(
    data.staff.map((p) => [p.id, p.accepted, p.open]),
    [
      ["a", 1, 2],
      ["b", 1, 0],
    ],
  );
});
test("brief renders a real two-page PDF for empty and dense Chinese content", async () => {
  const w = seed("test");
  w.tenant.name = "中文服务团队";
  w.tickets = [];
  for (const dense of [false, true]) {
    if (dense)
      w.tickets = Array.from({ length: 35 }, (_, i) =>
        ticket({
          id: `request-${i}`,
          subject: "这是一个较长的中文服务问题说明".repeat(30),
          type: `分类${i}`,
          groupId: `group${i}`,
          assigneeId: `人员${i}`,
          status: "NO_ACCEPT",
        }),
      );
    const pdf = await renderBrief(
      briefData(w, "2026-08-09", "2026-09-07", now),
      process.cwd(),
    );
    assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
    assert.match(pdf.toString("latin1"), /\/Count 2\b/);
    assert.match(pdf.toString("latin1"), /\/FontFile3\b/);
    assert.ok(pdf.length > 10000);
  }
});
test("PDF endpoint requires login, validates dates and scopes exports to the actor tenant", async () => {
  const dir = mkdtempSync(join(tmpdir(), "serva-brief-"));
  const store = new Store(dir);
  store.initialize();
  const w = store.read("demo");
  w.tenant.name = "ONLY-DEMO-TENANT";
  store.save(w);
  const other = store.read("other");
  other.tenant.name = "ONLY-OTHER-TENANT";
  store.save(other);
  const reads: string[] = [];
  const readWorkspace = store.read.bind(store);
  store.read = (tenant) => {
    reads.push(tenant);
    return readWorkspace(tenant);
  };
  const app = createApp(store, process.cwd(), "local");
  await new Promise<void>((r) => app.server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
  const cookie = (tenantId: string) =>
    "qf_session=" +
    store.createSession({
      id: tenantId === "demo" ? "viewer" : "other",
      name: "Reader",
      role: "viewer",
      tenantId,
    });
  const get = (query = "", tenant = "demo") =>
    fetch(base + "/api/brief.pdf" + query, {
      headers: { Cookie: cookie(tenant) },
    });
  try {
    assert.equal((await fetch(base + "/api/brief.pdf")).status, 401);
    for (const q of [
      "?start=bad",
      "?start=2026-02-30&end=2026-03-01",
      "?start=2020-01-01&end=2020-02-01",
      "?start=2020-01-02&end=2020-01-01",
      "?end=9999-01-01",
    ])
      assert.equal((await get(q)).status, 400);
    assert.equal(
      (
        await fetch(base + "/api/brief.pdf", {
          method: "POST",
          headers: { Origin: base, Cookie: cookie("demo") },
        })
      ).status,
      405,
    );
    for (const tenant of ["demo", "other"]) {
      reads.length = 0;
      const response = await get("?start=2020-01-01&end=2020-01-31", tenant);
      assert.ok(reads.length > 0);
      assert.ok(reads.every((id) => id === tenant));
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), "application/pdf");
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.match(response.headers.get("content-disposition")!, /attachment/);
      const pdf = Buffer.from(await response.arrayBuffer());
      assert.equal(pdf.length, Number(response.headers.get("content-length")));
      const raw = pdf.toString("latin1");
      const title = (name: string) =>
        Buffer.from(name, "utf16le").swap16().toString("latin1");
      assert.ok(raw.includes(title("运营简报")));
      for (const name of ["ONLY-DEMO-TENANT", "ONLY-OTHER-TENANT"])
        assert.ok(!raw.includes(title(name)));
    }
  } finally {
    await new Promise<void>((r) => app.server.close(() => r()));
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
