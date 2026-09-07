import { pageSizes, defaultPageSize } from "../../shared/pagination.js";
import { notificationLevels } from "./notifications.js";
import type { RemoteAnalytics } from "../../shared/domain.js";
import {
  state,
  w,
  esc,
  fmt,
  button,
  tag,
  table,
  options,
  pager,
  slicePage,
  canWrite,
  isOwner,
  modal,
  field,
  formData,
  confirmCommand,
  api,
  offsetDate,
} from "./core.js";
export const hasTool = (name: string) =>
  !!w().integration?.tools?.includes(name);
export function remoteActions(view = "overview") {
  return (
    (hasTool("get_analytics")
      ? button(
          view === "staff" ? "全库人员统计" : "全库统计",
          "remote-analytics-" + view,
        )
      : "") +
    (hasTool("get_report") && view !== "staff"
      ? button("业务报表", "remote-report")
      : "")
  );
}
export function connectionContent() {
  const i = w().integration!;
  const labels: Record<string, string> = {
    get_config: "读取配置",
    set_config: "修改派单参数与学习开关",
    clear_config: "恢复任意配置",
    list_config_changes: "配置变更记录",
    list_tickets: "工单列表",
    get_ticket: "工单详情",
    ticket_stats: "工单数量",
    get_analytics: "全库统计分析",
    get_report: "业务日报与早报",
    get_roster: "读取排班",
    query_on_duty: "查询当班名单",
    get_routing_rules: "读取路由",
    set_routing_rule: "设置类型路由",
    clear_routing_rule: "恢复类型默认路由",
    set_subject_rule: "设置关键词路由",
    clear_subject_rule: "移除关键词路由",
    set_roster: "调整默认排班档位",
    set_on_duty_today: "设置今日当班人",
    ingest_roster_text: "导入排班原文",
    get_whitelist: "查看渠道访问权限",
    set_whitelist: "修改渠道访问权限",
    urge_ticket: "催办工单",
    hold_ticket: "挂起工单",
    resume_ticket: "恢复工单",
    reassign_ticket: "转派工单",
    complete_ticket: "完成工单",
    list_faq: "读取标准问答",
    learn_faq: "学习标准问答",
    forget_faq: "移除标准问答",
  };
  const connected = new Set(
    Object.keys(labels).filter(
      (k) =>
        ![
          "clear_config",
          "query_on_duty",
          "list_faq",
          "learn_faq",
          "forget_faq",
        ].includes(k),
    ),
  );
  return `<div class="config-title"><div><h2>MCP 数据连接</h2><p>工具清单每分钟重新核对；页面刷新后显示最新结果。连接凭据仅保存在服务端。</p></div>${tag(`${i.tools?.length || 0} 个工具`)}</div><div class="note-band">核对时间：${fmt(i.toolsCheckedAt || i.checkedAt)}。企微实例、消息日志和主动推送群授权仍未提供对应工具。</div>${table(
    ["能力", "接入状态"],
    slicePage(i.tools || []).map(
      (name) =>
        `<tr><td>${esc(labels[name] || name)}</td><td>${tag(connected.has(name) ? "已接入" : "已发现 · 尚未接入", connected.has(name))}</td></tr>`,
    ),
  )}${pager(i.tools?.length || 0)}`;
}
const channels: Record<string, string> = { wecom: "企业微信", feishu: "飞书" };
const policies: Record<string, string> = {
  open: "开放访问",
  allowlist: "仅白名单",
  owner: "仅所有者",
  disabled: "禁用群访问",
};
export function accessContent(scope = "main", size = state.pageSize) {
  const data = w().channelAccess;
  if (!data)
    return `<div class="config-title"><div><h2>渠道访问权限</h2><p>${hasTool("get_whitelist") ? "权限读取暂时失败，请刷新后重试。" : "当前连接尚未提供渠道访问权限读取工具。"}</p></div></div>`;
  const entries = data.flatMap((c) => [
    ...c.dmAllowFrom.map((id) => ({
      channel: c.channel,
      kind: "私聊用户",
      id,
      name: "用户标识",
      mode: "",
      removable: true,
    })),
    ...c.groups.map((g) => ({
      channel: c.channel,
      kind: "群会话",
      id: g.id,
      name: g.name,
      mode: g.mode,
      removable: false,
    })),
  ]);
  return `<div class="config-title"><div><h2>渠道访问权限</h2><p>控制谁可以与机器人交互；与主动推送群授权分别管理。</p></div></div>${data.map((c) => `<div class="config-row"><div><h3>${channels[c.channel]}</h3><p>私聊：${esc(policies[c.dmPolicy] || c.dmPolicy)} · 群聊：${esc(policies[c.groupPolicy] || c.groupPolicy)}</p></div><div><button class="button" data-access-policy="${c.channel}" ${canWrite("access.save") ? "" : "disabled"}>修改策略</button> <button class="button" data-access-add="${c.channel}" ${canWrite("access.save") ? "" : "disabled"}>添加私聊用户</button></div></div>`).join("")}<div class="note-band">修改后渠道服务会自动重启并生效。白名单条目仅在相应“仅白名单”策略下限制访问；当前工具不支持增删群条目。</div>${table(
    ["渠道", "类型", "名称 / 标识", "操作"],
    slicePage(entries, size, scope).map(
      (e) =>
        `<tr><td>${channels[e.channel]}</td><td>${e.kind}</td><td>${esc(e.name)}<small>${esc(e.id)}${e.mode ? " · " + esc(e.mode === "mention" ? "需 @ 机器人" : e.mode) : ""}</small></td><td>${e.removable ? `<button class="text-link" data-access-remove="${esc(e.id)}" data-channel="${e.channel}" ${canWrite("access.save") ? "" : "disabled"}>移除</button>` : "仅查看"}</td></tr>`,
    ),
  )}${pager(entries.length, size, scope)}`;
}
function accessPolicies(group: boolean, current: string) {
  const all = group
    ? ["open", "allowlist", "disabled"]
    : ["open", "allowlist", "owner"];
  return all
    .filter(
      (_, i) =>
        isOwner() || (all.includes(current) && i >= all.indexOf(current)),
    )
    .map((id) => ({ id, name: policies[id] }));
}
export function editAccess(channel: string, policy = false) {
  const c = w().channelAccess?.find((c) => c.channel === channel);
  if (!c) return;
  const dialog = modal(
    `${channels[channel]} · ${policy ? "访问策略" : "添加私聊用户"}`,
    policy
      ? `<label>策略范围<select name="action"><option value="set_dm_policy">私聊访问</option><option value="set_group_policy">群聊访问</option></select></label><label>访问策略<select name="policy">${options(accessPolicies(false, c.dmPolicy), c.dmPolicy)}</select></label>`
      : field(
          "用户标识",
          "userId",
          "",
          "text",
          'required maxlength="128" placeholder="企微 userid 或飞书 open_id"',
        ),
    {
      label: "预览变更",
      run: (form) => {
        const d = formData(form);
        confirmCommand(
          "确认渠道权限变更",
          `${channels[channel]}：${policy ? (d.action === "set_dm_policy" ? "私聊" : "群聊") + " → " + policies[d.policy] : "添加私聊用户 " + d.userId}。保存会重启该渠道服务；开放访问会允许白名单外用户交互。`,
          "access.save",
          {
            channel,
            ...(policy ? d : { action: "add_dm_allow", userId: d.userId }),
          },
        );
      },
    },
  );
  dialog.onchange = (e) => {
    if ((e.target as HTMLSelectElement).name === "action") {
      const group =
        (e.target as HTMLSelectElement).value === "set_group_policy";
      dialog.querySelector('select[name="policy"]')!.innerHTML = options(
        accessPolicies(group, group ? c.groupPolicy : c.dmPolicy),
        group ? c.groupPolicy : c.dmPolicy,
      );
    }
  };
}
export function editRosterPerson(id: string) {
  const p = w().people.find((p) => p.id === id);
  if (!p?.rosterUserId || !p.defaultTier) return;
  modal(
    "调整默认排班档位",
    `<p>${esc(p.name)} · ${esc(w().groups.find((g) => g.id === p.groupId)?.name)}</p><label>默认档位<select name="tier">${options(
      [1, 2, 3, 4].map((n) => ({
        id: String(n),
        name: notificationLevels[n][0],
      })),
      String(p.defaultTier),
    )}</select></label><p>修改默认名单；当日覆盖、楼栋时段和专员规则继续保留。默认档位不代表实时在岗。</p>`,
    {
      label: "预览变更",
      run: (form) =>
        confirmCommand(
          "确认默认排班变更",
          `${p.name}：${p.defaultTier} 档 → ${formData(form).tier} 档。通过完整排班快照保存，保留其他配置。`,
          "roster.person.save",
          {
            groupId: p.groupId,
            userId: p.rosterUserId,
            tier: Number(formData(form).tier),
          },
        ),
    },
  );
}
export function editRoster(importText = false) {
  modal(
    importText ? "导入排班原文" : "设置今日当班人",
    `<label>小组<select name="groupId">${options(w().groups)}</select></label>${importText ? field("生效日期", "date", state.boot!.today, "date", 'required min="' + state.boot!.today + '"') : ""}<label>${importText ? "排班原文" : "今日当班姓名（每行一人）"}<textarea name="text" required maxlength="${importText ? 10000 : 1000}" rows="7"></textarea></label><p>${importText ? "原文提交后由远端模型解析并直接写入。请核对姓名、楼栋、时段和日期；保存后重新检查排班。" : "仅覆盖今日一线当班人，二至四档保留默认名单，次日自动恢复默认。"}</p>`,
    {
      label: "预览变更",
      run: (form) => {
        const d = formData(form);
        confirmCommand(
          importText ? "确认解析并写入排班" : "确认今日当班人",
          `${w().groups.find((g) => g.id === d.groupId)?.name} ${importText ? d.date : state.boot!.today}\n${d.text}`,
          importText ? "roster.import" : "roster.today",
          importText
            ? d
            : {
                groupId: d.groupId,
                names: d.text
                  .split(/[\n,，、]+/)
                  .map((n) => n.trim())
                  .filter(Boolean),
              },
        );
      },
    },
  );
}
export function queryReport() {
  const dialog = modal(
    "查看业务报表",
    `<label>报表类型<select name="kind"><option value="day">工单日报</option><option value="admin">管理员全盘报</option><option value="lead">小组早报</option></select></label><div data-report-date>${field("日报日期", "date", offsetDate(state.boot!.today, -1), "date", "required")}</div><label data-report-group hidden>小组<select name="group">${options(w().groups)}</select></label><p>查询不会发送群消息；日报按指定日期，管理员报和小组早报按远端当前报告周期。</p>`,
    {
      label: "查询报表",
      run: async (form) => {
        const d = formData(form);
        const instance = dialog.dataset.instance;
        const r = await api<{ text: string; day: string | null }>(
          "/mcp/report?" + new URLSearchParams(d),
        );
        if (!dialog.open || dialog.dataset.instance !== instance) return;
        modal(
          "业务报表" + (r.day ? " · " + r.day : ""),
          `<p>来源：业务系统报表，保留源系统统计口径。</p><div class="remote-report-text">${esc(r.text)}</div>`,
        );
      },
    },
  );
  dialog.onchange = (e) => {
    if ((e.target as HTMLSelectElement).name === "kind") {
      const kind = (e.target as HTMLSelectElement).value;
      dialog.querySelector<HTMLElement>("[data-report-date]")!.hidden =
        kind !== "day";
      dialog.querySelector<HTMLElement>("[data-report-group]")!.hidden =
        kind !== "lead";
    }
  };
}
export async function queryAnalytics(initial = "overview") {
  let view =
      initial === "staff"
        ? "staff"
        : initial === "trends"
          ? "trend"
          : "overview",
    bucket = "day",
    days = "",
    page = 1,
    size = defaultPageSize;
  const loading = modal(
      "全库统计",
      '<p role="status">正在读取业务数据库统计…</p>',
    ),
    instance = loading.dataset.instance;
  let result: RemoteAnalytics;
  try {
    result = await api<RemoteAnalytics>("/mcp/analytics");
  } catch (e) {
    if (loading.open && loading.dataset.instance === instance)
      loading.querySelector(".form-error")!.textContent =
        e instanceof Error ? e.message : "读取失败";
    return;
  }
  if (!loading.open || loading.dataset.instance !== instance) return;
  function show() {
    const rows =
      view === "staff"
        ? result.staff.map((p) => [
            p.name,
            p.accepted,
            p.closed,
            p.share + "%",
            p.response ?? "—",
            p.handling ?? "—",
          ])
        : view === "trend"
          ? result.trend.map((r) => [r.date, r.created, r.closed, r.backlog])
          : result.periods.map((p) => [
              p.label,
              p.created,
              p.closed,
              p.noAccept,
              p.response ?? "—",
              p.resolution ?? "—",
              p.completionRate === null ? "—" : p.completionRate + "%",
            ]);
    const headings =
      view === "staff"
        ? ["人员", "接单", "完成", "接单占比", "平均响应/分钟", "平均处理/分钟"]
        : view === "trend"
          ? ["周期", "新建", "闭环", "积压"]
          : [
              "周期",
              "新建",
              "闭环",
              "无人接",
              "平均响应/分钟",
              "平均闭环/分钟",
              "完成率",
            ];
    const pages = Math.max(1, Math.ceil(rows.length / size));
    page = Math.min(page, pages);
    const dialog = modal(
      "全库统计",
      `<div class="remote-query-controls"><label>视图<select name="view">${options(
        [
          { id: "overview", name: "总览" },
          { id: "trend", name: "趋势" },
          { id: "staff", name: "人员" },
        ],
        view,
      )}</select></label><label>趋势分桶<select name="bucket">${options(
        [
          { id: "day", name: "日" },
          { id: "week", name: "周" },
          { id: "month", name: "月" },
        ],
        bucket,
      )}</select></label><label>人员统计范围<select name="days">${options(
        [
          { id: "", name: "全部历史" },
          { id: "7", name: "近 7 天" },
          { id: "30", name: "近 30 天" },
          { id: "365", name: "近 365 天" },
        ],
        days,
      )}</select></label></div><p>来源：业务数据库统计 · 全库 ${result.total} 单 · 更新于 ${fmt(result.generatedAt)}。统计日：${esc(result.today)}；趋势最多 30 个周期；人员范围：${days ? "近 " + days + " 天" : "全部历史"}。使用源系统的完成率、无人接和积压口径，与已加载明细统计分别展示。</p><div class="remote-table">${table(
        headings,
        rows
          .slice((page - 1) * size, page * size)
          .map(
            (row) =>
              "<tr>" +
              row.map((v) => "<td>" + esc(v) + "</td>").join("") +
              "</tr>",
          ),
      )}</div><div class="connection-pagination"><label>每页<select data-remote-size>${pageSizes.map((n) => `<option ${n === size ? "selected" : ""}>${n}</option>`).join("")}</select></label><span>共 ${rows.length} 条 · 第 ${page} / ${pages} 页</span><button type="button" class="button" data-remote-step="-1" ${page === 1 ? "disabled" : ""}>上一页</button><button type="button" class="button" data-remote-step="1" ${page === pages ? "disabled" : ""}>下一页</button></div>`,
      {
        label: "查询统计",
        run: async (form) => {
          const d = formData(form),
            instance = dialog.dataset.instance;
          const next = await api<RemoteAnalytics>(
            "/mcp/analytics?" +
              new URLSearchParams({
                bucket: d.bucket,
                ...(d.days ? { days: d.days } : {}),
              }),
          );
          if (!dialog.open || dialog.dataset.instance !== instance) return;
          result = next;
          view = d.view;
          bucket = d.bucket;
          days = d.days;
          page = 1;
          show();
        },
      },
    );
    dialog.classList.add("remote-analytics");
    dialog.querySelectorAll<HTMLButtonElement>("[data-remote-step]").forEach(
      (b) =>
        (b.onclick = () => {
          page += Number(b.dataset.remoteStep);
          show();
          dialog.querySelector<HTMLElement>("h2")!.tabIndex = -1;
          dialog.querySelector<HTMLElement>("h2")!.focus();
        }),
    );
    dialog.querySelector<HTMLSelectElement>("[data-remote-size]")!.onchange = (
      e,
    ) => {
      size = Number((e.target as HTMLSelectElement).value);
      page = 1;
      show();
      dialog.querySelector<HTMLSelectElement>("[data-remote-size]")!.focus();
    };
  }
  show();
}

