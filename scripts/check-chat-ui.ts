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
  const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    }),
    w = seed("chat-ui"),
    today = businessDate();
  const boot = {
    actor: {
      id: "test",
      name: "测试用户",
      role: "admin",
      tenantId: w.tenant.id,
    },
    mode: "mcp",
    aiConfigured: true,
    workspace: w,
    conversations: [],
    today,
    metrics: metrics(w, today, today),
  };
  let mode = "ok",
    release: (() => void) | undefined,
    request: any;
  const errors: string[] = [];
  page.on("pageerror", (e: Error) => errors.push(e.message));
  await page.route("**/api/**", async (route: any) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/bootstrap") return route.fulfill({ json: boot });
    if (path === "/api/chat") {
      request = route.request().postDataJSON();
      if (mode === "fail")
        return route.fulfill({
          status: 502,
          json: { error: { message: "服务暂时不可用" } },
        });
      await new Promise<void>((r) => (release = r));
      return route.fulfill({
        json: {
          id: "c1",
          title: request.question,
          updatedAt: new Date().toISOString(),
          messages: [
            {
              id: "u1",
              role: "user",
              text: request.question,
              at: "2026-09-06T04:30:00Z",
              context: {
                page: "insights",
                reportId: "hidden-uuid",
                label: "hidden-uuid",
              },
            },
            {
              id: "a1",
              role: "assistant",
              at: "2026-09-06T04:30:03Z",
              durationMs: 3100,
              text: "## 当前工单\n\n> 以下为已查询到的 **2 条**记录。\n\n| 工单号 | 类型 | 状态 | 负责人 | 报单时间 |\n|---|---|---|---|---|\n|G001|报修|已接单|王师傅|09/06 10:30|\n|G002|咨询|暂挂|李师傅|09/06 11:05|\n\n### 建议关注\n\n- 核对挂起原因\n- 跟进处理进度",
            },
          ],
        },
      });
    }
    return route.fulfill({
      status: 503,
      json: { error: { message: "不允许的请求" } },
    });
  });
  await page.goto(
    (process.env.APP_URL || "http://127.0.0.1:8766") + "/#insights",
  );
  await page.getByRole("button", { name: "打开AI助手", exact: true }).click();
  await page.locator("#chat-input").fill("今天有哪些工单？");
  await page.locator("#chat-send").click();
  await page.locator(".chat-request-state[data-status=pending]").waitFor();
  assert.equal(
    await page.locator(".chat-user .message-text").last().innerText(),
    "今天有哪些工单？",
  );
  await page.waitForTimeout(1200);
  assert.match(await page.locator("[data-chat-elapsed]").innerText(), /[1-9]/);
  await page.screenshot({ path: ".local/chat-waiting-ui.png" });
  release!();
  await page.locator(".chat-markdown table").waitFor();
  assert.equal(await page.locator(".chat-markdown tbody tr").count(), 2);
  assert.equal(await page.locator(".chat-ticket-status").count(), 2);
  assert.match(
    await page.locator(".chat-reply .chat-message-heading").innerText(),
    /已完成/,
  );
  assert.match(await page.locator(".chat-reply time").innerText(), /12:30:03/);
  assert.match(
    await page.locator(".chat-message-meta").last().innerText(),
    /3 秒/,
  );
  assert.ok(
    !(await page.locator(".chat-messages").innerText()).includes("hidden-uuid"),
  );
  await page.getByRole("button", { name: "放大AI助手", exact: true }).click();
  await page.screenshot({ path: ".local/chat-formatted-ui.png" });
  mode = "fail";
  await page.locator("#chat-input").fill("失败场景");
  await page.locator("#chat-send").click();
  await page.locator(".chat-request-state[data-status=failed]").waitFor();
  assert.equal(await page.locator("#chat-input").inputValue(), "失败场景");
  mode = "ok";
  await page.locator("#chat-send").click();
  await page.locator(".chat-request-state[data-status=pending]").waitFor();
  await page.getByRole("button", { name: "停止等待", exact: true }).click();
  await page.locator(".chat-request-state[data-status=stopped]").waitFor();
  release?.();
  await page.waitForTimeout(100);
  boot.conversations = [
    {
      id: "c1",
      title: "恢复的对话",
      updatedAt: new Date().toISOString(),
      messages: [
        {
          id: "restored-user",
          role: "user",
          text: "失败场景",
          requestId: request.requestId,
          at: new Date().toISOString(),
        },
        {
          id: "restored-answer",
          role: "assistant",
          text: "后台已完成回复",
          at: new Date().toISOString(),
        },
      ],
    },
  ] as any;
  await page.getByRole("button", { name: "收起AI助手", exact: true }).click();
  await page.getByRole("button", { name: "刷新页面", exact: true }).click();
  await page.getByRole("button", { name: "打开AI助手", exact: true }).click();
  await page.getByText("后台已完成回复", { exact: true }).waitFor();
  assert.equal(await page.locator(".chat-request-state").count(), 0);
  assert.equal(await page.locator(".chat-user").count(), 1);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      markdownTable: true,
      timestamps: true,
      elapsedTimer: true,
      completed: true,
      failed: true,
      stopped: true,
      lateCompletionReconciled: true,
      readableContext: true,
      noOverflow: true,
    }),
  );
} finally {
  await browser.close();
}
