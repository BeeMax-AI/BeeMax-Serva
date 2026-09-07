import {
  overviewDimensions,
  dimensionHref,
  ageLabels,
  type DimensionFilter,
} from "../../shared/overview-dimensions.js";
import { state, w, esc, table, empty, slicePage, pager } from "./core.js";
const minutes = (n: number | null) =>
  n === null
    ? "—"
    : n < 60
      ? `${Number(n.toFixed(1))} 分钟`
      : `${Number((n / 60).toFixed(1))} 小时`;
export function dimensionDescription(f: DimensionFilter) {
  const group =
    w().groups.find((g) => g.id === f.key)?.name || f.key || "未分组";
  const range = `${new Date(f.from + 28800000).toISOString().slice(0, 10)} — ${new Date(f.at + 28800000).toISOString().slice(0, 10)}`;
  if (f.kind === "age")
    return `当前未闭环 · ${ageLabels[f.key]}（按点击时刻计算）`;
  if (f.kind === "open" || f.kind === "waiting")
    return `${group} · 当前${f.kind === "open" ? "未闭环" : "待接单"}`;
  if (f.kind === "type") return `${range} 新建 · ${f.key}`;
  if (f.kind === "hour")
    return `${range} 新建 · ${f.key.padStart(2, "0")}:00–${f.key.padStart(2, "0")}:59（UTC+8）`;
  return `${group} · ${range} ${f.kind === "response" ? "接单且响应时长有效" : "闭环且处理时长有效"}的工单`;
}
export function overviewDimensionPanels() {
  const at = Date.now(),
    from =
      Date.parse(state.boot!.today + "T00:00:00+08:00") -
      (state.overviewDays - 1) * 86400000;
  const data = overviewDimensions(w().tickets, w().groups, from, at);
  const href = (kind: DimensionFilter["kind"], key: string) =>
    esc(dimensionHref({ kind, key, from, at }));
  const countLink = (
    kind: DimensionFilter["kind"],
    key: string,
    count: number,
    label = String(count),
  ) =>
    count
      ? `<a class="text-link" href="${href(kind, key)}">${esc(label)}</a>`
      : "0";
  const maxAge = Math.max(1, ...data.ages.map((a) => a.count)),
    maxHour = Math.max(1, ...data.hours.map((h) => h.count)),
    maxType = Math.max(1, ...data.types.map((t) => t.count));
  return `<section class="overview-dimensions" aria-label="运营结构与效率"><div class="panel-heading dimension-heading"><div><h2>运营结构与效率</h2><p>基于已同步工单 · UTC+8 · ${new Date(from + 28800000).toISOString().slice(0, 10)} — ${state.boot!.today}</p></div><div class="segmented" aria-label="分析时间范围">${[7, 30].map((n) => `<button data-overview-days="${n}" aria-pressed="${state.overviewDays === n}" class="${state.overviewDays === n ? "active" : ""}">近 ${n} 天</button>`).join("")}</div></div>
  <div class="dimension-grid"><section class="panel"><div class="panel-heading"><div><h2>未闭环时长分布</h2><p>当前全部未闭环 · 从创建至今，含挂起时间</p></div></div><div class="dimension-bars">${data.ages
    .filter((a) => a.key !== "unknown" || a.count)
    .map(
      (a) =>
        `<div class="dimension-bar"><span>${a.label}</span><div class="dimension-track"><i style="width:${(a.count / maxAge) * 100}%"></i></div><span>${countLink("age", a.key, a.count, `${a.count} 单`)}</span></div>`,
    )
    .join(
      "",
    )}</div><div class="panel-footer">时长分段用于查看积压，不代表超过服务时限。</div></section>
  <section class="panel"><div class="panel-heading"><div><h2>小组处理效率</h2><p>待办为当前状态 · 时长为所选期间中位数</p></div></div>${table(
    ["小组", "待接单", "待闭环", "响应时长", "处理时长"],
    slicePage(data.groups, state.pageSize, "overview-groups").map(
      (g) =>
        `<tr><td>${esc(g.name)}</td><td>${countLink("waiting", g.id, g.waiting)}</td><td>${countLink("open", g.id, g.open)}</td><td>${g.response === null ? "—" : countLink("response", g.id, g.responses.length, minutes(g.response))}<small>${g.responses.length} 个有效样本</small></td><td>${g.process === null ? "—" : countLink("processing", g.id, g.processing.length, minutes(g.process))}<small>${g.processing.length} 个有效样本</small></td></tr>`,
    ),
  )}${data.groups.length > state.pageSize ? pager(data.groups.length, state.pageSize, "overview-groups") : ""}<details class="dimension-method"><summary>统计说明</summary><p>响应：期间接单的工单，创建至接单；处理：期间闭环的工单，接单至闭环（含挂起）。排除缺失、逆序及未来时间。未配置在岗时长与难度权重，不作为人员绩效排名。</p></details></section>
  <section class="panel"><div class="panel-heading"><div><h2>新单高峰时段</h2><p>按创建小时汇总 · ${data.createdCount} 单</p></div></div>${data.createdCount ? `<div class="hour-scroll"><div class="hour-chart">${data.hours.map((h) => `<a href="${href("hour", String(h.hour))}" class="hour-column" aria-label="${h.hour}点至${h.hour + 1}点：${h.count} 单"><span>${h.count || ""}</span><div><i style="height:${(h.count / maxHour) * 100}%"></i></div><small>${String(h.hour).padStart(2, "0")}</small></a>`).join("")}</div></div>` : empty("所选期间暂无新建工单")}<div class="panel-footer">小时内记录数；未记录的业务无法由本图推断。</div></section>
  <section class="panel"><div class="panel-heading"><div><h2>高频问题类型</h2><p>所选期间新建 · Top 5 · 占全部新单比例</p></div></div><div class="dimension-bars">${data.types.map((t) => `<div class="dimension-bar"><span>${esc(t.name)}</span><div class="dimension-track"><i style="width:${(t.count / maxType) * 100}%"></i></div><span>${countLink("type", t.name, t.count, `${t.count} 单`)}<small>${((t.count / data.createdCount) * 100).toFixed(1)}%</small></span></div>`).join("") || empty("所选期间暂无问题类型数据")}</div><div class="panel-footer">点击数量，查看对应工单。</div></section></div></section>`;
}
