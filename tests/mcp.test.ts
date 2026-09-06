import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpClient } from "../server/src/mcp-client.ts";
import { McpProvider } from "../server/src/mcp-provider.ts";
import { Store } from "../server/src/store.ts";
import { AnalysisService } from "../server/src/ai.ts";
import type { Actor } from "../shared/domain.ts";
const actor: Actor = {
  id: "operator",
  name: "测试管理员",
  role: "admin",
  tenantId: "test",
};
async function fixture(t: any, sse = false) {
  const dir = mkdtempSync(join(tmpdir(), "qf-mcp-")),
    store = new Store(dir);
  const rows: any[] = [
    {
      id: "T260906-G001",
      status: "ACCEPTED",
      type: "咨询",
      room: "A101",
      group_id: "service",
      priority: "中",
      assignee: "测试人员",
      created_at: 1788673235152,
      accepted_at: 1788673346676,
      closed_at: null,
    },
  ];
  const calls: any[] = [];
  let failing = false,
    writeFails = false;
  const server = createServer(async (req, res) => {
    let text = "";
    for await (const c of req) text += c;
    const request = JSON.parse(text);
    calls.push(request);
    if (failing) {
      res.writeHead(503);
      res.end("secret fixture-token");
      return;
    }
    const names = [
      "list_tickets",
      "ticket_stats",
      "get_roster",
      "get_routing_rules",
      "get_config",
      "get_ticket",
      "set_config",
      "urge_ticket",
      "hold_ticket",
      "resume_ticket",
      "reassign_ticket",
      "complete_ticket",
    ];
    const name = request.params?.name,
      args = request.params?.arguments;
    let result: any;
    if (request.method === "initialize")
      result = {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "fixture", version: "1" },
      };
    else if (request.method === "notifications/initialized") {
      res.writeHead(202);
      res.end();
      return;
    } else if (request.method === "tools/list")
      result = {
        tools: names.map((name) => ({ name, inputSchema: { type: "object" } })),
      };
    else {
      let value: any;
      if (name === "list_tickets") value = rows;
      else if (name === "ticket_stats")
        value = {
          total: rows.length,
          open: rows.filter((r) => r.status !== "CLOSED").length,
        };
      else if (name === "get_roster")
        value = {
          default: {
            service: { l1: [{ name: "测试人员", userid: "person1" }] },
          },
        };
      else if (name === "get_routing_rules")
        value = {
          effective: { 咨询: "service" },
          learned: { subjectRules: [] },
        };
      else if (name === "get_config")
        value = (
          {
            groups: { service: { name: "客服沟通群" } },
            escalation: {
              intervalMinutes: 10,
              acceptedReminder: { hours: 4 },
              holdReminderLeadMinutes: 30,
            },
            "transferLearning.autoApply": true,
            "routingShadow.enabled": false,
          } as any
        )[args.path];
      else if (name === "get_ticket")
        value = {
          ...rows.find((r) => r.id === args.id),
          content: "真实详情内容",
          events: [
            { ts: 1788673235152, event: "created", detail: { by: "接口测试" } },
          ],
        };
      else {
        if (writeFails) {
          req.socket.destroy();
          return;
        }
        value = { ok: true };
      }
      result = { content: [{ type: "text", text: JSON.stringify(value) }] };
    }
    res.setHeader("mcp-session-id", "fixture-session");
    if (sse) {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(
        "event: message\r\ndata: " +
          JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) +
          "\r\n\r\n",
      );
    } else {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const config = {
    url: `http://127.0.0.1:${(server.address() as any).port}/mcp?token=fixture-token`,
    tenantId: "test",
    tenantName: "测试客户",
  };
  const provider = new McpProvider(store, config);
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return {
    provider,
    store,
    config,
    calls,
    rows,
    setFail: () => (failing = true),
    setWriteFail: () => (writeFails = true),
  };
}
test("MCP JSON/SSE reads real schema, full details, private metadata, and tenant isolation", async (t) => {
  const f = await fixture(t, true),
    w = await f.provider.read(actor);
  assert.equal(w.tenant.name, "测试客户");
  assert.equal(w.tickets[0].id, "T260906-G001");
  assert.equal(w.parameters.acceptReminderMinutes, 240);
  assert.equal(w.accounts.length, 0);
  assert.equal(w.people[0].active, false);
  assert.match(w.people[0].scheduleLabel!, /非实时/);
  assert.equal(
    (await f.provider.getTicket(actor, w.tickets[0].id))?.subject,
    "真实详情内容",
  );
  const before = f.calls.length;
  await assert.rejects(
    f.provider.read({ ...actor, tenantId: "other" }),
    /尚未配置/,
  );
  assert.equal(f.calls.length, before);
  const serialized = JSON.stringify(w);
  assert.ok(!serialized.includes("fixture-token"));
  assert.ok(!serialized.includes("demo"));
  const analysis = new AnalysisService(f.provider);
  const report = await analysis.generate(
    actor,
    { start: "2026-09-06", end: "2026-09-06" },
    "test-report",
  );
  assert.ok(!report.coverage.includes("本地样例"));
  assert.equal(f.provider.readDashboard(actor).reports.length, 1);
  assert.equal(f.provider.readDashboard(actor).tickets.length, 0);
  assert.deepEqual(f.provider.analysisTenantIds(), ["test"]);
});
test("MCP denies stale revisions and unsupported writes before dispatch; duplicate successful command runs once", async (t) => {
  const f = await fixture(t),
    w = await f.provider.read(actor);
  const c = {
    type: "ticket.action",
    data: { id: w.tickets[0].id, action: "urge" },
    expectedRevision: w.revision,
    requestId: "one",
  };
  await assert.rejects(
    f.provider.command({ ...actor, role: "viewer" }, c),
    /查看权限/,
  );
  await assert.rejects(
    f.provider.command(actor, { ...c, expectedRevision: 1 }),
    /数据已更新/,
  );
  await assert.rejects(
    f.provider.command(actor, { ...c, type: "route.save" }),
    /尚未提供/,
  );
  await f.provider.command(actor, c);
  await f.provider.command(actor, c);
  const writes = f.calls.filter((c) => c.params?.name === "urge_ticket");
  assert.equal(writes.length, 1);
  assert.equal(writes[0].params.arguments.short, "G001");
  assert.equal(f.provider.readDashboard(actor).tickets.length, 0);
});
test("MCP ambiguous failure is persisted and never retried; network errors do not expose endpoint credentials", async (t) => {
  const f = await fixture(t),
    w = await f.provider.read(actor);
  f.setWriteFail();
  const c = {
    type: "ticket.action",
    data: { id: w.tickets[0].id, action: "urge" },
    expectedRevision: w.revision,
    requestId: "uncertain",
  };
  await assert.rejects(f.provider.command(actor, c), /结果尚未确认/);
  await assert.rejects(f.provider.command(actor, c), /结果待核对/);
  assert.equal(
    f.calls.filter((c) => c.params?.name === "urge_ticket").length,
    1,
  );
  f.setFail();
  await assert.rejects(
    new McpClient(f.config).call("list_tickets"),
    (e) =>
      e instanceof Error &&
      !e.message.includes("fixture-token") &&
      !e.message.includes(f.config.url),
  );
});
test("MCP duplicate short codes fail closed, group-only reassign and single parameter mapping validated before writes", async (t) => {
  const f = await fixture(t),
    w = await f.provider.read(actor);
  await assert.rejects(
    f.provider.command(actor, {
      type: "ticket.action",
      data: {
        id: w.tickets[0].id,
        action: "reassign",
        groupId: "service",
        assigneeId: "person1",
      },
      expectedRevision: w.revision,
      requestId: "person",
    }),
    /不支持指定个人/,
  );
  await f.provider.command(actor, {
    type: "parameters.save",
    data: { ...w.parameters, escalationMinutes: 20 },
    expectedRevision: w.revision,
    requestId: "parameter",
  });
  const write = f.calls.find((c) => c.params?.name === "set_config");
  assert.equal(write.params.arguments.path, "escalation.intervalMinutes");
  assert.equal(write.params.arguments.value, 20);
  f.rows.push({ ...f.rows[0], id: "T260905-G001" });
  await assert.rejects(
    f.provider.command(actor, {
      type: "ticket.action",
      data: { id: w.tickets[0].id, action: "urge" },
      expectedRevision: (await f.provider.read(actor)).revision,
      requestId: "duplicate",
    }),
    /唯一性/,
  );
  assert.equal(
    f.calls.filter((c) => c.params?.name === "urge_ticket").length,
    0,
  );
});

test("MCP assistant reports missing interfaces instead of false zero counts", async (t) => {
  const f = await fixture(t),
    analysis = new AnalysisService(f.provider);
  const chat = await analysis.chat(actor, { question: "现在有多少条消息？" });
  assert.match(chat.messages.at(-1)!.text, /未提供消息日志接口/);
  const accounts = await analysis.chat(actor, {
    question: "机器人账号在线吗？",
  });
  assert.match(accounts.messages.at(-1)!.text, /未提供企微账号/);
  const ticket = await analysis.chat(actor, { question: "查询 G001" });
  assert.match(ticket.messages.at(-1)!.text, /真实详情内容/);
  assert.equal(f.provider.readDashboard(actor).tickets.length, 0);
});