export function showScheduleRules() {
  let page = 1;
  function show() {
    const rows = w().scheduleRules || [],
      pages = Math.max(1, Math.ceil(rows.length / defaultPageSize));
    const dialog = modal(
      "楼栋与时段排班",
      `<p>由远端排班规则读取。跨午夜时段按远端引擎执行；不推断人员实时在线状态。</p><div class="remote-table">${table(
        ["小组", "生效日期", "楼栋", "时段", "人员", "状态"],
        rows
          .slice((page - 1) * defaultPageSize, page * defaultPageSize)
          .map(
            (r) =>
              `<tr><td>${esc(w().groups.find((g) => g.id === r.groupId)?.name || r.groupId)}</td><td>${esc(r.date)}</td><td>${esc(r.building)}</td><td>${esc(r.from)}–${esc(r.to)}</td><td>${esc(r.names.join("、") || "未指定")}</td><td>${r.enabled ? (r.date === state.boot!.today || r.date === "长期默认" ? "适用今日" : "非今日规则") : "已停用"}</td></tr>`,
          ),
      )}</div><div class="connection-pagination"><span>共 ${rows.length} 条 · 每页 ${defaultPageSize} 条 · ${page}/${pages}</span><button type="button" class="button" data-schedule-prev ${page === 1 ? "disabled" : ""}>上一页</button><button type="button" class="button" data-schedule-next ${page === pages ? "disabled" : ""}>下一页</button></div>`,
    );
    dialog.classList.add("remote-analytics");
    dialog.querySelector<HTMLButtonElement>("[data-schedule-prev]")!.onclick =
      () => {
        page--;
        show();
      };
    dialog.querySelector<HTMLButtonElement>("[data-schedule-next]")!.onclick =
      () => {
        page++;
        show();
      };
  }
  show();
}
