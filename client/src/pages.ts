import { whitelistSection } from "./whitelist.js";
import { connections } from "./connections.js";
import { remoteActions } from "./mcp.js";
import { statuses } from "../../shared/domain.js";
import type { Metrics, Ticket, Report } from "../../shared/domain.js";
import {
  state,
  w,
  esc,
  fmt,
  dateOf,
  offsetDate,
  icon,
  button,
  tag,
  statusTag,
  groupName,
  personName,
  title,
  rail,
  options,
  empty,
  table,
  pager,
  slicePage,
  canWrite,
} from "./core.js";
export function chart(m: Metrics) {
  const width = window.innerWidth < 720 ? 360 : 720,
    rows = m.trend,
    step = Math.max(1, Math.ceil(rows.length / (width === 360 ? 7 : 12))),
    sample = rows.filter((_, i) => i % step === 0 || i === rows.length - 1),
    max = Math.max(1, ...sample.flatMap((r) => [r.created, r.closed])),
    x = (i: number) => 35 + (i * (width - 70)) / Math.max(1, sample.length - 1),
    y = (n: number) => 180 - (n / max) * 150,
    path = (key: "created" | "closed") =>
      sample.map((r, i) => `${i ? "L" : "M"}${x(i)} ${y(r[key])}`).join(" ");
  return `<div class="chart-meta"><span class="legend"><i></i>新建</span><span class="legend closed"><i></i>闭环</span><span>单位：单</span></div><svg class="chart" viewBox="0 0 ${width} 215" role="img" aria-label="期间新建 ${m.created}，闭环 ${m.closed}">${[0, 1, 2, 3].map((n) => `<line class="grid" x1="35" x2="${width - 35}" y1="${y((max * n) / 3)}" y2="${y((max * n) / 3)}"/><text x="5" y="${y((max * n) / 3) + 4}">${Math.round((max * n) / 3)}</text>`).join("")}<path class="line-main" d="${path("created")}"/><path class="line-closed" d="${path("closed")}"/>${sample.map((r, i) => `<circle class="point" r="3" cx="${x(i)}" cy="${y(r.created)}"><title>${r.date}：新建 ${r.created}，闭环 ${r.closed}</title></circle><text x="${x(i)}" y="208" text-anchor="middle">${r.date.slice(5)}</text>`).join("")}</svg>`;
}
function trendPanel() {
  const m = state.metrics!;
  return `<section class="panel"><div class="panel-heading"><div><h2>工单流转趋势</h2><div class="subtext">${esc(m.trend[0]?.date)} — ${esc(m.trend.at(-1)?.date)}</div></div><div class="segmented">${[
    ["day", "日"],
    ["week", "周"],
    ["month", "月"],
  ]
    .map(
      ([id, label]) =>
        `<button data-period="${id}" class="${state.period === id ? "active" : ""}">${label}</button>`,
    )
    .join(
      "",
    )}</div></div><div class="primary-grid"><div class="chart-wrap">${chart(m)}<div class="chart-stats"><span>期间新建<strong>${m.created} <small>单</small></strong></span><span>期间闭环<strong>${m.closed} <small>单</small></strong></span><span>净增积压<strong>${m.created - m.closed} <small>单</small></strong></span></div></div><aside class="insight-side"><div class="insight-title">${icon("spark")}运营洞察</div><h3>${m.created > m.closed ? "关注未闭环记录" : "结合服务记录回顾效率"}</h3><p>期间新建 ${m.created} 单、闭环 ${m.closed} 单。请结合在岗时长和处理难度评估服务表现。</p><a class="text-link" href="#insights">查看分析与建议 ${icon("arrow")}</a><p class="subtext">${state.boot!.mode === "local" ? "本地样例，非完整业务历史" : "基于当前数据范围"}</p></aside></div></section>`;
}
export function staffRows() {
  const today = state.boot!.today;
  return w()
    .people.map((p) => {
      const assigned = w().tickets.filter((t) => t.assigneeId === p.id),
        accepted = assigned.filter(
          (t) => t.acceptedAt && dateOf(t.acceptedAt) === today,
        ),
        response = accepted
          .filter((t) => t.acceptedAt)
          .map(
            (t) =>
              (Date.parse(t.acceptedAt!) - Date.parse(t.createdAt)) / 60000,
          ),
        closed = assigned.filter((t) => t.closedAt && t.acceptedAt),
        process = closed.map(
          (t) => (Date.parse(t.closedAt!) - Date.parse(t.acceptedAt!)) / 60000,
        ),
        avg = (v: number[]) =>
          v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(1) : "—";
      return {
        ...p,
        count: accepted.length,
        open: assigned.filter((t) => t.status !== "CLOSED").length,
        response: avg(response),
        processing: avg(process),
      };
    })
    .sort((a, b) => b.count - a.count);
}
function staffTable(limit?: number, rows = staffRows()) {
  return table(
    [
      "人员 / 小组",
      "今日接单",
      "当前待办",
      "平均响应",
      ...(limit ? [] : ["平均处理"]),
    ],
    (limit ? rows.slice(0, limit) : slicePage(rows, state.pageSize)).map(
      (p) =>
        `<tr><td><div class="person"><span class="avatar">${esc(p.name[0])}</span><div>${esc(p.name)}<small>${esc(groupName(p.groupId))} · ${esc(p.scheduleLabel || (p.active ? "当班" : "未在岗"))}</small></div></div></td><td>${p.count} 单</td><td>${p.open} 单</td><td>${p.response} 分钟</td>${limit ? "" : `<td>${p.processing} 分钟</td>`}</tr>`,
    ),
  );
}
export function overview() {
  const m = state.boot!.metrics,
    priority = w().tickets.filter(
      (t) =>
        t.status.startsWith("ESCALATED_") ||
        ["NO_ACCEPT", "ON_HOLD"].includes(t.status),
    );
  return (
    title(
      "每一单，都有着落。",
      `${state.boot!.actor.name}，欢迎回来。${state.boot!.today} · ${w().tenant.name}`,
      remoteActions() + button("导出简报", "export"),
    ) +
    rail([
      ["今日新单", m.created, "按创建时间"],
      ["待闭环", m.open, "当前全部未闭环"],
      ["今日闭环", m.closed, "按闭环时间"],
      ["待接单 / 挂起", `${m.waiting} / ${m.held}`, "当前状态"],
    ]) +
    trendPanel() +
    `<div class="lower-grid"><section class="panel"><div class="panel-heading"><h2>优先关注 ${tag(String(priority.length))}</h2><a class="text-link" href="#tickets">全部工单 →</a></div>${table(
      [`工单 / ${w().tenant.referenceLabel}`, "状态", "负责人", "操作"],
      priority
        .slice(0, 4)
        .map(
          (t) =>
            `<tr><td><strong>${esc(t.reference)}</strong><small>${esc(t.id)} · ${esc(t.subject)}</small></td><td>${statusTag(t.status)}</td><td>${esc(personName(t.assigneeId))}</td><td><button class="text-link" data-ticket="${esc(t.id)}">查看 →</button></td></tr>`,
        ),
    )}</section><section class="panel"><div class="panel-heading"><h2>人员负载</h2><a class="text-link" href="#staff">人员明细 →</a></div>${staffTable(4)}</section></div>`
  );
}
function bars(items: { name: string; value: number }[]) {
  const max = Math.max(1, ...items.map((r) => r.value));
  return `<div class="horizontal-bars">${items.length ? items.map((r) => `<div class="bar-line"><span>${esc(r.name)}</span><div class="bar-track"><i style="width:${(r.value / max) * 100}%"></i></div><span>${r.value} 单</span></div>`).join("") : empty("当前范围无数据")}</div>`;
}
export function trends() {
  return (
    title(
      "看见趋势，提前行动。",
      "从新建、闭环与积压，了解运营节奏的变化。",
      remoteActions("trends") + button("导出简报", "export"),
    ) +
    trendPanel() +
    `<div class="section-grid"><section class="panel"><div class="panel-heading"><h2>期间工单类型</h2></div>${bars(state.metrics!.byType)}</section><section class="panel"><div class="panel-heading"><h2>期间小组分布</h2></div>${bars(state.metrics!.byGroup)}</section></div>`
  );
}
export function tickets() {
  const rows = w().tickets.filter(
    (t) =>
      (!state.status || t.status === state.status) &&
      (!state.group || t.groupId === state.group) &&
      [t.id, t.subject, t.reference, personName(t.assigneeId), t.type]
        .join(" ")
        .toLowerCase()
        .includes(state.query.toLowerCase()),
  );
  return (
    title("工单明细", "追踪每个处理节点，查看状态、负责人和完整记录。") +
    `<section class="panel"><div class="filters"><label class="search">${icon("search")}<input id="search" aria-label="搜索工单" placeholder="搜索工单、${esc(w().tenant.referenceLabel)}、${w().integration ? "类型" : "问题"}或负责人" value="${esc(state.query)}"></label><select data-filter="status" aria-label="筛选状态">${options(
      Object.entries(statuses).map(([id, name]) => ({ id, name })),
      state.status,
      "全部状态",
    )}</select><select data-filter="group" aria-label="筛选小组">${options(w().groups, state.group, "全部小组")}</select>${button("重置", "reset")}</div>${table(
      ["问题 / 工单", "状态", "负责小组", "负责人", "创建时间", "操作"],
      slicePage(rows).map(
        (t) =>
          `<tr><td><strong>${esc(t.subject)}</strong><small>${esc(t.id)} · ${esc(t.reference)} · ${esc(t.type)}</small></td><td>${statusTag(t.status)}</td><td>${esc(groupName(t.groupId))}</td><td>${esc(personName(t.assigneeId))}</td><td>${fmt(t.createdAt)}</td><td><button class="text-link" data-ticket="${esc(t.id)}">详情 →</button></td></tr>`,
      ),
      "all-tickets",
    )}${pager(rows.length)}</section>`
  );
}
export function staff() {
  const rows = staffRows().filter(
    (p) =>
      (!state.group || p.groupId === state.group) &&
      [p.name, groupName(p.groupId)]
        .join(" ")
        .toLowerCase()
        .includes(state.query.trim().toLowerCase()),
  );
  return (
    title(
      "合理分工，从看见负载开始。",
      "基于人员配置与工单时间戳计算。",
      remoteActions("staff") + button("排班与升级通知", "roster"),
    ) +
    `${w().integration ? `<div class="note-band">${esc(w().integration!.rosterNote)}</div>` : ""}` +
    rail([
      ["人员", rows.length, "当前筛选范围"],
      ["今日接单", rows.reduce((n, p) => n + p.count, 0), "按接单时间"],
      ["当前待办", rows.reduce((n, p) => n + p.open, 0), "未闭环工单"],
      ["最多待办", Math.max(0, ...rows.map((p) => p.open)), "单人当前待办"],
    ]) +
    `<section class="panel staff-panel" aria-label="人员明细"><div class="staff-toolbar"><div class="staff-ledger-title"><h2 tabindex="-1">人员明细</h2><span>${rows.length} 条记录</span></div><div class="staff-controls"><label class="staff-search">${icon("search")}<input id="search" aria-label="搜索人员" placeholder="搜索姓名或小组" value="${esc(state.query)}"></label><label class="staff-group"><span>小组</span><select data-filter="group" aria-label="筛选人员小组">${options(w().groups, state.group, "全部小组")}</select></label>${button("重置", "reset", false, !state.query && !state.group)}</div></div>${staffTable(undefined, rows)}${pager(rows.length)}<div class="panel-footer">平均响应：接单 − 创建；平均处理：闭环 − 接单。仅纳入有效时间戳。</div></section>`
  );
}
export function accounts() {
  const rows = connections().accounts.filter(
    (a) => !state.account || a.id === state.account,
  );
  return (
    title(
      "企微账号",
      "统一管理服务账号，让消息、Agent 与工单协同。",
      button("连接设置", "credentials") +
        button(`${icon("plus")}添加企微账号`, "add-account", true, !canWrite()),
    ) +
    rail([
      ["账号实例", connections().accounts.length, "已保存的实例配置"],
      [
        "在线实例",
        connections().accounts.filter((a) => a.status === "online").length,
        "消息通道待接入",
      ],
      ["连接来源", "QiWe", "企业微信通道"],
      ["数据模式", "配置管理", "独立于工单数据源"],
    ]) +
    `<section class="panel"><div class="config-title"><div><h2>账号实例</h2><p>每个实例独立管理群、人员授权与推送范围。</p></div><select data-filter="account" aria-label="筛选账号实例">${options(connections().accounts, state.account, "全部实例")}</select></div>${
      slicePage(rows)
        .map(
          (a) =>
            `<article class="account-row"><div class="account-identity"><img src="/assets/beemax-logo-mark.svg" alt=""><div><h3>${esc(a.name)}</h3><small>${esc(a.company)}</small>${tag(a.status === "online" ? "在线" : "待连接", a.status === "online")}</div></div><div class="account-fact"><small>登录账号</small><strong>${esc(a.login)}</strong><small>企微登录待接入</small></div><div class="account-fact"><small>白名单</small><strong>${a.groups.length} 个群 · ${a.members?.length || 0} 人</strong><button class="text-link" data-logs="${esc(a.id)}">查看消息日志 →</button></div><div class="connection-actions"><button class="button" data-agent="${esc(a.id)}">白名单 →</button><button class="text-link" data-edit-account="${esc(a.id)}" ${canWrite() ? "" : "disabled"}>管理实例</button></div></article>`,
        )
        .join("") || empty("暂无账号实例，点击「添加企微账号」开始配置")
    }${pager(rows.length)}</section><div class="connection-note">实例与白名单配置已独立保存；登录及消息通道待接入。</div>` +
    whitelistSection()
  );
}
// Preserve old #agent links while displaying the unified account page.
export const agent = accounts;
export const messageStatuses: Record<string, string> = {
  completed: "已完成",
  pending: "等待回调",
  failed: "发送失败",
};
export function messages() {
  const scoped = connections().messages.filter(
      (m) => !state.account || m.accountId === state.account,
    ),
    rows = scoped
      .filter(
        (m) =>
          (!state.direction || m.direction === state.direction) &&
          (!state.messageType || m.type === state.messageType) &&
          (!state.status || m.status === state.status) &&
          [m.id, m.contact, m.chatId, m.content, m.ticketId]
            .join(" ")
            .toLowerCase()
            .includes(state.query.toLowerCase()),
      )
      .sort((a, b) => b.at.localeCompare(a.at));
  return (
    title(
      "消息日志",
      "查看各实例的入站、出站消息与处理状态。",
      `<label class="connection-auto"><input id="message-auto" type="checkbox">每 15 秒刷新</label>${button(`${icon("refresh")}刷新`, "refresh-connections")}`,
    ) +
    rail([
      ["实例日志", scoped.length, "当前实例范围"],
      [
        "入站",
        scoped.filter((m) => m.direction === "in").length,
        "来自客户与工作群",
      ],
      [
        "出站",
        scoped.filter((m) => m.direction === "out").length,
        "Agent 回复与通知",
      ],
      [
        "待关注",
        scoped.filter((m) => m.status !== "completed").length,
        "失败 / 等待回调",
      ],
    ]) +
    `<div class="connection-filters"><label class="connection-search">${icon("search")}<input id="search" aria-label="搜索消息" placeholder="搜索消息、联系人、会话 ID 或工单" value="${esc(state.query)}"></label><select data-filter="account" aria-label="日志实例">${options(connections().accounts, state.account, "全部实例")}</select><select data-filter="direction" aria-label="消息方向">${options(
      [
        { id: "in", name: "入站" },
        { id: "out", name: "出站" },
      ],
      state.direction,
      "全部方向",
    )}</select><select data-filter="messageType" aria-label="消息类型">${options(
      [
        { id: "text", name: "文本" },
        { id: "card", name: "卡片" },
        { id: "image", name: "图片" },
      ],
      state.messageType,
      "全部类型",
    )}</select><select data-filter="status" aria-label="消息状态">${options(
      Object.entries(messageStatuses).map(([id, name]) => ({ id, name })),
      state.status,
      "全部状态",
    )}</select></div><section class="panel">${table(
      ["时间 / 实例", "方向 / 会话", "消息内容", "状态", "操作"],
      slicePage(rows).map(
        (m) =>
          `<tr><td>${fmt(m.at)}<small>${esc(connections().accounts.find((a) => a.id === m.accountId)?.name)}</small></td><td>${tag(m.direction === "in" ? "↙ 入站" : "↗ 出站", m.direction === "out")}<small>${esc(m.contact)}</small></td><td><div class="message-preview"><p>${esc(m.content)}</p></div>${m.ticketId ? `<button class="text-link" data-ticket="${esc(m.ticketId)}">关联工单 ${esc(m.ticketId)} →</button>` : ""}</td><td>${tag(messageStatuses[m.status], m.status === "completed")}</td><td><button class="text-link" data-message="${esc(m.id)}">详情</button></td></tr>`,
      ),
      "message-table",
    )}${pager(rows.length)}</section><div class="connection-note">消息通道尚未接入，暂无真实收发日志。筛选与详情功能已就绪。</div>`
  );
}
export function insights() {
  const reports = w().reports,
    r = reports.find((r) => r.id === state.report) || reports[0],
    enabled = w().plans.filter((p) => p.enabled),
    upcoming = [...enabled].sort((a, b) =>
      a.nextRun.localeCompare(b.nextRun),
    )[0];
  return (
    title(
      "AI智能分析",
      "查看运营表现，确定下一步行动。",
      `<details class="insights-tools"><summary>数据查询</summary><div>${remoteActions()}</div></details>` +
        button("分析计划", "plans") +
        button(`${icon("spark")}立即分析`, "analyze", true, !canWrite()),
    ) +
    analysisTasks() +
    (w().plans.length
      ? `
    <details class="insights-plans"><summary><span>自动分析 <strong>${enabled.length} 个计划开启</strong></span><span>${upcoming ? `下次运行 ${fmt(upcoming.nextRun)}` : "全部计划已暂停"}</span></summary>
      <div class="live-schedules">${w()
        .plans.slice(0, 6)
        .map(
          (p) =>
            `<button data-plan="${esc(p.id)}" class="schedule-preview" ${canWrite() ? "" : "disabled"}><strong>${esc(p.name)}</strong>${tag(p.enabled ? "开启" : "停用", p.enabled)}<small>下次：${fmt(p.nextRun)}</small></button>`,
        )
        .join("")}</div>
    </details>`
      : "") +
    `
    <section class="panel report-main report-reading" data-report-id="${esc(r?.id || "")}">
      <header class="report-reading-header"><div>${r ? `<div class="report-heading-line"><h2>${esc(r.name)}</h2>${tag(r.mode === "model" ? "AI 分析" : "数据汇总")}</div><p>${esc(r.start === r.end ? r.start : `${r.start} — ${r.end}`)} <span>· 生成于 ${fmt(r.generatedAt)}</span></p>` : `<h2>运营分析报告</h2><p>选择日期，开始第一次分析。</p>`}</div>
        <details class="report-library" data-report-disclosure="history"><summary>历史报告 <span>${reports.length}</span></summary><div class="report-library-menu"><div class="report-library-title">共 ${reports.length} 份报告</div>${
          slicePage(reports, state.pageSize, "reports")
            .map(
              (item) =>
                `<button data-report-select="${esc(item.id)}" class="${item.id === r?.id ? "active" : ""}" ${item.id === r?.id ? 'aria-current="true"' : ""}><strong>${esc(item.name)}</strong><small>${esc(item.start === item.end ? item.start : `${item.start} — ${item.end}`)}</small></button>`,
            )
            .join("") || empty("暂无历史报告")
        }${reports.length > state.pageSize ? pager(reports.length, state.pageSize, "reports") : ""}</div></details>
      </header>
      ${
        r
          ? `<div class="report-content">
        ${reportFacts(r)}
        <section class="report-conclusion"><h3>本期结论</h3><p class="report-summary">${esc(r.summary)}</p></section>
        <section class="report-actions-section"><div class="report-section-heading"><h3>建议行动 <span>${r.advice.length}</span></h3><span>展开查看依据与跟进操作</span></div>
          ${
            r.advice
              .slice(0, 3)
              .map((a, i) => reportAdvice(r, a, i))
              .join("") || empty("暂无新建议")
          }
          ${
            r.advice.length > 3
              ? `<details class="report-more" data-report-disclosure="more"><summary>查看其余 ${r.advice.length - 3} 条建议</summary>${r.advice
                  .slice(3)
                  .map((a, i) => reportAdvice(r, a, i + 3))
                  .join("")}</details>`
              : ""
          }
        </section>
        ${r.findings?.length ? `<details class="report-disclosure" data-report-disclosure="findings"><summary><span>主要发现 <small>${r.findings.length} 项 · AI 推断</small></span><span class="disclosure-hint">展开</span></summary><div class="report-disclosure-body">${r.findings.map((f) => `<article class="report-finding"><h4>${esc(f.title)}</h4><p>${esc(f.detail)}</p><small>依据：${esc(f.basis)}</small></article>`).join("")}</div></details>` : ""}
        <details class="report-disclosure" data-report-disclosure="methods"><summary><span>数据范围与统计口径</span><span class="disclosure-hint">展开</span></summary><div class="report-disclosure-body"><p>${esc(r.coverage)}</p>${reportMeasures(
          r,
        )
          .map(
            (m) =>
              `<div class="report-definition"><strong>${esc(m.name)}<span>${m.value === null ? "—" : esc(m.value)} ${esc(m.unit)}</span></strong><p>${esc(m.basis)}</p></div>`,
          )
          .join("")}</div></details>
      </div>`
          : empty("点击“立即分析”生成报告，或在“分析计划”中设置自动分析。")
      }
    </section>`
  );
}

