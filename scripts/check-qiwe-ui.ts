/** Real API and temporary encrypted storage; bootstrap only simulates the MCP UI mode. */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Store } from "../server/src/store.ts";
import { createApp } from "../server/src/http.ts";
const pw = await import(
  process.env.PLAYWRIGHT_MODULE
    ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href
    : "playwright"
);
const dir = mkdtempSync(join(tmpdir(), "qiwe-ui-")),
  store = new Store(dir);
store.initialize();
const app = createApp(store, process.cwd(), "local");
await new Promise<void>((resolve) =>
  app.server.listen(0, "127.0.0.1", resolve),
);
const base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
const browser = await pw.chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1050 },
  });
  const errors: string[] = [];
  page.on("pageerror", (e: Error) => errors.push(e.message));
  const cookie = store.createSession({
    id: "owner",
    name: "平台管理员",
    role: "owner",
    tenantId: "demo",
  });
  await page
    .context()
    .addCookies([{ name: "qf_session", value: cookie, url: base }]);
  await page.route("**/api/bootstrap", async (route: any) => {
    const r = await route.fetch(),
      data = await r.json();
    data.mode = "mcp";
    data.workspace.integration = {
      tools: [],
      notices: [],
      commands: [],
      loaded: 0,
      total: 0,
      complete: true,
      checkedAt: new Date().toISOString(),
      rosterNote: "",
    };
    await route.fulfill({ json: data });
  });
  await page.goto(base + "/#settings");
  await page.getByRole("tab", { name: "QiWe 连接", exact: true }).click();
  assert.equal(
    await page.getByRole("tab", { name: "MCP 数据连接", exact: true }).count(),
    1,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "检测连接", exact: true })
      .isDisabled(),
    true,
  );
  await page.locator('[name="token"]').fill("ui-fake-token");
  await page.locator('[name="account"]').fill("manager-ui");
  await page.locator('[name="password"]').fill(" ui-fake-password ");
  await page.getByLabel("显示本次输入").check();
  assert.equal(
    await page.locator('[name="password"]').getAttribute("type"),
    "text",
  );
  await page.getByRole("button", { name: "重置输入" }).click();
  assert.equal(
    await page.locator('[name="password"]').getAttribute("type"),
    "password",
  );
  assert.equal(await page.locator('[name="token"]').inputValue(), "");
  await page.locator('[name="token"]').fill("ui-fake-token");
  await page.locator('[name="account"]').fill("manager-ui");
  await page.locator('[name="password"]').fill(" ui-fake-password ");
  await page.getByRole("button", { name: "保存配置", exact: true }).click();
  await page.getByText("凭据已保存", { exact: true }).waitFor();
  assert.equal(await page.locator('[name="token"]').inputValue(), "");
  assert.equal(store.getSecret("demo").password, " ui-fake-password ");
  assert.equal(await page.getByText("未验证", { exact: true }).count(), 1);
  await page.getByRole("tab", { name: "MCP 数据连接", exact: true }).click();
  assert.equal(
    await page
      .getByRole("heading", { name: "MCP 数据连接", exact: true })
      .count(),
    1,
  );
  await page.getByRole("tab", { name: "QiWe 连接", exact: true }).click();
  await page.screenshot({
    path: ".local/qiwe-settings-ui.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.screenshot({
    path: ".local/qiwe-settings-mobile.png",
    fullPage: true,
  });
  await page.reload();
  await page.getByRole("tab", { name: "QiWe 连接", exact: true }).click();
  await page.getByText("凭据已保存", { exact: true }).waitFor();
  const viewer = store.createSession({
    id: "viewer",
    name: "只读用户",
    role: "viewer",
    tenantId: "demo",
  });
  await page
    .context()
    .addCookies([{ name: "qf_session", value: viewer, url: base }]);
  await page.reload();
  await page.getByRole("tab", { name: "QiWe 连接", exact: true }).click();
  assert.equal(await page.locator("#credential-form").count(), 0);
  assert.equal(await page.getByText("凭据已保存", { exact: true }).count(), 1);
  // Saving QiWe must not leave the next business configuration command stale.
  await page.unroute("**/api/bootstrap");
  await page
    .context()
    .addCookies([{ name: "qf_session", value: cookie, url: base }]);
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.reload();
  await page.getByRole("tab", { name: "QiWe 连接", exact: true }).click();
  await page.locator('[name="token"]').fill("updated-ui-token");
  const savedResponse = page.waitForResponse(
    (r: any) =>
      r.url().endsWith("/api/qiwe/connection") &&
      r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "保存配置", exact: true }).click();
  assert.equal((await savedResponse).status(), 200);
  await page.getByRole("button", { name: "保存配置", exact: true }).waitFor();
  await page.getByRole("tab", { name: "变更记录", exact: true }).click();
  assert.ok(
    await page
      .getByText("更新 QiWe 连接凭据（内容不记录）", { exact: true })
      .count(),
  );
  await page.getByRole("tab", { name: "派单参数", exact: true }).click();
  await page.getByRole("button", { name: "编辑参数", exact: true }).click();
  await page.locator('[name="escalationMinutes"]').fill("15");
  await page.getByRole("button", { name: "预览变更", exact: true }).click();
  const commandResponse = page.waitForResponse((r: any) =>
    r.url().endsWith("/api/commands"),
  );
  await page.locator('#modal button[type="submit"]').click();
  assert.equal((await commandResponse).status(), 200);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      independentTabs: true,
      realApiSave: true,
      resetHidesSecrets: true,
      persisted: true,
      readOnly: true,
      unverifiedStatus: true,
      noOverflow: true,
    }),
  );
} finally {
  await browser.close();
  await new Promise<void>((resolve) => app.server.close(() => resolve()));
  store.close();
  rmSync(dir, { recursive: true, force: true });
}
