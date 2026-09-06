import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/src/store.ts";
import { McpProvider } from "../server/src/mcp-provider.ts";
import { McpAiService } from "../server/src/mcp-ai.ts";
import type { Actor } from "../shared/domain.ts";
const actor: Actor = {
  id: "operator",
  name: "测试管理员",
  role: "admin",
  tenantId: "test",
};
const range = { start: "2026-09-05", end: "2026-09-05", name: "测试报告" };
async function fixture(t: any) {
  const dir = mkdtempSync(join(tmpdir(), "qf-ai-")),
    store = new Store(dir);
  let status = "running",
    malformed = false,
    disconnected = false,
    chatRelease: (() => void) | undefined;
  const calls: { name: string; args: any }[] = [];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const rpc = JSON.parse(body);
    let result: any;
    if (rpc.method === "initialize") result = { capabilities: {} };
    else if (rpc.method === "notifications/initialized") {
      res.writeHead(202).end();
      return;
    } else if (rpc.method === "tools/list")
      result = {
        tools: ["chat", "create_analysis", "get_analysis"].map((name) => ({
          name,
        })),
      };
    else {
      const { name, arguments: args } = rpc.params;
      calls.push({ name, args });
      if (disconnected) {
        req.socket.destroy();
        return;
      }
      let value: any;
      if (name === "create_analysis")
        value = { task_id: `remote-${args.request_id}`, status: "queued" };
      else if (name === "get_analysis")
        value = {
          task_id: args.task_id,
          status,
          retry_after_seconds: 2,
          ...(status === "completed"
            ? {
                report: {
                  report_id: `report-${args.task_id}`,
                  report_name: "测试报告",
                  start_date: malformed ? "2026-08-01" : "2026-09-05",
                  end_date: "2026-09-05",
                  generated_at: Date.now(),
                  summary: "没有足够响应记录。",
                  ai_narrative: true,
                  fact_only: false,
                  metrics: [
                    {
                      name: "平均响应",
                      value: null,
                      unit: "分钟",
                      basis: "仅有效接单记录",
                    },
                  ],
                  findings: [
                    {
                      title: "数据不足",
                      detail: "响应记录不足",
                      basis: "无有效样本",
                    },
                  ],
                  recommendations: [
                    {
                      content: "核对记录",
                      reason: "数据不足",
                      basis: "无有效样本",
                      priority: "high",
                    },
                  ],
                  data_coverage: {
                    start_date: "2026-09-05",
                    end_date: "2026-09-05",
                    timezone: "Asia/Shanghai",
                    total_tickets_scanned: 4,
                    note: "仅工单库",
                    limitations: ["缺少响应记录"],
                  },
                },
              }
            : {}),
        };
      else if (name === "chat") {
        if (chatRelease)
          await new Promise<void>((resolve) => {
            chatRelease = resolve;
          });
        value = {
          conversation_id: args.conversation_id || `conv-${args.request_id}`,
          message_id: "m1",
          answer: "只读回答",
          references: [],
          data_coverage: "测试数据",
        };
      }
      result = { content: [{ type: "text", text: JSON.stringify(value) }] };
    }
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const config = {
    url: `http://127.0.0.1:${(server.address() as any).port}`,
    tenantId: "test",
    tenantName: "测试客户",
  };
  const provider = new McpProvider(store, config),
    service = new McpAiService(provider);
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return {
    service,
    provider,
    store,
    calls,
    config,
    complete: () => (status = "completed"),
    fail: () => (status = "failed"),
    malformed: () => (malformed = true),
    disconnect: (on: boolean) => (disconnected = on),
    blockChat: () => (chatRelease = () => {}),
    releaseChat: () => {
      chatRelease?.();
      chatRelease = undefined;
    },
  };
}
test("MCP analysis survives service reconstruction, deduplicates submissions and preserves report facts", async (t) => {
  const f = await fixture(t),
    task = await f.service.generate(actor, range, "req-1");
  assert.equal(task.status, "queued");
  assert.equal((await f.service.generate(actor, range, "req-1")).id, task.id);
  await assert.rejects(
    f.service.generate(actor, { ...range, start: "2026-09-04" }, "req-1"),
    /其他分析参数/,
  );
  assert.equal(f.calls.filter((c) => c.name === "create_analysis").length, 1);
  f.complete();
  const now = Date.now();
  t.mock.method(Date, "now", () => now + 61000);
  const restarted = new McpAiService(new McpProvider(f.store, f.config));
  const completed = await restarted.getTask(actor, task.id);
  assert.equal(completed.status, "completed");
  const reports = f.provider.readDashboard(actor).reports;
  assert.equal(reports.length, 1);
  assert.equal(reports[0].dataMetrics?.[0].value, null);
  assert.equal(reports[0].metrics, undefined);
  assert.match(reports[0].coverage, /缺少响应记录/);
  assert.equal(
    (await restarted.getTask(actor, task.id)).reportId,
    reports[0].id,
  );
  assert.equal(f.calls.filter((c) => c.name === "create_analysis").length, 1);
  const chat = await restarted.chat(actor, {
    question: "追问报告",
    requestId: "follow-report",
    context: { reportId: reports[0].id },
  });
  assert.equal(chat.messages.length, 2);
  assert.match(f.calls.at(-1)!.args.context.report_id, /^report-remote-/);
});
test("MCP task and conversation identifiers cannot cross user or tenant boundaries", async (t) => {
  const f = await fixture(t),
    task = await f.service.generate(actor, range, "owned");
  const chat = await f.service.chat(actor, {
    question: "查询",
    requestId: "q1",
    user_id: "spoof",
  });
  const count = f.calls.length;
  await assert.rejects(
    f.service.getTask({ ...actor, id: "another" }, task.id),
    /不存在/,
  );
  await assert.rejects(
    f.service.getTask({ ...actor, tenantId: "foreign" }, task.id),
    /尚未配置/,
  );
  await assert.rejects(
    f.service.chat(
      { ...actor, id: "another" },
      { question: "继续", requestId: "q2", conversationId: chat.id },
    ),
    /不存在/,
  );
  await assert.rejects(
    f.service.generate({ ...actor, role: "viewer" }, range, "viewer"),
    /只读/,
  );
  assert.equal(f.calls.length, count);
  const args = f.calls.find((c) => c.name === "chat")!.args;
  assert.notEqual(args.user_id, "spoof");
  assert.notEqual(chat.id, args.conversation_id);
});
test("MCP chat persists history, maps continuation and reuses a request after uncertain delivery", async (t) => {
  const f = await fixture(t),
    data = { question: "查询", requestId: "q1" };
  f.disconnect(true);
  await assert.rejects(f.service.chat(actor, data), /MCP/);
  const firstKey = f.calls.at(-1)!.args.request_id;
  f.disconnect(false);
  const first = await f.service.chat(actor, data);
  assert.equal(f.calls.at(-1)!.args.request_id, firstKey);
  const count = f.calls.length;
  assert.equal((await f.service.chat(actor, data)).id, first.id);
  assert.equal(f.calls.length, count);
  await assert.rejects(
    f.service.chat(actor, { ...data, question: "不同问题" }),
    /其他问题/,
  );
  const second = await f.service.chat(actor, {
    question: "继续",
    requestId: "q2",
    conversationId: first.id,
  });
  assert.equal(second.messages.length, 4);
  assert.equal(f.calls.at(-1)!.args.conversation_id, `conv-${firstKey}`);
  assert.equal(
    f.provider.readDashboard(actor).conversations[actor.id].length,
    1,
  );
});
test("MCP analysis retries transport failures using the same remote request and does not save failed reports", async (t) => {
  const f = await fixture(t);
  f.disconnect(true);
  const task = await f.service.generate(actor, range, "uncertain"),
    firstKey = f.calls.at(-1)!.args.request_id;
  assert.equal(task.status, "queued");
  assert.match(task.stage, /中断/);
  const now = Date.now();
  t.mock.method(Date, "now", () => now + 61000);
  f.disconnect(false);
  await f.service.getTask(actor, task.id);
  assert.equal(f.calls.at(-1)!.args.request_id, firstKey);
  f.fail();
  t.mock.method(Date, "now", () => now + 122000);
  assert.equal((await f.service.getTask(actor, task.id)).status, "failed");
  assert.equal(f.provider.readDashboard(actor).reports.length, 0);
});
test("MCP completed report with a mismatched date range is never archived", async (t) => {
  const f = await fixture(t),
    task = await f.service.generate(actor, range, "bad-range");
  f.complete();
  f.malformed();
  const now = Date.now();
  t.mock.method(Date, "now", () => now + 61000);
  const result = await f.service.getTask(actor, task.id);
  assert.notEqual(result.status, "completed");
  assert.equal(f.provider.readDashboard(actor).reports.length, 0);
});
test("scheduled MCP analysis advances only after completion and resumes the same task", async (t) => {
  const f = await fixture(t),
    w = f.provider.readDashboard(actor);
  w.plans = [
    {
      id: "plan1",
      name: "定时日报",
      enabled: true,
      frequency: "daily",
      time: "08:30",
      weekday: 1,
      monthDay: 1,
      yearMonth: 1,
      every: 1,
      unit: "days",
      anchor: "2026-09-01",
      rangeDays: 1,
      nextRun: "2026-09-06T00:30:00.000Z",
      range: "previousDay",
    },
  ];
  f.provider.saveDashboard(actor, w);
  await f.service.tick();
  assert.equal(
    f.provider.readDashboard(actor).plans[0].nextRun,
    "2026-09-06T00:30:00.000Z",
  );
  assert.equal(f.calls.filter((c) => c.name === "create_analysis").length, 1);
  f.complete();
  const now = Date.now();
  t.mock.method(Date, "now", () => now + 61000);
  await new McpAiService(new McpProvider(f.store, f.config)).tick();
  assert.notEqual(
    f.provider.readDashboard(actor).plans[0].nextRun,
    "2026-09-06T00:30:00.000Z",
  );
  assert.equal(f.provider.readDashboard(actor).reports.length, 1);
  assert.equal(f.calls.filter((c) => c.name === "create_analysis").length, 1);
});
test("same conversation cannot submit simultaneous turns", async (t) => {
  const f = await fixture(t),
    first = await f.service.chat(actor, {
      question: "首次",
      requestId: "first",
    });
  f.blockChat();
  const pending = f.service.chat(actor, {
    question: "继续",
    requestId: "second",
    conversationId: first.id,
  });
  await assert.rejects(
    f.service.chat(actor, {
      question: "同时",
      requestId: "third",
      conversationId: first.id,
    }),
    /正在回复/,
  );
  // Wait until the fixture received the pending call before releasing it.
  while (f.calls.length < 2)
    await new Promise((resolve) => setTimeout(resolve, 5));
  f.releaseChat();
  assert.equal((await pending).messages.length, 4);
});

test("concurrent identical analysis submissions return one task without database conflicts", async (t) => {
  const f = await fixture(t);
  const tasks = await Promise.all(
    Array.from({ length: 6 }, () =>
      f.service.generate(actor, range, "same-request"),
    ),
  );
  assert.equal(new Set(tasks.map((t) => t.id)).size, 1);
  assert.equal(f.calls.filter((c) => c.name === "create_analysis").length, 1);
});
test("background polling gives later pending tasks a turn", async (t) => {
  const f = await fixture(t);
  for (let i = 0; i < 6; i++)
    await f.service.generate(actor, range, `task-${i}`);
  const now = Date.now();
  t.mock.method(Date, "now", () => now + 31000);
  await f.service.tick();
  t.mock.method(Date, "now", () => now + 62000);
  await f.service.tick();
  assert.equal(
    new Set(
      f.calls
        .filter((c) => c.name === "get_analysis")
        .map((c) => c.args.task_id),
    ).size,
    6,
  );
});
