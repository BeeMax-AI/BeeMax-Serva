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
async function fixture(t: any, sse = false, expanded = false) {
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
  const extraTools = expanded
    ? [
        "get_analytics",
        "get_report",
        "get_whitelist",
        "set_whitelist",
        "list_config_changes",
        "set_roster",
        "set_on_duty_today",
        "ingest_roster_text",
        "set_routing_rule",
        "clear_routing_rule",
        "set_subject_rule",
        "clear_subject_rule",
      ]
    : [];
  const rosterDoc = {
    default: {
      service: {
        l1: [{ name: "测试人员", userid: "person1", extra: "preserve" }],
        l2: [{ name: "其他人员", userid: "person2" }],
      },
    },
    byDate: {
      "2026-09-06": {
        service: { l2: [{ name: "其他人员", userid: "person2" }] },
      },
    },
    specialists: { wifi: ["specialist"] },
    buildingRouting: [
      {
        group: "service",
        date: "2026-09-06",
        allBuildings: [
          {
            from: "08:00",
            to: "18:00",
            staff: [{ name: "测试人员", userid: "person1" }],
          },
        ],
      },
    ],
  };
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
      ...extraTools,
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
        value = expanded
          ? rosterDoc
          : {
              default: {
                service: { l1: [{ name: "测试人员", userid: "person1" }] },
              },
            };
      else if (name === "get_routing_rules")
        value = {
          effective: { 咨询: "service" },
          learned: { subjectRules: [] },
        };
      else if (name === "get_whitelist")
        value = {
          wecom: {
            dmPolicy: "allowlist",
            dmAllowFrom: ["allowed"],
            groupPolicy: "open",
            groups: { chat1: { name: "群名称", mode: "mention" } },
          },
        };
      else if (name === "list_config_changes")
        value = [
          {
            ts: 1788673235152,
            by: "admin",
            op: "set",
            path: "credentials.token",
            value: "never-expose",
          },
        ];
      else if (name === "get_report")
        value = {
          day: "2026-09-05",
          text: "业务日报 <script>unsafe</script>",
          summary: { total: 5 },
        };
      else if (name === "get_analytics") {
        const period = {
          created: 10,
          closed: 8,
          noAccept: 1,
          avgRespMin: 3,
          avgResoMin: null,
          completionRate: 80,
        };
        value = {
          generated_at: 1788673235152,
          overview: {
            today: "2026-09-06",
            total_tickets: 10000,
            today_stats: period,
            yesterday_stats: period,
            lastweek_stats: period,
          },
          trends: {
            series: [{ key: "2026-09-06", created: 10, closed: 8, backlog: 2 }],
          },
          staff: {
            staff: [
              {
                name: "测试人员",
                accepted: 5,
                closed: 4,
                share: 50,
                avgRespMin: null,
                avgHandleMin: 12,
              },
            ],
          },
        };
      } else if (name === "get_config")
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
          events: rows.find((r) => r.id === args.id)?.events || [
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
    extraTools,
    rosterDoc,
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

test("MCP timeline translates reminder events and timestamps into readable Chinese", async (t) => {
  const f = await fixture(t);
  const at = Date.parse("2026-09-06T09:30:00+08:00");
  f.rows[0].events = [
    {
      ts: at,
      event: "created",
      detail: {
        fields: { room: "A101", raw: "Please water the plants." },
        session: "internal-session",
      },
    },
    {
      ts: at,
      event: "classified",
      detail: JSON.stringify({
        type: "咨询",
        priority: "低",
        selfServe: false,
      }),
    },
    {
      ts: at,
      event: "dispatched",
      detail: {
        groupId: "service",
        tier: 1,
        mention: "测试人员",
        delivered: true,
      },
    },
    { ts: at, event: "accepted", detail: { assignee: "测试人员" } },
    {
      ts: at,
      event: "accept_reminded",
      detail: { assignee: "测试人员", hours: 4 },
    },
    {
      ts: at,
      event: "held",
      detail: { by: "操作员", reason: "待交接", remind_at: at, await: true },
    },
    {
      ts: at,
      event: "hold_reminded",
      detail: { holder: "测试人员", remind_at: at, nudges: 1 },
    },
    {
      ts: at,
      event: "hold_remind_set",
      detail: { by: "操作员", remind_at: at },
    },
    {
      ts: at,
      event: "new_internal_event",
      detail: { secretInternalId: "internal-session" },
    },
  ];
  const ticket = (await f.provider.getTicket(actor, f.rows[0].id))!;
  assert.deepEqual(
    ticket.events.map((e) => e.name),
    [
      "创建工单",
      "自动分类",
      "派发工单",
      "接单",
      "接单后完成提醒",
      "挂起",
      "挂起跟进提醒",
      "设置跟进时间",
      "业务记录",
    ],
  );
  assert.match(ticket.events[0].detail, /客户原文：Please water the plants/);
  assert.match(ticket.events[1].detail, /问题类型：咨询/);
  assert.match(ticket.events[2].detail, /负责小组：客服沟通群/);
  assert.match(ticket.events[4].detail, /4 小时/);
  assert.match(ticket.events[6].detail, /2026-09-06 09:30/);
  assert.match(ticket.events[6].detail, /第 1 次/);
  assert.doesNotMatch(
    JSON.stringify(ticket.events),
    /internal-session|remind_at|178865|\[object Object\]/,
  );
});

test("new MCP reads keep full-database analytics separate and redact config audit values", async (t) => {
  const f = await fixture(t, false, true),
    w = await f.provider.read(actor);
  assert.equal(w.tickets.length, 1);
  assert.equal(w.channelAccess?.[0].dmPolicy, "allowlist");
  assert.equal(w.channelAccess?.[0].groups[0].id, "chat1");
  assert.equal(w.people[0].defaultTier, 1);
  assert.ok(!JSON.stringify(w).includes("never-expose"));
  assert.ok(!JSON.stringify(w).includes("credentials.token"));
  const a = await f.provider.query(
    actor,
    "analytics",
    new URLSearchParams({ bucket: "week", days: "30" }),
  );
  assert.ok("total" in a && a.total === 10000);
  assert.deepEqual(f.calls.at(-1).params.arguments, {
    bucket: "week",
    trendLimit: 30,
    staffSinceDays: 30,
  });
  const report = await f.provider.query(
    actor,
    "report",
    new URLSearchParams({ kind: "day", date: "2026-09-05" }),
  );
  assert.ok("text" in report && report.text.includes("业务日报"));
  const count = f.calls.length;
  await assert.rejects(
    f.provider.query(
      { ...actor, tenantId: "other" },
      "analytics",
      new URLSearchParams(),
    ),
    /尚未配置/,
  );
  await assert.rejects(
    f.provider.query(
      actor,
      "analytics",
      new URLSearchParams({ bucket: "anything" }),
    ),
    /无效/,
  );
  await assert.rejects(
    f.provider.query(
      actor,
      "report",
      new URLSearchParams({ kind: "lead", group: "bad" }),
    ),
    /有效小组/,
  );
  assert.equal(f.calls.length, count);
});
test("MCP discovery refresh detects added and removed tools without reinitializing", async (t) => {
  const f = await fixture(t, false, true);
  await f.provider.client.initialize();
  assert.ok(f.provider.client.tools.has("get_analytics"));
  f.extraTools.splice(f.extraTools.indexOf("get_analytics"), 1);
  f.extraTools.push("future_read_tool");
  f.provider.client.toolsCheckedAt = 0;
  await Promise.all([
    f.provider.client.initialize(),
    f.provider.client.initialize(),
  ]);
  assert.ok(!f.provider.client.tools.has("get_analytics"));
  assert.ok(f.provider.client.tools.has("future_read_tool"));
  assert.equal(f.calls.filter((c) => c.method === "initialize").length, 1);
  assert.equal(f.calls.filter((c) => c.method === "tools/list").length, 2);
});
test("default roster edit preserves all unrelated roster sections and person properties", async (t) => {
  const f = await fixture(t, false, true),
    w = await f.provider.read(actor);
  const command = {
    type: "roster.person.save",
    data: { groupId: "service", userId: "person1", tier: 3 },
    expectedRevision: w.revision,
    requestId: "roster-edit",
  };
  await f.provider.command(actor, command);
  const write = f.calls.find((c) => c.params?.name === "set_roster");
  assert.deepEqual(write.params.arguments.roster.byDate, f.rosterDoc.byDate);
  assert.deepEqual(
    write.params.arguments.roster.buildingRouting,
    f.rosterDoc.buildingRouting,
  );
  assert.deepEqual(
    write.params.arguments.roster.specialists,
    f.rosterDoc.specialists,
  );
  assert.deepEqual(write.params.arguments.roster.default.service.l1, []);
  assert.equal(
    write.params.arguments.roster.default.service.l3[0].extra,
    "preserve",
  );
  assert.equal(
    write.params.arguments.roster.default.service.l2[0].userid,
    "person2",
  );
  assert.equal(write.params.arguments.by, "测试管理员 (operator)");
  await f.provider.command(actor, command);
  assert.equal(
    f.calls.filter((c) => c.params?.name === "set_roster").length,
    1,
  );
});
test("routing writes use the correct type or keyword contracts and refuse base-rule deletion", async (t) => {
  const f = await fixture(t, false, true);
  for (const [i, data, tool, arg] of [
    [
      0,
      { kind: "type", type: "咨询", groupId: "service" },
      "set_routing_rule",
      "type",
    ],
    [
      1,
      { kind: "subject", keywords: "咨询", groupId: "service" },
      "set_subject_rule",
      "keyword",
    ],
  ] as const) {
    const w = await f.provider.read(actor);
    await f.provider.command(actor, {
      type: "route.save",
      data,
      expectedRevision: w.revision,
      requestId: "rule" + i,
    });
    const write = f.calls.find((c) => c.params?.name === tool);
    assert.equal(write.params.arguments[arg], "咨询");
    assert.equal(write.params.arguments.toGroup, "service");
  }
  const w = await f.provider.read(actor);
  await assert.rejects(
    f.provider.command(actor, {
      type: "route.delete",
      data: { id: "type:咨询" },
      expectedRevision: w.revision,
      requestId: "base-delete",
    }),
    /只能覆盖/,
  );
  assert.equal(
    f.calls.filter((c) => c.params?.name === "clear_routing_rule").length,
    0,
  );
});
test("today roster, imported roster and channel writes validate and bind the audit actor", async (t) => {
  const f = await fixture(t, false, true);
  const cases = [
    [
      "roster.today",
      { groupId: "service", names: ["测试人员", "测试人员"] },
      "set_on_duty_today",
      { group: "service", names: ["测试人员"] },
    ],
    [
      "roster.import",
      { groupId: "service", text: "测试人员 8:00-18:00", date: "2099-01-01" },
      "ingest_roster_text",
      { group: "service", text: "测试人员 8:00-18:00", date: "2099-01-01" },
    ],
    [
      "access.save",
      {
        channel: "wecom",
        action: "set_dm_policy",
        policy: "owner",
        by: "forged",
      },
      "set_whitelist",
      { channel: "wecom", action: "set_dm_policy", policy: "owner" },
    ],
  ] as const;
  for (const [type, data, tool, args] of cases) {
    const w = await f.provider.read(actor);
    await f.provider.command(actor, {
      type,
      data,
      requestId: type,
      expectedRevision: w.revision,
    });
    assert.deepEqual(
      f.calls.find((c) => c.params?.name === tool).params.arguments,
      { ...args, by: "测试管理员 (operator)" },
    );
  }
  const w = await f.provider.read(actor);
  await assert.rejects(
    f.provider.command(actor, {
      type: "access.save",
      data: { channel: "wecom", action: "set_group_policy", policy: "owner" },
      requestId: "invalid",
      expectedRevision: w.revision,
    }),
    /策略无效/,
  );
  await assert.rejects(
    f.provider.command(
      { ...actor, role: "viewer" },
      {
        type: "roster.today",
        data: { groupId: "service", names: ["测试人员"] },
        requestId: "viewer",
        expectedRevision: w.revision,
      },
    ),
    /查看权限/,
  );
});
test("new MCP writes preserve uncertain-result idempotency", async (t) => {
  const f = await fixture(t, false, true),
    w = await f.provider.read(actor);
  f.setWriteFail();
  const cmd = {
    type: "access.save",
    data: { channel: "wecom", action: "add_dm_allow", userId: "new-person" },
    requestId: "uncertain-access",
    expectedRevision: w.revision,
  };
  await assert.rejects(f.provider.command(actor, cmd), /尚未确认/);
  await assert.rejects(f.provider.command(actor, cmd), /待核对/);
  assert.equal(
    f.calls.filter((c) => c.params?.name === "set_whitelist").length,
    1,
  );
});

test("default roster editing refuses broadcast tiers and retains members hidden by dated overrides", async (t) => {
  const f = await fixture(t, false, true);
  (f.rosterDoc.default.service as any).l4 = "@ALL";
  const { businessDate } = await import("../server/src/dates.ts");
  (f.rosterDoc.byDate as any)[businessDate()] = {
    service: { l1: [{ name: "临时人员", userid: "temporary" }] },
  };
  const w = await f.provider.read(actor);
  assert.ok(
    w.people.some((p) => p.rosterUserId === "person1" && p.defaultTier === 1),
  );
  assert.ok(
    w.people.some((p) => p.rosterUserId === "temporary" && !p.defaultTier),
  );
  assert.equal(w.scheduleRules?.[0].building, "全部楼栋");
  await assert.rejects(
    f.provider.command(actor, {
      type: "roster.person.save",
      data: { groupId: "service", userId: "person1", tier: 4 },
      requestId: "broadcast",
      expectedRevision: w.revision,
    }),
    /广播/,
  );
  assert.equal(
    f.calls.filter((c) => c.params?.name === "set_roster").length,
    0,
  );
});
test("admin can maintain allowlist but only owner can weaken access policy", async (t) => {
  const f = await fixture(t, false, true),
    w = await f.provider.read(actor);
  const cmd = {
    type: "access.save",
    data: { channel: "wecom", action: "set_dm_policy", policy: "open" },
    requestId: "weaken",
    expectedRevision: w.revision,
  };
  await assert.rejects(f.provider.command(actor, cmd), /仅所有者/);
  assert.equal(
    f.calls.filter((c) => c.params?.name === "set_whitelist").length,
    0,
  );
  await f.provider.command({ ...actor, role: "owner" }, cmd);
  assert.equal(
    f.calls.filter((c) => c.params?.name === "set_whitelist").length,
    1,
  );
});

test("escalation tiers L3 and L4 load instead of breaking the whole workspace", async (t) => {
  for (const status of ["ESCALATED_L3", "ESCALATED_L4"]) {
    const f = await fixture(t);
    f.rows[0].status = status;
    const w = await f.provider.read(actor);
    assert.equal(w.tickets[0].status, status);
    const { metrics } = await import("../server/src/metrics.ts");
    assert.equal(metrics(w, "2026-09-06", "2026-09-06").escalated, 1);
    const { statusTag } = await import("../client/src/core.ts");
    assert.match(statusTag(w.tickets[0].status), /status blue/);
  }
});

test("opening a known ticket refreshes its detail without reloading every workspace tool", async (t) => {
  const f = await fixture(t);
  const w = await f.provider.read(actor);
  const now = Date.now();
  t.mock.method(Date, "now", () => now + 20000);
  f.rows[0].status = "CLOSED";
  const detail = await f.provider.getTicket(actor, w.tickets[0].id);
  assert.equal(detail?.status, "CLOSED", "detail must still be fresh");
  assert.equal(
    f.calls.filter((c) => c.params?.name === "list_tickets").length,
    1,
    "known detail should not reload the entire workspace after its 10 second cache expires",
  );
  const count = f.calls.length;
  await assert.rejects(
    f.provider.getTicket({ ...actor, tenantId: "other" }, w.tickets[0].id),
    /尚未配置/,
  );
  assert.equal(f.calls.length, count);
});
