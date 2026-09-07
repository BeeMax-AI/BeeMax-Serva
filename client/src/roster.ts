import { notificationContent } from "./notifications.js";
import { moduleTabs } from "./navigation.js";
import {
  state,
  w,
  title,
  esc,
  button,
  tag,
  icon,
  table,
  slicePage,
  pager,
  options,
  groupName,
  canWrite,
} from "./core.js";

export function roster() {
  const data = w();
  const matches = (...values: unknown[]) =>
    values.join(" ").toLowerCase().includes(state.query.trim().toLowerCase());
  const people = data.people.filter(
    (p) =>
      (!state.group || p.groupId === state.group) &&
      (!state.tier || String(p.tier) === state.tier) &&
      matches(p.name, groupName(p.groupId)),
  );
  return (
    title("人员与负载", "查看人员负载，管理排班与逐级通知。") +
    moduleTabs("staff-roster") +
    '<section class="panel">' +
    notificationContent() +
    `<div class="config-title"><div><h2>人员与默认排班</h2><p>${data.integration ? "按小组和档位查看人员与默认排班。" : "按小组、档位和在岗状态配置接单人员。"}</p></div>${data.integration ? `<div>${button("楼栋与时段", "roster-rules")} ${button("今日当班", "roster-today", false, !canWrite("roster.today"))} ${button("导入排班", "roster-import", false, !canWrite("roster.import"))}</div>` : button("新增人员", "add-person", true, !canWrite("person.save"))}</div>` +
    (data.integration
      ? `<div class="note-band">${esc(data.integration.rosterNote)} 默认名单支持调整档位；今日当班和排班原文分别设置。</div>`
      : "") +
    rosterFilters() +
    table(
      [
        "人员",
        "小组",
        "通知级别",
        data.integration ? "排班说明" : "在岗",
        "操作",
      ],
      slicePage(people).map(
        (p) =>
          `<tr><td>${esc(p.name)}</td><td>${esc(groupName(p.groupId))}</td><td>L${p.tier}</td><td>${tag(p.scheduleLabel || (p.active ? "当班" : "未在岗"), p.active)}</td>${data.integration ? `<td>${p.defaultTier && p.rosterUserId ? `<button class="text-link" data-roster-person="${esc(p.id)}" ${canWrite("roster.person.save") ? "" : "disabled"}>调整默认档位</button>` : "—"}</td>` : `<td><button class="text-link" data-person="${esc(p.id)}" ${canWrite("person.save") ? "" : "disabled"}>编辑</button></td>`}</tr>`,
      ),
    ) +
    pager(people.length) +
    "</section>"
  );
}

function rosterFilters() {
  const data = w();
  return `<div class="staff-toolbar"><div class="staff-controls"><label class="staff-search">${icon("search")}<input id="search" aria-label="搜索排班人员" placeholder="搜索姓名或小组" value="${esc(state.query)}"></label><label class="staff-group"><span>小组</span><select data-filter="group" aria-label="筛选排班小组">${options(data.groups, state.group, "全部小组")}</select></label><label class="staff-group"><span>通知级别</span><select data-filter="tier" aria-label="筛选档位">${options(
    [...new Set(data.people.map((p) => p.tier))]
      .sort((a, b) => a - b)
      .map((n) => ({ id: String(n), name: "L" + n })),
    state.tier,
    "全部档位",
  )}</select></label>${button("重置", "reset", false, !state.query && !state.group && !state.tier)}</div></div>`;
}
