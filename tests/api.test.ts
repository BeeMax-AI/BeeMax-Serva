import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../server/src/store.ts";
import { createApp } from "../server/src/http.ts";
import type { Bootstrap, Plan } from "../shared/domain.ts";
let dir: string,
  store: Store,
  app: ReturnType<typeof createApp>,
  base: string,
  passwords: Record<string, string>,
  cookies: Record<string, string> = {};
async function request(
  path: string,
  method = "GET",
  data?: unknown,
  user = "admin",
  origin = true,
) {
  return fetch(base + "/api" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(origin ? { Origin: base } : {}),
      ...(cookies[user] ? { Cookie: cookies[user] } : {}),
    },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
}
async function bootstrap(user = "admin"): Promise<Bootstrap> {
  const response = await request("/bootstrap", "GET", undefined, user);
  assert.equal(response.status, 200);
  return response.json();
}
async function write(
  type: string,
  data: Record<string, unknown>,
  user = "admin",
  extra: Record<string, unknown> = {},
) {
  const boot = await bootstrap(user);
  return request(
    "/commands",
    "POST",
    {
      type,
      data,
      expectedRevision: boot.workspace.revision,
      requestId: randomUUID(),
      ...extra,
    },
    user,
  );
}
before(async () => {
  dir = mkdtempSync(join(tmpdir(), "qf-api-"));
  store = new Store(dir);
  store.initialize();
  passwords = JSON.parse(readFileSync(join(dir, "access.json"), "utf8"));
  app = createApp(store, process.cwd(), "local");
  await new Promise<void>((resolve) =>
    app.server.listen(0, "127.0.0.1", resolve),
  );
  base = "http://127.0.0.1:" + (app.server.address() as { port: number }).port;
  for (const username of ["admin", "owner", "viewer", "other"]) {
    const res = await request(
      "/login",
      "POST",
      { username, password: passwords[username] },
      "none",
    );
    assert.equal(res.status, 200);
    cookies[username] = res.headers.get("set-cookie")!.split(";")[0];
  }
});
after(async () => {
  await new Promise<void>((resolve, reject) =>
    app.server.close((e) => (e ? reject(e) : resolve())),
  );
  store.close();
  rmSync(dir, { recursive: true, force: true });
});
test("anonymous requests cannot read workspace records", async () => {
  assert.equal(
    (await request("/bootstrap", "GET", undefined, "none")).status,
    401,
  );
});
test("mutations require the same origin", async () => {
  assert.equal(
    (await request("/logout", "POST", {}, "viewer", false)).status,
    403,
  );
});
test("wrong password fails without creating a session", async () => {
  const r = await request("/login", "POST", {
    username: "admin",
    password: "wrong",
  });
  assert.equal(r.status, 401);
  assert.equal(r.headers.get("set-cookie"), null);
});
test("viewer cannot write even if it submits owner in the payload", async () => {
  const r = await write(
    "parameters.save",
    {
      escalationMinutes: 30,
      acceptReminderMinutes: 5,
      holdReminderMinutes: 10,
      role: "owner",
    },
    "viewer",
  );
  assert.equal(r.status, 403);
});
test("credential writes require owner and plaintext never appears in bootstrap or audit", async () => {
  const denied = await write(
    "credentials.save",
    { token: "secret-test" },
    "admin",
  );
  assert.equal(denied.status, 403);
  const saved = await write(
    "credentials.save",
    {
      token: "secret-test-token",
      password: "secret-test-password",
      account: "test-owner",
    },
    "owner",
  );
  assert.equal(saved.status, 200);
  const b = await bootstrap("owner"),
    serialized = JSON.stringify(b);
  assert.equal(b.workspace.credentials.configured, true);
  assert.equal(b.workspace.credentials.accountMask, "t****");
  assert.ok(!serialized.includes("secret-test"));
});
test("configuration changes survive a separate storage connection", async () => {
  assert.equal(
    (
      await write("parameters.save", {
        escalationMinutes: 27,
        acceptReminderMinutes: 7,
        holdReminderMinutes: 12,
      })
    ).status,
    200,
  );
  const second = new Store(dir),
    secondApp = createApp(second, process.cwd(), "local");
  await new Promise<void>((resolve) =>
    secondApp.server.listen(0, "127.0.0.1", resolve),
  );
  const address =
    "http://127.0.0.1:" + (secondApp.server.address() as { port: number }).port;
  const response = await fetch(address + "/api/bootstrap", {
      headers: { Cookie: cookies.admin },
    }),
    b = (await response.json()) as Bootstrap;
  assert.equal(b.workspace.parameters.escalationMinutes, 27);
  assert.ok(b.workspace.audit.some((a) => a.action === "parameters.save"));
  await new Promise<void>((resolve) => secondApp.server.close(() => resolve()));
  second.close();
});
test("tenant ownership comes from the session, not a client tenantId", async () => {
  await write("account.save", {
    name: "Isolated customer account",
    company: "Own tenant",
    tenantId: "other",
  });
  assert.ok(
    (await bootstrap()).workspace.accounts.some(
      (a) => a.name === "Isolated customer account",
    ),
  );
  assert.ok(
    !(await bootstrap("other")).workspace.accounts.some(
      (a) => a.name === "Isolated customer account",
    ),
  );
});
test("duplicate request IDs do not repeat operations; conflicts cannot overwrite fresh data", async () => {
  const b = await bootstrap(),
    payload = {
      type: "account.save",
      data: { name: "Idempotent account", company: "Demo" },
      expectedRevision: b.workspace.revision,
      requestId: randomUUID(),
    };
  const first = await request("/commands", "POST", payload),
    second = await request("/commands", "POST", payload);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.deepEqual(await first.json(), await second.json());
  const rows = (await bootstrap()).workspace.accounts.filter(
    (a) => a.name === "Idempotent account",
  );
  assert.equal(rows.length, 1);
  assert.equal(
    (
      await request("/commands", "POST", {
        ...payload,
        requestId: randomUUID(),
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await request("/commands", "POST", {
        ...payload,
        data: { name: "Altered", company: "Demo" },
      })
    ).status,
    409,
  );
});
test("invalid group relationships and bad parameter values are rejected", async () => {
  assert.equal(
    (
      await write("route.save", {
        type: "Support",
        keywords: "help",
        groupId: "missing",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await write("parameters.save", {
        escalationMinutes: -1,
        acceptReminderMinutes: 5,
        holdReminderMinutes: 10,
      })
    ).status,
    400,
  );
});
test("authorization is per instance and duplicate chat IDs are rejected within one instance", async () => {
  assert.equal(
    (
      await write("group.add", {
        accountId: "a1",
        chatId: "test-group",
        name: "Test",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await write("group.add", {
        accountId: "a1",
        chatId: "test-group",
        name: "Again",
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await write("group.add", {
        accountId: "a2",
        chatId: "test-group",
        name: "Other instance",
      })
    ).status,
    200,
  );
  assert.equal(
    (await write("group.remove", { accountId: "a1", chatId: "test-group" }))
      .status,
    200,
  );
  assert.ok(
    (await bootstrap()).workspace.accounts
      .find((a) => a.id === "a2")!
      .groups.some((g) => g.id === "test-group"),
  );
});
test("ticket completion updates timeline, list and metrics; closed tickets reject further commands", async () => {
  const before = await bootstrap(),
    open = before.metrics.open;
  assert.equal(
    (await write("ticket.action", { id: "E174", action: "complete" })).status,
    200,
  );
  const detail = await (await request("/tickets/E174")).json(),
    after = await bootstrap();
  assert.equal(detail.status, "CLOSED");
  assert.equal(detail.events.at(-1).name, "完成");
  assert.equal(after.metrics.open, open - 1);
  assert.equal(
    after.workspace.tickets.find((t) => t.id === "E174")!.status,
    "CLOSED",
  );
  assert.equal(
    (await write("ticket.action", { id: "E174", action: "urge" })).status,
    409,
  );
});
test("hold requires a future reminder and resume only accepts held tickets", async () => {
  assert.equal(
    (
      await write("ticket.action", {
        id: "E171",
        action: "hold",
        reason: "Waiting",
        remindAt: "2000-01-01T00:00:00Z",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await write("ticket.action", {
        id: "E171",
        action: "hold",
        reason: "Waiting",
        remindAt: new Date(Date.now() + 3600000).toISOString(),
      })
    ).status,
    200,
  );
  assert.equal(
    (await write("ticket.action", { id: "E171", action: "resume" })).status,
    200,
  );
  assert.equal(
    (await write("ticket.action", { id: "E171", action: "resume" })).status,
    409,
  );
});
test("message query is paginated and searches linked ticket IDs", async () => {
  const r = await request("/messages?q=E169&size=1&page=2"),
    data = await r.json();
  assert.equal(data.total, 2);
  assert.equal(data.items.length, 1);
  assert.equal(data.items[0].ticketId, "E169");
});
test("analysis reports are persisted and duplicate runs do not add extra reports", async () => {
  const b = await bootstrap(),
    payload = {
      start: b.workspace.coverageStart,
      end: b.today,
      requestId: randomUUID(),
    };
  const r = await request("/reports", "POST", payload);
  assert.equal(r.status, 201);
  const report = await r.json(),
    again = await (await request("/reports", "POST", payload)).json();
  assert.equal(report.id, again.id);
  assert.equal(report.mode, "rules");
  assert.equal(
    (await bootstrap()).workspace.reports.filter((r) => r.id === report.id)
      .length,
    1,
  );
  assert.equal(
    (await request("/reports", "POST", { ...payload, start: "2026-01-01" }))
      .status,
    409,
  );
});
test("analysis validates date bounds and viewer permissions", async () => {
  const b = await bootstrap();
  assert.equal(
    (
      await request("/reports", "POST", {
        start: b.today,
        end: "2099-01-01",
        requestId: randomUUID(),
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request(
        "/reports",
        "POST",
        { start: b.today, end: b.today, requestId: randomUUID() },
        "viewer",
      )
    ).status,
    403,
  );
});
test("chat is private per actor, persists history, and never mutates tickets", async () => {
  const r = await request("/chat", "POST", { question: "催办 E169" }),
    conversation = await r.json();
  assert.equal(r.status, 200);
  assert.equal(conversation.messages.length, 2);
  assert.ok(conversation.messages[1].text.includes("不会直接修改工单"));
  assert.ok(
    (await bootstrap()).conversations.some((c) => c.id === conversation.id),
  );
  assert.ok(
    !(await bootstrap("owner")).conversations.some(
      (c) => c.id === conversation.id,
    ),
  );
  assert.equal(
    (
      await request(
        "/chat",
        "POST",
        { question: "查看", conversationId: conversation.id },
        "owner",
      )
    ).status,
    404,
  );
});
test("schedule configuration persists and validates supported frequencies", async () => {
  const b = await bootstrap(),
    p = {
      ...b.workspace.plans[0],
      name: "Test interval",
      id: undefined,
      frequency: "interval",
      every: 10,
      range: "rolling",
      rangeDays: 30,
    };
  const response = await write("plan.save", p);
  assert.equal(response.status, 200);
  const saved = (await bootstrap()).workspace.plans.find(
    (p) => p.name === "Test interval",
  )!;
  assert.ok(Date.parse(saved.nextRun) > Date.now());
  assert.equal(
    (await write("plan.save", { ...p, frequency: "every-moment" })).status,
    400,
  );
});
test("MCP pending mode fails closed rather than returning local records", async () => {
  const pending = createApp(store, process.cwd(), "mcp");
  await new Promise<void>((resolve) =>
    pending.server.listen(0, "127.0.0.1", resolve),
  );
  const url =
    "http://127.0.0.1:" + (pending.server.address() as { port: number }).port;
  const response = await fetch(url + "/api/bootstrap", {
    headers: { Cookie: cookies.admin },
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, "MCP_NOT_CONFIGURED");
  await new Promise<void>((resolve) => pending.server.close(() => resolve()));
});
test("reassignment preserves the original acceptance timestamp and response sample", async () => {
  const before = await (await request("/tickets/E169")).json();
  assert.ok(before.acceptedAt);
  assert.equal(
    (
      await write("ticket.action", {
        id: "E169",
        action: "reassign",
        groupId: "repair",
        assigneeId: "p2",
      })
    ).status,
    200,
  );
  const after = await (await request("/tickets/E169")).json();
  assert.equal(after.acceptedAt, before.acceptedAt);
  assert.equal(after.assigneeId, "p2");
  assert.equal(
    (
      await write("ticket.action", {
        id: "E169",
        action: "reassign",
        groupId: "repair",
        assigneeId: "",
      })
    ).status,
    200,
  );
  assert.equal(
    (await (await request("/tickets/E169")).json()).acceptedAt,
    before.acceptedAt,
  );
});
test("completed follow-up stays completed across later reports and historical copies", async () => {
  const b = await bootstrap(),
    generate = async () => {
      const response = await request("/reports", "POST", {
        start: b.workspace.coverageStart,
        end: b.today,
        requestId: randomUUID(),
      });
      assert.equal(response.status, 201);
      return response.json();
    };
  const first = await generate();
  assert.ok(first.advice.some((a: { id: string }) => a.id === "backlog"));
  assert.equal(
    (
      await write("advice.update", {
        id: "backlog",
        reportId: first.id,
        status: "following",
        ownerId: "p1",
        reviewAt: b.today,
      })
    ).status,
    200,
  );
  const second = await generate();
  assert.equal(second.advice[0].status, "following");
  assert.equal(
    (
      await write("advice.update", {
        id: "backlog",
        reportId: second.id,
        status: "done",
      })
    ).status,
    200,
  );
  const third = await generate();
  assert.equal(third.advice[0].status, "done");
  assert.ok(
    (await bootstrap()).workspace.reports
      .flatMap((r) => r.advice)
      .filter((a) => a.id === "backlog")
      .every((a) => a.status === "done"),
  );
});
test("assistant resolves selected report and ticket context on the server", async () => {
  const b = await bootstrap(),
    report = b.workspace.reports[0];
  const response = await request("/chat", "POST", {
      question: "这份报告建议我做什么？",
      context: { page: "insights", reportId: report.id },
    }),
    conversation = await response.json();
  assert.equal(response.status, 200);
  assert.ok(
    conversation.messages[1].text.includes(report.start + " — " + report.end),
  );
  assert.equal(conversation.messages[0].context.reportId, report.id);
  const ticket = await (
    await request("/chat", "POST", {
      question: "这单现在是什么状态？",
      context: { page: "tickets", ticketId: "E169" },
    })
  ).json();
  assert.deepEqual(ticket.messages[1].ticketIds, ["E169"]);
  assert.equal(
    (
      await request(
        "/chat",
        "POST",
        { question: "读取报告", context: { reportId: report.id } },
        "other",
      )
    ).status,
    404,
  );
});
