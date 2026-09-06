/** Uses real front-end assets with isolated API fixtures; never calls production MCP. */
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { seed } from "../server/src/seed.ts";
import { metrics } from "../server/src/metrics.ts";
import { businessDate } from "../server/src/dates.ts";
const pw = await import(
  process.env.PLAYWRIGHT_MODULE
    ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href
    : "playwright"
);
const browser = await pw.chromium.launch({ headless: true });
try {
  const page = await browser.newPage(),
    w = seed("ai-ui"),
    today = businessDate();
  const boot: any = {
    actor: { id: "admin", name: "联调", role: "admin", tenantId: "ai-ui" },
    mode: "mcp",
    aiConfigured: true,
    aiCapabilities: { chat: true, analysis: true, channel: "mcp" },
    analysisTasks: [],
    workspace: w,
    conversations: [],
    today,
    metrics: metrics(w, today, today),
  };
  const task = {
    id: "new-task",
    name: "测试异步报告",
    status: "running",
    stage: "正在分析",
    retryAfterSeconds: 2,
  };
  let completed = false,
    summaryReads = 0,
    chats: any[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error: Error) => errors.push(error.message));
  await page.route("**/api/**", async (route: any) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/bootstrap") return route.fulfill({ json: boot });
    if (path === "/api/reports") {
      boot.analysisTasks = [{ ...task }];
      return route.fulfill({ status: 202, json: task });
    }
    if (path === "/api/analysis-tasks/new-task")
      return route.fulfill({
        json: completed
          ? {
              ...task,
              status: "completed",
              stage: "已完成",
              reportId: "new-report",
            }
          : task,
      });
    if (path === "/api/analysis-tasks") {
      if (++summaryReads === 1)
        return route.fulfill({
          status: 503,
          json: { error: { message: "暂时失败" } },
        });
      const report = {
        id: "new-report",
        source: "mcp",
        runKey: "test",
        name: "测试异步报告",
        start: today,
        end: today,
        generatedAt: new Date().toISOString(),
        mode: "model",
        summary: "模型完成的分析",
        dataMetrics: [
          { name: "平均响应", value: null, unit: "分钟", basis: "无有效记录" },
        ],
        findings: [],
        advice: [],
        coverage: "测试范围",
      };
      boot.workspace.reports = [report];
      boot.analysisTasks = [];
      return route.fulfill({ json: { tasks: [], reports: [report] } });
    }
    if (path === "/api/chat") {
      const data = route.request().postDataJSON();
      chats.push(data);
      return route.fulfill({
        json: {
          id: "chat-1",
          title: "问题",
          updatedAt: new Date().toISOString(),
          messages: [
            {
              id: "answer",
              role: "assistant",
              text: "已回复 <img src=x onerror=alert(1)>",
              at: new Date().toISOString(),
              mode: "MCP · AI 回答",
            },
          ],
        },
      });
    }
    return route.fulfill({
      status: 503,
      json: { error: { message: "未允许的测试请求" } },
    });
  });
  await page.goto(
    (process.env.APP_URL || "http://127.0.0.1:8766") + "/#insights",
  );
  await page.getByRole("button", { name: "立即分析", exact: false }).click();
  await page.getByRole("button", { name: "生成 AI 分析", exact: true }).click();
  await page.getByRole("heading", { name: "分析任务", exact: true }).waitFor();
  await page.getByRole("button", { name: "打开AI助手", exact: true }).click();
  await page.locator("#chat-input").fill("查看运营概况");
  await page.locator("#chat-send").click();
  await page
    .getByText("已回复 <img src=x onerror=alert(1)>", { exact: true })
    .waitFor();
  assert.equal(
    chats[0].context.reportId,
    undefined,
    "queued task and legacy reports must not become report context",
  );
  assert.ok(chats[0].requestId);
  assert.equal(await page.locator(".message-text img").count(), 0);
  await page.getByRole("button", { name: "收起AI助手", exact: true }).click();
  completed = true;
  await page
    .getByRole("heading", { name: "测试异步报告", exact: true })
    .waitFor({ timeout: 14000 });
  assert.ok(
    summaryReads >= 2,
    "failed report retrieval must recover without a full refresh",
  );
  assert.match(await page.locator(".ai-report-metrics").innerText(), /—/);
  await page.getByRole("button", { name: "打开AI助手", exact: true }).click();
  await page.locator("#chat-input").fill("追问这个报告");
  await page.locator("#chat-send").click();
  await page.waitForFunction(() => !document.querySelector("[data-chat-stop]"));
  assert.equal(chats.at(-1).context.reportId, "new-report");
  assert.equal(
    await page.locator(".report-library [data-pagination]").count(),
    0,
  );
  boot.workspace.reports = Array.from({ length: 25 }, (_, i) => ({
    ...boot.workspace.reports[0],
    id: `history-${i}`,
    name: `历史报告 ${i + 1}`,
  }));
  await page.reload();
  await page.locator(".report-library > summary").click();
  await page
    .locator(".report-library")
    .getByRole("button", { name: "下一页", exact: true })
    .click();
  assert.equal(await page.locator(".report-library[open]").count(), 1);
  assert.equal(await page.locator("[data-report-select]").count(), 5);
  await page.locator('[data-report-select="history-20"]').click();
  assert.equal(await page.locator(".report-library[open]").count(), 0);
  await page
    .getByRole("heading", { name: "历史报告 21", exact: true })
    .waitFor();
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      queuedTaskContextSafe: true,
      failedReportFetchRecovered: true,
      reportFollowup: true,
      nullMetricsPreserved: true,
      scriptInjectionEscaped: true,
      historyPagination: true,
    }),
  );
} finally {
  await browser.close();
}
