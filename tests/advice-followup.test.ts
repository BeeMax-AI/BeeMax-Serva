import { test } from "node:test";
import assert from "node:assert/strict";
import {
  adviceFollowup,
  reviewDue,
  filterAdvice,
} from "../shared/advice-followup.ts";
import { followupPanel } from "../client/src/advice-followup.ts";
import { state } from "../client/src/core.ts";
import { seed } from "../server/src/seed.ts";
import { metrics } from "../server/src/metrics.ts";
import type { Advice, Report } from "../shared/domain.ts";
const advice = (
  id: string,
  status: Advice["status"],
  reviewAt?: string,
  priority?: Advice["priority"],
): Advice => ({
  id,
  status,
  reviewAt,
  priority,
  title: id,
  action: "处理",
  evidence: "依据",
});

test("follow-up counts only the selected report and due is a subset of following", () => {
  const rows = [
    advice("new", "new", "2026-09-01"),
    advice("today", "following", "2026-09-07"),
    advice("past", "following", "2026-09-06"),
    advice("later", "following", "2026-09-08"),
    advice("done", "done", "2026-09-01"),
  ];
  const result = adviceFollowup(rows, "2026-09-07");
  assert.deepEqual(
    [result.pending, result.following, result.done, result.due],
    [1, 3, 1, 2],
  );
  assert.deepEqual(
    result.rows.slice(0, 2).map((a) => a.id),
    ["today", "past"],
  );
  assert.deepEqual(
    rows.map((a) => a.id),
    ["new", "today", "past", "later", "done"],
  );
});

test("missing or invalid review dates do not become due", () => {
  for (const date of [
    undefined,
    "",
    "not-a-date",
    "2026-02-30",
    "2026-13-01",
    "2026-9-1",
  ])
    assert.equal(
      reviewDue(advice("invalid", "following", date), "2026-09-07"),
      false,
    );
  assert.equal(
    reviewDue(advice("valid", "following", "2024-02-29"), "2026-09-07"),
    true,
  );
});

test("duplicate advice ids are counted once; unresolved priority sorts ahead of completed", () => {
  const duplicate = advice("same", "following", undefined, "high");
  const result = adviceFollowup(
    [
      advice("done", "done", undefined, "high"),
      advice("same", "new"),
      advice("low", "new", undefined, "low"),
      duplicate,
    ],
    "2026-09-07",
  );
  assert.deepEqual(
    result.rows.map((a) => a.id),
    ["same", "low", "done"],
  );
  assert.equal(result.following, 0);
  assert.equal(result.pending, 2);
  assert.equal(result.rows.find((a) => a.id === "same")?.status, "new");
  assert.deepEqual(adviceFollowup([], "2026-09-07"), {
    rows: [],
    pending: 0,
    following: 0,
    done: 0,
    due: 0,
  });
});

test("status filters keep counts independent and due excludes completed or undated advice", () => {
  const rows = [
    advice("new", "new"),
    advice("due", "following", "2026-09-07"),
    advice("later", "following", "2026-09-08"),
    advice("undated", "following"),
    advice("done", "done", "2026-09-06"),
  ];
  assert.deepEqual(
    filterAdvice(rows, "due", "2026-09-07").map((a) => a.id),
    ["due"],
  );
  assert.equal(filterAdvice(rows, "following", "2026-09-07").length, 3);
  assert.equal(filterAdvice(rows, "all", "2026-09-07").length, 5);
  assert.deepEqual(
    filterAdvice(rows, "done", "2026-09-07").map((a) => a.id),
    ["done"],
  );
  assert.deepEqual(
    filterAdvice(rows, "new", "2026-09-07").map((a) => a.id),
    ["new"],
  );
  assert.equal(adviceFollowup(rows, "2026-09-07").following, 3);
});

test("merged ledger preserves restarting completed advice and read-only permission", () => {
  const workspace = seed("followup-ui-test");
  const today = "2026-09-07";
  state.boot = {
    workspace,
    actor: {
      id: "admin",
      name: "管理员",
      role: "admin",
      tenantId: workspace.tenant.id,
    },
    conversations: [],
    mode: "local",
    aiConfigured: false,
    today,
    metrics: metrics(workspace, today, today),
  };
  state.adviceFilters = {};
  state.extraPages = {};
  state.pageSize = 10;
  const report: Report = {
    id: "report",
    name: "测试报告",
    runKey: "test",
    start: today,
    end: today,
    generatedAt: today,
    mode: "rules",
    summary: "摘要",
    coverage: "测试",
    advice: [advice("done", "done")],
  };
  let html = followupPanel(report);
  assert.match(html, /data-advice="done"[^>]*>重新跟进/);
  state.boot.actor.role = "viewer";
  html = followupPanel(report);
  assert.match(html, /data-advice="done"[^>]*disabled>重新跟进/);
  state.adviceFilters[report.id] = "following";
  html = followupPanel(report);
  assert.match(html, /暂无跟进中的建议/);
  assert.doesNotMatch(html, /data-advice="done"/);
  assert.match(html, /查看全部 1 条/);
});
