import { test } from "node:test";
import assert from "node:assert/strict";
import { state, refresh } from "../client/src/core.ts";
import { refreshConnections } from "../client/src/connections.ts";
import { preserveConnections } from "../client/src/bootstrap-state.ts";
import { seed } from "../server/src/seed.ts";
import { metrics } from "../server/src/metrics.ts";
import type { Bootstrap, ConnectionWorkspace } from "../shared/domain.ts";
const snapshot = (revision: number): ConnectionWorkspace => ({
  revision,
  accounts: [],
  messages: [],
  audit: [
    {
      id: `a${revision}`,
      at: "2026-09-06T09:00:00Z",
      actor: "测试",
      action: "account.save",
      target: "test",
      detail: "修改实例",
    },
  ],
  updatedAt: null,
  channelStatus: "not_connected",
});
const boot = (revision: number): Bootstrap => {
  const w = seed("demo");
  return {
    actor: { id: "admin", name: "测试", role: "admin", tenantId: "demo" },
    mode: "mcp",
    aiConfigured: false,
    connections: snapshot(revision),
    workspace: w,
    conversations: [],
    today: "2026-09-06",
    metrics: metrics(w, "2026-09-06", "2026-09-06"),
  };
};
test("late connection refresh cannot replace a newer save and emits only connection-specific updates", async () => {
  const originalFetch = globalThis.fetch,
    originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const target = new EventTarget(),
    events: string[] = [];
  target.addEventListener("connections-updated", () =>
    events.push("connections"),
  );
  target.addEventListener("data-updated", () => events.push("business"));
  Object.defineProperty(globalThis, "window", {
    value: target,
    configurable: true,
  });
  let finish!: (value: Response) => void;
  globalThis.fetch = () =>
    new Promise<Response>((resolve) => (finish = resolve));
  state.boot = boot(1);
  try {
    const pending = refreshConnections();
    state.boot = boot(2); // a save completes while the revision-1 refresh is still in flight
    finish(new Response(JSON.stringify(snapshot(1))));
    await pending;
    assert.equal(state.boot.connections!.revision, 2);
    assert.equal(state.boot.connections!.audit[0].id, "a2");
    assert.ok(
      !events.includes("business"),
      "connection refresh must not reset or mark the MCP scheduler synced",
    );
    const next = refreshConnections();
    finish(new Response(JSON.stringify(snapshot(3))));
    await next;
    assert.equal(state.boot.connections!.revision, 3);
    assert.ok(state.boot.workspace.audit.some((a) => a.id === "a3"));
    assert.deepEqual(events, ["connections", "connections"]);
  } finally {
    globalThis.fetch = originalFetch;
    state.boot = null;
    if (originalWindow)
      Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
test("a slow business bootstrap preserves newer connection state only for the same user and tenant", () => {
  state.boot = boot(4);
  const old = boot(2);
  preserveConnections(state.boot, old);
  assert.equal(old.connections!.revision, 4);
  assert.ok(old.workspace.audit.some((a) => a.id === "a4"));
  const other = boot(2);
  other.actor.tenantId = "other";
  preserveConnections(state.boot, other);
  assert.equal(other.connections!.revision, 2);
  const newer = boot(5);
  preserveConnections(state.boot, newer);
  assert.equal(newer.connections!.revision, 5);
  state.boot = null;
});

test("business-command refresh also preserves an independently saved newer connection revision", async () => {
  const originalFetch = globalThis.fetch;
  let finish!: (r: Response) => void;
  globalThis.fetch = () =>
    new Promise<Response>((resolve) => (finish = resolve));
  state.boot = boot(1);
  try {
    const pending = refresh();
    state.boot = boot(3);
    finish(new Response(JSON.stringify(boot(1))));
    await pending;
    assert.equal(state.boot.connections!.revision, 3);
    assert.ok(state.boot.workspace.audit.some((a) => a.id === "a3"));
  } finally {
    globalThis.fetch = originalFetch;
    state.boot = null;
  }
});

test("migrated connection pages use independent records, paginate 20/30 and filter logs", async () => {
  const pages = await import("../client/src/pages.ts");
  state.boot = boot(1);
  state.boot.workspace.integration = {
    tools: [],
    notices: [],
    commands: [],
    loaded: 0,
    total: 0,
    complete: true,
    checkedAt: "2026-09-06T09:00:00Z",
    rosterNote: "",
  };
  const c = state.boot.connections!;
  c.accounts = [
    {
      id: "test-account",
      name: "独立账号",
      company: "公司",
      status: "offline",
      login: "未登录",
      groups: [],
    },
  ];
  c.messages = Array.from({ length: 35 }, (_, i) => ({
    id: `message-${i}`,
    accountId: "test-account",
    direction: i % 2 ? "out" : "in",
    contact: "测试会话",
    chatId: "chat-test",
    type: "text",
    content: `验证消息 ${i}`,
    status: i % 2 ? "completed" : "pending",
    at: "2026-09-06T09:00:00Z",
  }));
  state.account = "";
  state.query = "";
  state.status = "";
  state.direction = "";
  state.messageType = "";
  state.listPage = 1;
  state.pageSize = 20;
  try {
    assert.ok(pages.accounts().includes("独立账号"));
    assert.ok(!pages.accounts().includes("当前 MCP 未提供"));
    assert.equal((pages.messages().match(/data-message="/g) || []).length, 20);
    state.listPage = 2;
    assert.equal((pages.messages().match(/data-message="/g) || []).length, 15);
    state.pageSize = 30;
    state.listPage = 1;
    assert.equal((pages.messages().match(/data-message="/g) || []).length, 30);
    state.status = "pending";
    assert.equal((pages.messages().match(/data-message="/g) || []).length, 18);
    state.query = "验证消息 34";
    assert.equal((pages.messages().match(/data-message="/g) || []).length, 1);
    state.account = "another";
    assert.ok(pages.messages().includes("暂无匹配记录"));
  } finally {
    state.boot = null;
    state.account = "";
    state.query = "";
    state.status = "";
    state.listPage = 1;
    state.pageSize = 20;
  }
});

test("whitelist navigation moves to accounts and preserves explicit channel scope", async () => {
  const { whitelistSection } = await import("../client/src/whitelist.ts");
  const { tabs } = await import("../client/src/settings.ts");
  state.boot = boot(1);
  state.boot.connections!.accounts = [
    {
      id: "a",
      name: "测试实例",
      company: "公司",
      login: "未登录",
      status: "offline",
      groups: [
        { id: "old", name: "旧群", addedAt: "2026-09-06" },
        { id: "new", name: "新群", addedAt: "2026-09-06", pushEnabled: false },
      ],
      members: [{ id: "p", name: "<用户>", addedAt: "2026-09-06" }],
    },
  ];
  state.agent = "a";
  state.listPage = 1;
  state.whitelistTab = "authorization";
  state.whitelistKind = "members";
  assert.ok(!tabs.some(([id]) => ["push", "access"].includes(id)));
  let html = whitelistSection();
  assert.match(html, /人员白名单/);
  assert.match(html, /&lt;用户&gt;/);
  assert.match(html, /data-kind="member"/);
  state.whitelistTab = "push";
  html = whitelistSection();
  assert.match(html, /1 个群开启/);
  assert.match(html, /data-push-group="old" data-enabled="false"/);
  assert.match(html, /data-push-group="new" data-enabled="true"/);
  state.whitelistTab = "access";
  state.agent = "";
  html = whitelistSection();
  assert.match(html, /生效范围：整个渠道/);
  assert.match(html, /data-whitelist-tab="authorization"/);
  state.agent = "a";
  state.whitelistTab = "authorization";
  state.boot.actor.role = "viewer";
  assert.doesNotMatch(whitelistSection(), /id="whitelist-form"/);
});

test("embedded whitelist remains visible with no accounts and paginates independently", async () => {
  const { accounts } = await import("../client/src/pages.ts");
  state.boot = boot(1);
  state.whitelistTab = "authorization";
  state.whitelistKind = "groups";
  state.account = "";
  state.agent = "";
  state.listPage = 1;
  state.pageSize = 20;
  state.extraPages = {};
  state.whitelistPageSize = 20;
  let html = accounts();
  for (const label of ["白名单授权", "推送设置", "访问权限"])
    assert.ok(html.includes(label));
  assert.ok(
    html.indexOf('id="account-whitelist"') >
      html.indexOf('data-pagination="main"'),
  );
  const groups = Array.from({ length: 25 }, (_, i) => ({
    id: `group-${i}`,
    name: `群${i}`,
    addedAt: "2026-09-06",
  }));
  state.boot.connections!.accounts = Array.from({ length: 25 }, (_, i) => ({
    id: `account-${i}`,
    name: `账号${i}`,
    company: "测试",
    login: "未登录",
    status: "offline",
    groups,
  }));
  state.agent = "account-0";
  state.listPage = 2;
  state.extraPages.whitelist = 1;
  html = accounts();
  assert.match(html, /data-agent="account-20"/);
  assert.match(html, /data-whitelist-remove="group-0"/);
  assert.doesNotMatch(html, /data-whitelist-remove="group-24"/);
  assert.equal(state.listPage, 2);
  state.extraPages.whitelist = 2;
  html = accounts();
  assert.match(html, /data-whitelist-remove="group-24"/);
  assert.equal(state.listPage, 2);
  state.whitelistPageSize = 30;
  state.extraPages.whitelist = 1;
  html = accounts();
  assert.match(html, /data-whitelist-remove="group-24"/);
  assert.equal(state.pageSize, 20);
  assert.equal(state.listPage, 2);
  assert.ok(html.includes("实例 ID：account-0"));
});
