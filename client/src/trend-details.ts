import {
  trendDetails,
  comparison,
  type TrendDetails,
} from "../../shared/trend-details.js";
import {
  dimensionHref,
  type DimensionFilter,
} from "../../shared/overview-dimensions.js";
import { state, w, esc, table, empty, pager, slicePage } from "./core.js";
const W = 620,
  H = 220,
  L = 42,
  R = 596,
  TOP = 18,
  BASE = 180;
const number = (n: number) => Number(n.toFixed(1));
const dateLabel = (d: string) => d.slice(5);
function rangeLink(
  kind: DimensionFilter["kind"],
  key: string,
  from: number,
  at: number,
  label: string,
) {
  return `<a class="text-link" href="${esc(dimensionHref({ kind, key, from, at }))}">${esc(label)}</a>`;
}
const x = (index: number, count: number) =>
  count === 1 ? (L + R) / 2 : L + (index * (R - L)) / (count - 1);
function dates(data: TrendDetails) {
  const step = Math.max(1, Math.ceil(data.days.length / 7));
  return data.days
    .map((d, i) =>
      i % step === 0 || i === data.days.length - 1
        ? `<text x="${x(i, data.days.length)}" y="208" text-anchor="middle">${dateLabel(d.date)}</text>`
        : "",
    )
    .join("");
}
function lineChart(
  data: TrendDetails,
  series: {
    name: string;
    values: (number | null)[];
    kind: DimensionFilter["kind"];
    key: string;
  }[],
  unit: string,
) {
  const max = Math.max(
    1,
    ...series.flatMap((s) => s.values.filter((v): v is number => v !== null)),
  );
  const y = (v: number) => BASE - (v / max) * (BASE - TOP);
  return `<div class="trend-chart-scroll"><svg viewBox="0 0 ${W} ${H}" class="detail-line-chart" role="group" aria-label="${esc(series.map((s) => s.name).join("、"))}，单位${unit}">${[0, 1, 2, 3].map((n) => `<line class="detail-grid" x1="${L}" x2="${R}" y1="${y((max * n) / 3)}" y2="${y((max * n) / 3)}"/><text x="4" y="${y((max * n) / 3) + 4}">${number((max * n) / 3)}</text>`).join("")}${series
    .map((s, si) => {
      let pen = false;
      const path = s.values
        .map((v, i) => {
          if (v === null) {
            pen = false;
            return "";
          }
          const p = `${pen ? "L" : "M"}${x(i, s.values.length)} ${y(v)}`;
          pen = true;
          return p;
        })
        .join(" ");
      return `<path class="detail-series series-${si}" d="${path}"/>${s.values.map((v, i) => (v === null ? "" : `<a href="${esc(dimensionHref({ kind: s.kind, key: s.key, from: data.days[i].from, at: data.days[i].at }))}" aria-label="${esc(s.name)} ${data.days[i].date} ${number(v)} ${unit}"><circle class="detail-point series-${si}" r="4" cx="${x(i, s.values.length)}" cy="${y(v)}"/><title>${esc(s.name)} · ${data.days[i].date}：${number(v)} ${unit}</title></a>`)).join("")}`;
    })
    .join("")}${dates(data)}</svg></div>`;
}
function efficiencyPanel(data: TrendDetails, kind: "response" | "process") {
  const response = kind === "response",
    label = response ? "响应时长趋势" : "处理时长趋势",
    sample = response ? "responses" : "processing";
  const count = data.days.reduce((n, d) => n + d[sample].length, 0);
  const series = {
    name: label,
    values: data.days.map((d) => d[kind]),
    kind: response ? ("response_all" as const) : ("processing_all" as const),
    key: "",
  };
  return `<section class="panel"><div class="panel-heading"><div><h2>${label}</h2><p>每日中位数 · 分钟 · ${count} 个有效样本</p></div></div>${count ? lineChart(data, [series], "分钟") : empty("所选期间暂无有效时长样本")}<details class="trend-ledger" data-trend-disclosure="${kind}"><summary>每日时长与样本量</summary>${table(
    ["日期", "中位数", "有效样本"],
    slicePage(data.days, state.pageSize, "trend-" + kind).map(
      (d) =>
        `<tr><td>${d.date}</td><td>${d[kind] === null ? "—" : number(d[kind]!) + " 分钟"}</td><td>${d[sample].length ? rangeLink(series.kind, "", d.from, d.at, String(d[sample].length)) : "0"}</td></tr>`,
    ),
  )}${data.days.length > state.pageSize ? pager(data.days.length, state.pageSize, "trend-" + kind) : ""}</details><div class="panel-footer">${response ? "按接单日期统计，时长为创建至接单。" : "按闭环日期统计，时长为接单至闭环，含挂起。"}无有效样本显示断点。</div></section>`;
}
function netChart(data: TrendDetails) {
  const max = Math.max(1, ...data.days.map((d) => Math.abs(d.net))),
    zero = 99,
    scale = 72 / max;
  const width = Math.min(28, ((R - L) / data.days.length) * 0.55);
  return `<div class="trend-chart-scroll"><svg viewBox="0 0 ${W} ${H}" class="detail-net-chart" role="img" aria-label="每日新建减闭环，正值增加，负值消化"><line class="detail-zero" x1="${L}" x2="${R}" y1="${zero}" y2="${zero}"/>${data.days
    .map((d, i) => {
      const height = Math.abs(d.net) * scale,
        top = d.net >= 0 ? zero - height : zero;
      return `<rect class="net-${d.net >= 0 ? "positive" : "negative"}" x="${x(i, data.days.length) - width / 2}" y="${top}" width="${width}" height="${height}"><title>${d.date}：新建 ${d.created}，闭环 ${d.closed}，差额 ${d.net}</title></rect>${data.days.length <= 7 ? `<text x="${x(i, data.days.length)}" y="${d.net >= 0 ? top - 6 : top + height + 14}" text-anchor="middle">${d.net > 0 ? "+" : ""}${d.net}</text>` : ""}`;
    })
    .join("")}${dates(data)}</svg></div>`;
}
function netPanel(data: TrendDetails) {
  return `<section class="panel"><div class="panel-heading"><div><h2>每日工单增减</h2><p>新建 − 闭环 · 正值增加，负值消化 · 单位：单</p></div></div>${netChart(data)}<details class="trend-ledger" data-trend-disclosure="net"><summary>每日新建、闭环与差额</summary>${table(
    ["日期", "新建", "闭环", "差额"],
    slicePage(data.days, state.pageSize, "trend-net").map(
      (d) =>
        `<tr><td>${d.date}</td><td>${rangeLink("created", "", d.from, d.at, String(d.created))}</td><td>${rangeLink("closed", "", d.from, d.at, String(d.closed))}</td><td>${d.net > 0 ? "+" : ""}${d.net}</td></tr>`,
    ),
  )}${data.days.length > state.pageSize ? pager(data.days.length, state.pageSize, "trend-net") : ""}</details><div class="panel-footer">闭环可包含更早创建的工单；差额不是完成率或历史积压存量。</div></section>`;
}
function groupPanel(data: TrendDetails) {
  const available = new Set(data.groups.map((g) => g.id));
  const selected = (
    state.trendGroups ?? data.groups.slice(0, 3).map((g) => g.id)
  )
    .filter((id) => available.has(id))
    .slice(0, 3);
  state.trendGroups = selected;
  const series = selected.map((id) => ({
    name: data.groups.find((g) => g.id === id)!.name,
    key: id,
    kind: "group_created" as const,
    values: data.days.map((d) => d.groups.get(id) || 0),
  }));
  return `<section class="panel"><div class="panel-heading"><div><h2>小组业务量趋势</h2><p>每日新建记录 · 最多选择 3 个小组对比</p></div></div><div class="trend-group-picker">${data.groups.map((g) => `<label><input type="checkbox" data-trend-group="${esc(g.id)}" ${selected.includes(g.id) ? "checked" : ""} ${!selected.includes(g.id) && selected.length === 3 ? "disabled" : ""}>${esc(g.name)}</label>`).join("")}</div><div class="detail-legend">${series.map((s, i) => `<span><i class="series-${i}"></i>${esc(s.name)}</span>`).join("")}</div>${series.length ? lineChart(data, series, "单") : empty("选择小组以查看业务量趋势")}<div class="panel-footer">点击折线上的数据点，查看该组当日新建工单。</div></section>`;
}
function distribution(data: TrendDetails, kind: "type" | "group_created") {
  const rows = kind === "type" ? data.types : data.groups,
    scope = kind === "type" ? "trend-types" : "trend-groups";
  const max = Math.max(1, ...rows.map((r) => r.current));
  return `<section class="panel"><div class="panel-heading"><div><h2>${kind === "type" ? "期间工单类型" : "期间小组分布"}</h2><p>期间新建 · 占比与上期同进度记录对比</p></div></div><div class="trend-distribution">${
    slicePage(rows, state.pageSize, scope)
      .map(
        (r) =>
          `<div class="trend-distribution-row"><div><strong>${esc(r.name)}</strong><div class="dimension-track"><i style="width:${(r.current / max) * 100}%"></i></div></div><div>${rangeLink(kind, r.id, data.from, data.at, r.current + " 单")}<small>${data.total ? ((r.current / data.total) * 100).toFixed(1) + "%" : "—"}</small></div><div class="record-comparison">${comparison(r.current, r.previous)}<small>上期 ${rangeLink(kind, r.id, data.previousFrom, data.previousAt, r.previous + " 条记录")}</small></div></div>`,
      )
      .join("") || empty("所选期间暂无分布记录")
  }</div>${rows.length > state.pageSize ? pager(rows.length, state.pageSize, scope) : ""}</section>`;
}
export function trendDetailPanels() {
  const data = trendDetails(
    w().tickets,
    w().groups,
    state.boot!.today,
    state.period,
    Date.now(),
  );
  const datetime = (n: number) =>
    new Date(n + 28800000).toISOString().slice(0, 16).replace("T", " ");
  return `<section class="trend-details" aria-label="工单结构与效率趋势"><details class="trend-range-note" data-trend-disclosure="range"><summary>统计范围与上期对比</summary><p>基于已同步工单，UTC+8。当前 ${datetime(data.from)} 至 ${datetime(data.at)}；上期 ${datetime(data.previousFrom)} 至 ${datetime(data.previousAt)}。当天尚未结束，对比使用上期相同进度。上期未记录时不计算涨幅；空白日期不代表实际业务为零。时长统计排除缺失、逆序及未来时间。</p></details><div class="trend-detail-grid">${distribution(data, "type")}${distribution(data, "group_created")}${efficiencyPanel(data, "response")}${efficiencyPanel(data, "process")}${netPanel(data)}${groupPanel(data)}</div></section>`;
}
