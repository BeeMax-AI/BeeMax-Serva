/** Isolated browser regression: local fixture data, no remote writes. */
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { seed } from "../server/src/seed.ts";
import { metrics } from "../server/src/metrics.ts";
import { businessDate } from "../server/src/dates.ts";
const playwright = await import(
  process.env.PLAYWRIGHT_MODULE
    ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href
    : "playwright"
);
const browser = await playwright.chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const w = seed("performance-fixture"),
    today = businessDate();
  const boot = {
    actor: {
      id: "test",
      name: "性能测试",
      role: "admin",
      tenantId: w.tenant.id,
    },
    mode: "mcp",
    aiConfigured: false,
    workspace: w,
    conversations: [],
    today,
    metrics: metrics(w, today, today),
  };
  let metricReads = 0,
    detailGate = false;
  const detailPending: Array<() => void> = [];
  let reads = 0,
    gate = false;
  const pending: Array<() => void> = [];
  await page.route("**/api/**", async (route: any) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/bootstrap") {
      reads++;
      if (gate) await new Promise<void>((resolve) => pending.push(resolve));
      await route.fulfill({ json: boot });
    } else if (url.pathname === "/api/metrics") {
      metricReads++;
      await route.fulfill({
        json: metrics(
          w,
          url.searchParams.get("start") || today,
          url.searchParams.get("end") || today,
        ),
      });
    } else if (url.pathname.startsWith("/api/tickets/")) {
      if (detailGate)
        await new Promise<void>((resolve) => detailPending.push(resolve));
      await route.fulfill({
        json: w.tickets.find(
          (t) => t.id === decodeURIComponent(url.pathname.slice(13)),
        ),
      });
    } else
      await route.fulfill({
        status: 503,
        json: { error: { message: "测试不允许写入" } },
      });
  });
  await page.goto(
    (process.env.APP_URL || "http://127.0.0.1:8766") + "/#settings",
  );
  await page.getByRole("heading", { name: "规则清楚，协作有序。" }).waitFor();
  const initialReads = reads;
  gate = true;
  const start = Date.now();
  await page.locator('nav a[href="#overview"]').click();
  let immediate = true;
  try {
    await page
      .getByRole("heading", { name: "每一单，都有着落。" })
      .waitFor({ timeout: 700 });
  } catch {
    immediate = false;
  }
  console.log(
    JSON.stringify({
      navigationMs: Date.now() - start,
      immediate,
      extraBootstrapRequests: reads - initialReads,
    }),
  );
  gate = false;
  pending.forEach((resolve) => resolve());
  if (process.env.SCENARIO !== "detail")
    assert.ok(
      immediate,
      "Navigation must render loaded data without waiting for a blocked MCP request",
    );
  if (process.env.SCENARIO !== "detail")
    assert.equal(
      reads,
      initialReads,
      "Navigation must not resync the entire workspace",
    );
  await page.getByRole("heading", { name: "每一单，都有着落。" }).waitFor();
  detailGate = true;
  await page.locator("[data-ticket]").first().click();
  let loading = true;
  try {
    await page.getByRole("dialog").waitFor({ timeout: 500 });
  } catch {
    loading = false;
  }
  if (loading)
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "关闭", exact: true })
      .click();
  await page.locator('nav a[href="#settings"]').click();
  detailGate = false;
  detailPending.forEach((resolve) => resolve());
  await page.waitForTimeout(100);
  const reopened = (await page.getByRole("dialog").count()) > 0;
  console.log(
    JSON.stringify({
      detailLoadingImmediate: loading,
      closedDetailReopened: reopened,
    }),
  );
  assert.ok(loading, "Ticket details must display immediate loading feedback");
  assert.ok(!reopened, "Late ticket response must not reopen a closed dialog");
  if (process.env.SCENARIO === "detail") process.exitCode = 0;
  else {
    await page.locator('nav a[href="#overview"]').click();
    const previousMetrics = metricReads;
    await page.getByRole("button", { name: "月", exact: true }).click();
    assert.equal(
      metricReads,
      previousMetrics,
      "Changing trend range must use the loaded snapshot",
    );
    const beforeRefresh = reads;
    gate = true;
    await page.getByRole("button", { name: "刷新页面", exact: true }).click();
    await page.getByRole("button", { name: "刷新页面", exact: true }).click();
    await page.waitForTimeout(50);
    gate = false;
    pending.forEach((resolve) => resolve());
    assert.equal(
      reads - beforeRefresh,
      1,
      "Repeated refresh clicks must share one in-flight request",
    );
    console.log(
      JSON.stringify({
        rangeRequests: metricReads - previousMetrics,
        refreshRequests: reads - beforeRefresh,
      }),
    );
  }
  // Switching between reused dialogs must not let an old close event cancel a new read.
  boot.mode = "local";
  await page.goto(
    (process.env.APP_URL || "http://127.0.0.1:8766") + "/#messages",
  );
  const linked = w.messages.find((m) => m.ticketId)!;
  await page.locator(`[data-message="${linked.id}"]`).click();
  detailGate = true;
  await page.getByRole("dialog").locator("[data-ticket]").click();
  await page.waitForTimeout(50);
  detailGate = false;
  detailPending.forEach((resolve) => resolve());
  let switched = true;
  try {
    await page
      .getByRole("heading", { name: "工单 " + linked.ticketId, exact: true })
      .waitFor({ timeout: 700 });
  } catch {
    switched = false;
  }
  console.log(JSON.stringify({ messageToTicket: switched }));
  assert.ok(
    switched,
    "An old modal close event must not abort the new ticket request",
  );
} finally {
  await browser.close();
}
