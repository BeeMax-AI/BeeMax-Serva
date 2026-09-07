import type { Report } from "../../shared/domain.js";
import {
  adviceFollowup,
  reviewDue,
  filterAdvice,
} from "../../shared/advice-followup.js";
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
  const filter = state.adviceFilters[report.id] || "all";
  const rows = filterAdvice(data.rows, filter, today);
  const labels = {
    all: "全部建议",
    new: "待评估",
    following: "跟进中",
    done: "已完成",
    due: "待复盘",
  };
  return `<section class="panel advice-followup" aria-label="当前报告建议跟进">
    <div class="config-title"><div><h2>建议行动与跟进</h2><p>当前报告 · ${esc(report.name)} · ${esc(report.start)}${report.end !== report.start ? " — " + esc(report.end) : ""}</p></div></div>
    <div class="followup-counts">${[
      ["new", "待评估", data.pending],
      ["following", "跟进中", data.following],
      ["done", "已完成", data.done],
      ["due", "待复盘", data.due],
    ]
      .map(
        ([id, label, count]) =>
          `<button type="button" data-followup-filter="${id}" data-report="${esc(report.id)}" aria-pressed="${filter === id}" aria-controls="followup-list" class="${filter === id ? "active" : ""}"><span>${label}</span><strong>${count}<small>条</small></strong></button>`,
      )
      .join("")}</div>
    <p class="followup-note">待复盘：跟进中且复盘日期已到的建议，包含在“跟进中”数量内。</p>
    <div class="followup-list-heading"><h3>${labels[filter]} <span aria-live="polite">${rows.length} 条</span></h3><button type="button" class="text-link" data-followup-filter="all" data-report="${esc(report.id)}" aria-pressed="${filter === "all"}" aria-controls="followup-list">查看全部 ${data.rows.length} 条</button></div>
    <div id="followup-list">${
      rows.length
        ? table(
            ["建议 / 数据依据", "优先级", "负责人", "复盘日期", "状态", "操作"],
            slicePage(rows, state.pageSize, scope).map(
              (a) => `<tr>
      <td><strong>${esc(a.title)}</strong><details data-report-disclosure="followup-${esc(a.id)}"><summary>查看依据与行动</summary><p><b>依据：</b>${esc(a.evidence || "暂无数据依据")}</p><p><b>行动：</b>${esc(a.action)}</p><a class="text-link" href="#tickets">打开工单明细 →</a></details></td>
      <td>${a.priority ? tag({ high: "优先处理", medium: "建议跟进", low: "持续观察" }[a.priority], a.priority === "high") : "未标注"}</td>
      <td>${a.ownerId ? esc(personName(a.ownerId)) : "未安排"}</td>
      <td>${esc(a.reviewAt || "未安排")}${reviewDue(a, today) ? '<small class="followup-due">待复盘</small>' : ""}</td>
      <td>${tag({ new: "待评估", following: "跟进中", done: "已完成" }[a.status], a.status === "following")}</td>
      <td><button class="text-link" data-advice="${esc(a.id)}" data-report="${esc(report.id)}" ${canWrite() ? "" : "disabled"}>${a.status === "following" ? "完成跟进" : a.status === "done" ? "重新跟进" : "安排跟进"}</button></td>
    </tr>`,
            ),
            "followup-table",
          )
        : `<div class="connection-empty">${data.rows.length ? "暂无" + labels[filter] + "的建议，可切换状态或查看全部。" : "当前报告暂无建议行动。"}</div>`
    }
    ${pager(rows.length, state.pageSize, scope)}</div>
  </section>`;
}
