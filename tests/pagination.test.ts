import { test } from "node:test";
import assert from "node:assert/strict";
import { pageWindow } from "../shared/pagination.ts";
import { state, slicePage, pager, setPage } from "../client/src/core.ts";
import { roster } from "../client/src/roster.ts";
import { settings } from "../client/src/settings.ts";
import { staff, tickets, insights } from "../client/src/pages.ts";
import { seed } from "../server/src/seed.ts";
import { metrics } from "../server/src/metrics.ts";
import { businessDate } from "../server/src/dates.ts";
function setup() {
  const w = seed("pagination-test"),
    today = businessDate();
  w.people = Array.from({ length: 65 }, (_, i) => ({
    id: "person-" + i,
    name: "人员" + i,
    groupId: w.groups[i % w.groups.length].id,
    tier: (i % 4) + 1,
    active: true,
  }));
  w.routes = Array.from({ length: 65 }, (_, i) => ({
    id: "route-" + i,
    type: "类型" + i,
    keywords: "词" + i,
    groupId: w.groups[0].id,
    source: "测试",
  }));
  w.audit = Array.from({ length: 65 }, (_, i) => ({
    id: "audit-" + i,
    at: new Date().toISOString(),
    actor: "人员" + i,
    action: "person.save",
    target: "记录" + i,
    detail: "变更",
  }));
  state.boot = {
    actor: { id: "test", name: "测试", role: "admin", tenantId: w.tenant.id },
    workspace: w,
    conversations: [],
    mode: "local",
    aiConfigured: false,
    today,
    metrics: metrics(w, today, today),
  };
  Object.assign(state, {
    page: "settings",
    tab: "roster",
    query: "",
    group: "",
    tier: "",
    pageSize: 20,
    listPage: 1,
    extraPages: {},
  });
  return w;
}
const rowCount = (html: string) => (html.match(/<tr>/g) || []).length - 1;
test("empty results and pages after filtering or deletion clamp correctly", () => {
  assert.deepEqual(pageWindow(0, 4, 20), {
    page: 1,
    pages: 1,
    start: 0,
    end: 0,
    count: 0,
    size: 20,
  });
  assert.equal(pageWindow(37, 2, 20).end, 37);
  assert.equal(pageWindow(3, 4, 30).page, 1);
  assert.equal(pageWindow(21, 0, 20).page, 1);
});
test("roster, routes and audit share 10/20/30 paging and include the final records", () => {
  setup();
  for (const tab of ["roster", "routing", "audit"]) {
    state.tab = tab;
    const render = tab === "roster" ? roster : settings;
    state.pageSize = 10;
    state.listPage = 1;
    assert.equal(rowCount(render()), 10);
    state.listPage = 7;
    assert.equal(rowCount(render()), 5);
    assert.match(render(), /第 7 \/ 7 页/);
    state.pageSize = 20;
    state.listPage = 1;
    assert.equal(rowCount(render()), 20);
    state.listPage = 4;
    assert.equal(rowCount(render()), 5);
    state.pageSize = 30;
    state.listPage = 2;
    assert.equal(rowCount(render()), 30);
    state.listPage = 3;
    assert.equal(rowCount(render()), 5);
  }
});
test("roster filters apply before slicing and empty results never leave a stale page", () => {
  setup();
  state.listPage = 4;
  state.query = "人员64";
  const html = roster();
  assert.equal(rowCount(html), 1);
  assert.equal(state.listPage, 1);
  assert.match(html, /人员64/);
  state.query = "不存在的人";
  const empty = roster();
  assert.match(empty, /暂无匹配记录/);
  assert.match(empty, /0–0 条/);
});
test("report and plan manager page scopes do not change the main list page", () => {
  setup();
  state.listPage = 3;
  setPage(2, "reports");
  setPage(4, "plans-modal");
  const rows = Array.from({ length: 65 }, (_, i) => i);
  assert.deepEqual(slicePage(rows, 20, "reports"), rows.slice(20, 40));
  assert.equal(state.listPage, 3);
  assert.equal(state.extraPages["plans-modal"], 4);
  assert.match(pager(65, 20, "reports"), /第 2 \/ 4 页/);
});
test("staff and ticket lists use the shared page size, while summaries retain all filtered people", () => {
  const w = setup();
  state.page = "staff";
  assert.equal(rowCount(staff()), 20);
  assert.match(staff(), /65 条记录/);
  state.pageSize = 30;
  assert.equal(rowCount(staff()), 30);
  w.tickets = Array.from({ length: 45 }, (_, i) => ({
    ...w.tickets[0],
    id: "ticket-" + i,
  }));
  state.page = "tickets";
  assert.equal(rowCount(tickets()), 30);
  state.pageSize = 10;
  state.listPage = 2;
  assert.equal(rowCount(tickets()), 10);
  assert.match(tickets(), /11–20 条/);
  assert.match(tickets(), /value="10" selected/);
});

test("viewer can open all plans while the analysis preview stays bounded", () => {
  const w = setup();
  w.plans = Array.from({ length: 35 }, (_, i) => ({
    ...w.plans[0],
    id: "plan-" + i,
  }));
  state.boot!.actor.role = "viewer";
  const html = insights();
  assert.equal((html.match(/class="schedule-preview"/g) || []).length, 6);
  const manager = html.match(/<button[^>]*data-action="plans"[^>]*>/)?.[0];
  assert.ok(manager);
  assert.ok(!manager.includes("disabled"));
});
