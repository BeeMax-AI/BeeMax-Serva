import type { Report } from "../../shared/domain.js";
import { adviceFollowup, reviewDue } from "../../shared/advice-followup.js";
import {
  state,
  esc,
  tag,
  personName,
  table,
  pager,
  slicePage,
  canWrite,
} from "./core.js";

export function followupPanel(report: Report) {
  const today = state.boot!.today;
  const data = adviceFollowup(report.advice, today);
  const scope = "advice-followup-" + report.id;
  return `<section class="panel advice-followup" aria-label="当前报告建议跟进">
    <div class="config-title"><div><h2>建议跟进</h2><p>当前报告 · ${esc(report.name)} · ${esc(report.start)}${report.end !== report.start ? " — " + esc(report.end) : ""}</p></div></div>
    <div class="followup-counts">${[
      ["待评估", data.pending],
      ["跟进中", data.following],
      ["已完成", data.done],
      ["待复盘", data.due],
    ]
      .map(
        ([label, count]) =>
          `<div><span>${label}</span><strong>${count}<small>条</small></strong></div>`,
      )
      .join("")}</div>
    <p class="followup-note">待复盘：跟进中且复盘日期已到的建议，包含在“跟进中”数量内。</p>
    <div class="followup-list-heading"><h3>重点跟进清单</h3><span>到期事项优先 · 共 ${data.rows.length} 条</span></div>
    ${
      data.rows.length
        ? table(
            ["建议 / 数据依据", "优先级", "负责人", "复盘日期", "状态", "操作"],
            slicePage(data.rows, state.pageSize, scope).map(
              (a) => `<tr>
      <td><strong>${esc(a.title)}</strong><details data-report-disclosure="followup-${esc(a.id)}"><summary>查看依据与行动</summary><p><b>依据：</b>${esc(a.evidence || "暂无数据依据")}</p><p><b>行动：</b>${esc(a.action)}</p></details></td>
      <td>${a.priority ? tag({ high: "优先处理", medium: "建议跟进", low: "持续观察" }[a.priority], a.priority === "high") : "未标注"}</td>
      <td>${a.ownerId ? esc(personName(a.ownerId)) : "未安排"}</td>
      <td>${esc(a.reviewAt || "未安排")}${reviewDue(a, today) ? '<small class="followup-due">待复盘</small>' : ""}</td>
      <td>${tag({ new: "待评估", following: "跟进中", done: "已完成" }[a.status], a.status === "following")}</td>
      <td>${a.status === "done" ? '<span class="followup-completed">已完成</span>' : `<button class="text-link" data-advice="${esc(a.id)}" data-report="${esc(report.id)}" ${canWrite() ? "" : "disabled"}>${a.status === "following" ? "完成跟进" : "安排跟进"}</button>`}</td>
    </tr>`,
            ),
            "followup-table",
          )
        : '<div class="connection-empty">当前报告暂无建议行动。</div>'
    }
    ${pager(data.rows.length, state.pageSize, scope)}
  </section>`;
}