function reportMeasures(r: Report) {
  if (r.dataMetrics) return r.dataMetrics;
  const m = r.metrics;
  return m
    ? [
        {
          name: "期间新建",
          value: m.created,
          unit: "单",
          basis: "所选期间创建的工单",
        },
        {
          name: "期间闭环",
          value: m.closed,
          unit: "单",
          basis: "所选期间闭环的工单，可能包含期间之前创建的记录",
        },
        {
          name: "净增积压",
          value: m.created - m.closed,
          unit: "单",
          basis: "期间新建减去期间闭环",
        },
        {
          name: "当前待闭环",
          value: m.open,
          unit: "单",
          basis: "当前状态快照，按全部非闭环状态统计",
        },
      ]
    : [];
}
function reportFacts(r: Report) {
  const measures = reportMeasures(r);
  return `<div class="ai-report-metrics" aria-label="关键指标">${measures
    .slice(0, 4)
    .map(
      (m) =>
        `<div><span>${esc(m.name)}</span><strong>${m.value === null ? "—" : esc(m.value)}<small>${esc(m.unit)}</small></strong></div>`,
    )
    .join("")}</div>${
    measures.length > 4
      ? `<div class="report-secondary-metrics">${measures
          .slice(4)
          .map(
            (m) =>
              `<span>${esc(m.name)} <strong>${m.value === null ? "—" : esc(m.value)} ${esc(m.unit)}</strong></span>`,
          )
          .join("")}</div>`
      : ""
  }`;
}
function reportAdvice(r: Report, a: Report["advice"][number], i: number) {
  return `<details class="report-advice" data-report-disclosure="${esc(a.id)}"><summary><span class="advice-number">${String(i + 1).padStart(2, "0")}</span><strong>${esc(a.title)}</strong><span class="advice-labels">${a.priority ? tag({ high: "优先处理", medium: "建议跟进", low: "持续观察" }[a.priority], a.priority === "high") : ""}${a.status !== "new" ? tag({ following: "跟进中", done: "已完成" }[a.status]) : ""}</span></summary><div class="report-advice-body">${a.action !== a.title ? `<p><strong>建议行动</strong> ${esc(a.action)}</p>` : ""}<p><strong>数据依据</strong> ${esc(a.evidence)}</p>${a.ownerId ? `<p>负责人：${esc(personName(a.ownerId))} · 复盘：${esc(a.reviewAt)}</p>` : ""}<div class="report-advice-actions">${tag({ new: "待评估", following: "跟进中", done: "已完成" }[a.status])}<button class="button" data-advice="${esc(a.id)}" data-report="${esc(r.id)}" ${canWrite() ? "" : "disabled"}>${a.status === "following" ? "完成跟进" : "安排跟进"}</button><a class="text-link" href="#tickets">查看工单 →</a></div></div></details>`;
}
function analysisTasks() {
  const tasks = state.boot?.analysisTasks || [];
  return tasks.length
    ? `<section class="panel"><div class="panel-heading"><h2>分析任务</h2></div>${tasks.map((t) => `<div class="note-band" role="status"><strong>${esc(t.name)}</strong> · ${esc(t.stage)}${t.error ? `<p>${esc(t.error)}</p>` : ""}<small>${t.status === "failed" ? "可重新发起分析" : "后台处理中，可以继续使用其他页面"}</small></div>`).join("")}</section>`
    : "";
}
