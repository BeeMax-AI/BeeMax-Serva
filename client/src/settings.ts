import { connections, confirmConnectionCommand } from "./connections.js";
import { qiweContent } from "./qiwe.js";
import { connectionContent } from "./mcp.js";
import type { Plan, Ticket, AnalysisTask } from "../../shared/domain.js";
import {
  state,
  w,
  esc,
  fmt,
  button,
  tag,
  icon,
  title,
  table,
  pager,
  slicePage,
  options,
  empty,
  canWrite,
  isOwner,
  modal,
  field,
  formData,
  confirmCommand,
  command,
  closeModal,
  toast,
  post,
  refresh,
  personName,
  groupName,
  statusTag,
  api,
} from "./core.js";
export const tabs = [
  ["routing", "路由规则"],
  ["parameters", "派单参数"],
  ["learning", "学习与灰度"],
  ["connection", "QiWe 连接"],
  ["mcp", "MCP 数据连接"],
  ["audit", "变更记录"],
];
export function settings() {
  if (!tabs.some(([id]) => id === state.tab)) state.tab = "routing";
  return (
    title(
      "规则清楚，协作有序。",
      "管理业务配置，每次变更保留操作记录。",
      tag(isOwner() ? "owner" : canWrite() ? "运营管理员" : "只读用户"),
    ) +
    `<div class="tabbar" role="tablist">${tabs
      .filter(([id]) => id !== "mcp" || state.boot?.mode === "mcp")
      .map(
        ([id, name]) =>
          `<button role="tab" data-tab="${id}" aria-selected="${state.tab === id}" class="${state.tab === id ? "active" : ""}">${name}</button>`,
      )
      .join(
        "",
      )}</div><section class="panel ${state.tab === "connection" ? "qiwe-panel" : ""}">${content()}</section>`
  );
}
const auditNames: Record<string, string> = {
  "ticket.action": "工单操作",
  "route.save": "保存路由",
  "route.delete": "删除路由",
  "person.save": "更新人员",
  "roster.person.save": "调整默认档位",
  "roster.level.save": "调整 L3 通知方式",
  "roster.member.add": "添加升级通知人",
  "roster.member.remove": "移除升级通知人",
  "roster.today": "设置今日当班",
  "roster.import": "导入排班",
  "access.save": "调整渠道访问权限",
  "parameters.save": "调整参数",
  "learning.save": "学习与灰度",
  "account.save": "保存实例",
  "group.add": "新增群授权",
  "group.remove": "移除群授权",
  "member.add": "新增人员授权",
  "member.remove": "移除人员授权",
  "group.push": "调整群推送",
  "credentials.save": "更新连接凭据",
  "plan.save": "保存分析计划",
  "plan.delete": "删除分析计划",
  "advice.update": "更新建议跟进",
  "report.generate": "生成分析报告",
};
function content() {
  const data = w();
  if (data.integration && state.tab === "mcp") return connectionContent();
  const matches = (...values: unknown[]) =>
    values.join(" ").toLowerCase().includes(state.query.trim().toLowerCase());
  const routes = data.routes.filter(
    (r) =>
      (!state.group || r.groupId === state.group) &&
      matches(r.type, r.keywords, groupName(r.groupId)),
  );
  const audit = data.audit.filter((a) =>
    matches(a.actor, auditNames[a.action] || a.action, a.target, a.detail),
  );
  const filterBar = (placeholder: string, groups = false, tiers = false) =>
    `<div class="staff-toolbar"><div class="staff-controls"><label class="staff-search">${icon("search")}<input id="search" aria-label="搜索配置记录" placeholder="${esc(placeholder)}" value="${esc(state.query)}"></label>${groups ? `<label class="staff-group"><span>小组</span><select data-filter="group" aria-label="筛选配置小组">${options(data.groups, state.group, "全部小组")}</select></label>` : ""}${
      tiers
        ? `<label class="staff-group"><span>通知级别</span><select data-filter="tier" aria-label="筛选档位">${options(
            [...new Set(data.people.map((p) => p.tier))]
              .sort((a, b) => a - b)
              .map((n) => ({ id: String(n), name: "L" + n })),
            state.tier,
            "全部档位",
          )}</select></label>`
        : ""
    }${button("重置", "reset", false, !state.query && !state.group && !state.tier)}</div></div>`;
  switch (state.tab) {
    case "routing":
      return (
        `<div class="config-title"><div><h2>路由规则</h2><p>按问题类型与关键词，找到合适的处理小组。</p></div>${button("新增规则", "add-route", true, !(canWrite("route.save") || canWrite("route.save.type") || canWrite("route.save.subject")))}</div>` +
        (data.integration
          ? `<div class="note-band">类型路由按问题类型分派，关键词路由优先匹配。移除类型覆盖后恢复基础配置。</div>`
          : "") +
        filterBar("搜索类型或关键词", true) +
        table(
          ["问题类型", "关键词", "处理小组", "来源", "操作"],
          slicePage(routes).map(
            (r) =>
              `<tr><td>${esc(r.type)}</td><td>${esc(r.keywords)}</td><td>${esc(groupName(r.groupId))}</td><td>${tag(r.source)}</td><td><button class="text-link" data-route="${esc(r.id)}" ${canWrite(data.integration ? "route.save." + (r.id.startsWith("subject:") ? "subject" : "type") : "route.save") ? "" : "disabled"}>编辑</button> <button class="text-link" data-delete-route="${esc(r.id)}" ${canWrite(data.integration ? "route.delete." + (r.id.startsWith("subject:") ? "subject" : "type") : "route.delete") && (!data.integration || r.id.startsWith("subject:") || r.source === "学习覆盖") ? "" : "disabled"}>删除</button></td></tr>`,
          ),
        ) +
        pager(routes.length)
      );
    case "parameters":
      return `<div class="config-title"><div><h2>派单与提醒</h2><p>分钟为单位，保存前核对变更。${data.integration ? "每次只修改一项；接单后完成提醒须为 60 分钟的倍数。" : ""}</p></div>${button("编辑参数", "parameters", false, !canWrite("parameters.save"))}</div>${[
        ["升级间隔", data.parameters.escalationMinutes],
        [
          data.integration ? "接单后完成提醒" : "接单提醒",
          data.parameters.acceptReminderMinutes,
        ],
        ["挂起提前提醒", data.parameters.holdReminderMinutes],
      ]
        .map(
          ([n, v]) =>
            `<div class="config-row"><h3>${n}</h3><strong>${v} 分钟</strong></div>`,
        )
        .join("")}`;
    case "learning":
      return `<div class="config-title"><div><h2>学习与灰度</h2><p>修改后由后端保存配置。</p></div></div>${[
        ["autoApply", "转单学习自动应用"],
        ["routingShadow", "路由灰度观察"],
      ]
        .map(([key, name]) => {
          const on = data.learning[key as keyof typeof data.learning];
          return `<div class="config-row"><div><h3>${name}</h3>${tag(on ? "已开启" : "已关闭")}</div><button class="switch ${on ? "" : "off"}" role="switch" aria-checked="${on}" aria-label="${name}" data-learning="${key}" ${canWrite("learning.save") ? "" : "disabled"}></button></div>`;
        })
        .join("")}`;
    case "connection":
      return qiweContent();
    default:
      return (
        `<div class="config-title"><div><h2>配置与操作记录</h2><p>时间、操作人、目标和变更内容。</p></div></div>` +
        filterBar("搜索操作人、操作或内容") +
        table(
          ["时间", "操作人", "操作", "目标", "内容"],
          slicePage(audit).map(
            (a) =>
              `<tr><td>${fmt(a.at)}</td><td>${esc(a.actor)}</td><td>${esc(auditNames[a.action] || a.action)}</td><td>${esc(a.target || "—")}</td><td>${esc(a.detail)}</td></tr>`,
          ),
        ) +
        pager(audit.length)
      );
  }
}
export function editRoute(id = "") {
  const r = w().routes.find((r) => r.id === id);
  if (w().integration) {
    const kind = r?.id.startsWith("subject:") ? "subject" : "type";
    modal(
      r ? "编辑路由规则" : "新增路由规则",
      `<label>规则类型<select name="kind" ${r ? "disabled" : ""}>${options(
        [
          { id: "type", name: "问题类型" },
          { id: "subject", name: "内容关键词" },
        ].filter((k) => canWrite("route.save." + k.id)),
        kind,
      )}</select></label>${field("匹配内容", "match", r ? (kind === "type" ? r.type : r.keywords) : "", "text", 'required maxlength="300" ' + (r ? "readonly" : ""))}<label>处理小组<select name="groupId">${options(w().groups, r?.groupId)}</select></label><p>一个规则对应一个类型或一个关键词。关键词先于类型匹配，保存后实时生效。</p>`,
      {
        label: "预览变更",
        run: (form) => {
          const d = formData(form),
            selected = r ? kind : d.kind;
          confirmCommand(
            "确认路由变更",
            `${selected === "type" ? "类型" : "关键词"}：${d.match} → ${groupName(d.groupId)}`,
            "route.save",
            {
              kind: selected,
              ...(r ? { id: r.id } : {}),
              groupId: d.groupId,
              ...(selected === "type"
                ? { type: d.match }
                : { keywords: d.match }),
            },
          );
        },
      },
    );
    return;
  }
  modal(
    r ? "编辑路由规则" : "新增路由规则",
    field(
      "问题类型",
      "type",
      r?.type || "",
      "text",
      'required maxlength="40"',
    ) +
      field(
        "匹配关键词",
        "keywords",
        r?.keywords || "",
        "text",
        'required maxlength="300"',
      ) +
      `<label>处理小组<select name="groupId">${options(w().groups, r?.groupId)}</select></label>`,
    {
      label: "预览变更",
      run: (form) => {
        const d: Record<string, string> = {
          ...formData(form),
          ...(r ? { id: r.id } : {}),
        };
        confirmCommand(
          "确认路由变更",
          `${d.type} → ${groupName(d.groupId)}；关键词：${d.keywords}`,
          "route.save",
          d,
        );
      },
    },
  );
}
export function editPerson(id = "") {
  const p = w().people.find((p) => p.id === id);
  modal(
    p ? "编辑人员" : "新增人员",
    field("姓名", "name", p?.name || "", "text", 'required maxlength="40"') +
      `<label>小组<select name="groupId">${options(w().groups, p?.groupId)}</select></label>` +
      field(
        "档位",
        "tier",
        String(p?.tier || 1),
        "number",
        'required min="1" max="5"',
      ) +
      `<label>在岗状态<select name="active"><option value="true" ${p?.active ? "selected" : ""}>在岗</option><option value="false" ${p && !p.active ? "selected" : ""}>未在岗</option></select></label>`,
    {
      label: "预览变更",
      run: (form) => {
        const v = formData(form);
        confirmCommand(
          "确认人员配置",
          `${v.name} · ${groupName(v.groupId)} · ${v.tier} 档 · ${v.active === "true" ? "在岗" : "未在岗"}`,
          "person.save",
          {
            ...v,
            ...(id ? { id } : {}),
            tier: Number(v.tier),
            active: v.active === "true",
          },
        );
      },
    },
  );
}
export function editParameters() {
  const p = w().parameters;
  modal(
    "派单与提醒",
    field(
      "升级间隔（分钟）",
      "escalationMinutes",
      String(p.escalationMinutes),
      "number",
      'required min="1" max="1440"',
    ) +
      field(
        w().integration ? "接单后完成提醒（分钟，整小时）" : "接单提醒（分钟）",
        "acceptReminderMinutes",
        String(p.acceptReminderMinutes),
        "number",
        'required min="1" max="1440"',
      ) +
      field(
        "挂起提前提醒（分钟）",
        "holdReminderMinutes",
        String(p.holdReminderMinutes),
        "number",
        'required min="1" max="1440"',
      ),
    {
      label: "预览变更",
      run: (form) => {
        const d = Object.fromEntries(
          Object.entries(formData(form)).map(([k, v]) => [k, Number(v)]),
        );
        confirmCommand(
          "确认提醒参数",
          `升级：${d.escalationMinutes} 分钟；${w().integration ? "接单后完成提醒" : "接单提醒"}：${d.acceptReminderMinutes} 分钟；挂起提醒：${d.holdReminderMinutes} 分钟。`,
          "parameters.save",
          d,
        );
      },
    },
  );
}
export function editAccount(id = "") {
  const a = connections().accounts.find((a) => a.id === id);
  const revision = connections().revision;
  modal(
    a ? "管理实例" : "添加企微账号",
    field(
      "实例名称",
      "name",
      a?.name || "",
      "text",
      'required maxlength="40"',
    ) +
      field(
        "所属空间",
        "company",
        a?.company || w().tenant.name,
        "text",
        'required maxlength="60"',
      ) +
      `<div class="note-band">保存实例信息后，可继续管理白名单。企微登录接口尚未接入。</div>`,
    {
      label: "预览变更",
      run: (form) => {
        const d = formData(form);
        confirmConnectionCommand(
          "确认实例信息",
          `${d.name} · ${d.company}`,
          "account.save",
          { ...d, ...(a ? { id: a.id } : {}) },
          revision,
        );
      },
    },
  );
}
const freq = {
    daily: "每天",
    weekly: "每周",
    half: "每半月",
    monthly: "每月",
    quarterly: "每季度",
    yearly: "每年",
    interval: "自定义间隔",
  },
  ranges = {
    previousDay: "上一个自然日",
    previousWeek: "上一个自然周",
    previousHalf: "上一个自然半月",
    previousMonth: "上一个自然月",
    previousQuarter: "上一个自然季度",
    previousYear: "上一个自然年",
    rolling: "最近 N 天",
  };
const select = (
  label: string,
  name: string,
  values: Record<string, string>,
  selected: string,
) =>
  `<label>${label}<select name="${name}">${options(
    Object.entries(values).map(([id, name]) => ({ id, name })),
    selected,
  )}</select></label>`;
export function editPlan(id = "") {
  const p = w().plans.find((p) => p.id === id) || {
    name: "自定义运营分析",
    enabled: true,
    frequency: "interval",
    time: "09:00",
    weekday: 1,
    monthDay: 1,
    yearMonth: 1,
    every: 10,
    unit: "days",
    anchor: state.boot!.today,
    range: "rolling",
    rangeDays: 30,
  };
  const dialog = modal(
    id ? "编辑分析计划" : "新增分析计划",
    `<div class="plan-editor">${field("计划名称", "name", p.name, "text", 'required maxlength="40"')}${select("启用状态", "enabled", { true: "开启", false: "停用" }, String(p.enabled))}${select("生成频率", "frequency", freq, p.frequency)}${field("生成时间（UTC+8）", "time", p.time, "time", "required")}<div data-plan-show="weekly">${select("星期", "weekday", { "1": "星期一", "2": "星期二", "3": "星期三", "4": "星期四", "5": "星期五", "6": "星期六", "0": "星期日" }, String(p.weekday))}</div><div data-plan-show="monthly quarterly yearly">${field("生成日期（月末自动适配）", "monthDay", String(p.monthDay), "number", 'required min="1" max="31"')}</div><div data-plan-show="yearly">${field("月份", "yearMonth", String(p.yearMonth), "number", 'required min="1" max="12"')}</div><div data-plan-show="interval">${field("每隔", "every", String(p.every), "number", 'required min="1" max="365"')}${select("时间单位", "unit", { days: "天", weeks: "周", months: "个月", years: "年" }, p.unit)}${field("首次生成日期", "anchor", p.anchor, "date", 'required min="2000-01-01" max="2100-12-31"')}</div>${select("分析范围", "range", ranges, p.range)}<div data-range-show>${field("最近天数", "rangeDays", String(p.rangeDays), "number", 'required min="1" max="3660"')}</div></div><p>完整自然周期只包含已结束周期；最近 N 天截至生成前一天。服务运行期间会按计划生成站内报告。</p>`,
    {
      label: "预览计划",
      run: (form) => {
        const v = formData(form),
          d = {
            ...v,
            ...(id ? { id } : {}),
            enabled: v.enabled === "true",
            weekday: Number(v.weekday),
            monthDay: Number(v.monthDay),
            yearMonth: Number(v.yearMonth),
            every: Number(v.every),
            rangeDays: Number(v.rangeDays),
          };
        const cadence =
          v.frequency === "interval"
            ? `每 ${v.every} ${{ days: "天", weeks: "周", months: "个月", years: "年" }[v.unit]}（首次 ${v.anchor}）`
            : v.frequency === "weekly"
              ? `每周${"日一二三四五六"[Number(v.weekday)]}`
              : v.frequency === "half"
                ? "每月 1、16 日"
                : v.frequency === "monthly"
                  ? `每月 ${v.monthDay} 日`
                  : v.frequency === "quarterly"
                    ? `每季首月 ${v.monthDay} 日`
                    : v.frequency === "yearly"
                      ? `每年 ${v.yearMonth} 月 ${v.monthDay} 日`
                      : "每天";
        confirmCommand(
          "确认分析计划",
          `${v.name} · ${v.enabled === "true" ? "开启" : "停用"} · ${cadence} ${v.time}（UTC+8）· ${v.range === "rolling" ? "最近 " + v.rangeDays + " 天" : ranges[v.range as keyof typeof ranges]}`,
          "plan.save",
          d,
        );
      },
    },
  );
  dialog.classList.add("wide-dialog");
  const update = () => {
    const frequency =
        dialog.querySelector<HTMLSelectElement>('[name="frequency"]')!.value,
      range = dialog.querySelector<HTMLSelectElement>('[name="range"]')!.value;
    dialog
      .querySelectorAll<HTMLElement>("[data-plan-show]")
      .forEach(
        (el) =>
          (el.hidden = !el.dataset.planShow!.split(" ").includes(frequency)),
      );
    dialog.querySelector<HTMLElement>("[data-range-show]")!.hidden =
      range !== "rolling";
  };
  dialog.onchange = update;
  update();
}
export function showPlans() {
  modal(
    "自动分析设置",
    `<div class="plan-manager">${slicePage(
      w().plans,
      state.pageSize,
      "plans-modal",
    )
      .map(
        (p) =>
          `<div class="plan-manager-row"><div><strong>${esc(p.name)}</strong><small>${p.enabled ? "已开启" : "已停用"} · 下次 ${fmt(p.nextRun)}</small></div><button class="button" type="button" data-plan="${esc(p.id)}" ${canWrite() ? "" : "disabled"}>编辑</button><button class="text-link" type="button" data-delete-plan="${esc(p.id)}" ${canWrite() ? "" : "disabled"}>删除</button></div>`,
      )
      .join(
        "",
      )}</div>${pager(w().plans.length, state.pageSize, "plans-modal")}<button type="button" class="button" data-action="add-plan" ${canWrite() ? "" : "disabled"}>新增自定义计划</button>`,
  );
}
export function analyze() {
  const requestId = crypto.randomUUID();
  modal(
    "选择本次分析范围",
    `<p>从当前租户记录生成报告，并标注覆盖范围。</p>` +
      field(
        "开始日期",
        "start",
        w().coverageStart,
        "date",
        `required max="${state.boot!.today}"`,
      ) +
      field(
        "结束日期",
        "end",
        state.boot!.today,
        "date",
        `required max="${state.boot!.today}"`,
      ),
    {
      label:
        (state.boot!.aiCapabilities?.analysis ?? state.boot!.aiConfigured)
          ? "生成 AI 分析"
          : "生成数据分析",
      run: async (form) => {
        const d = formData(form);
        if (d.start > d.end) throw new Error("开始日期不能晚于结束日期");
        const report = await post<{ id: string } | AnalysisTask>("/reports", {
          ...d,
          requestId,
          name: "自定义运营分析",
        });
        await refresh();
        if (!("status" in report)) state.report = report.id;
        else if (report.status === "completed" && report.reportId)
          state.report = report.reportId;
        closeModal();
        window.dispatchEvent(new Event("data-updated"));
        toast(
          "status" in report && report.status !== "completed"
            ? "分析任务已提交，可在 AI智能分析查看进度"
            : "报告已生成并保存",
        );
      },
    },
  );
}
export async function ticketDetail(id: string) {
  const loading = modal("工单详情", '<p role="status">正在加载工单详情…</p>');
  const instance = loading.dataset.instance,
    controller = new AbortController();
  const cancelRead = () => {
    // A reused dialog can deliver the previous instance's queued close event.
    if (!loading.open || loading.dataset.instance !== instance)
      controller.abort();
  };
  loading.addEventListener("close", cancelRead);
  let t: Ticket;
  try {
    t = await api<Ticket>("/tickets/" + encodeURIComponent(id), {
      signal: controller.signal,
    });
  } catch (error) {
    if (loading.open && loading.dataset.instance === instance)
      loading.querySelector(".form-error")!.textContent =
        error instanceof Error ? error.message : "工单读取失败";
    return;
  } finally {
    loading.removeEventListener("close", cancelRead);
  }
  if (!loading.open || loading.dataset.instance !== instance) return;
  const el = modal(
    `工单 ${t.id}`,
    `<h3>${esc(t.subject)}</h3>${statusTag(t.status)}<div class="detail-meta"><div><span>${esc(w().tenant.referenceLabel)}</span>${esc(t.reference)}</div><div><span>负责小组</span>${esc(groupName(t.groupId))}</div><div><span>负责人</span>${esc(personName(t.assigneeId))}</div><div><span>创建时间</span>${fmt(t.createdAt)}</div></div>${t.holdReason ? `<div class="note-band">挂起原因：${esc(t.holdReason)}<br>跟进时间：${fmt(t.remindAt)}</div>` : ""}<button type="button" class="button" data-ask-ticket="${esc(t.id)}">在 AI助手中查询这单</button><h3>完整流转记录</h3><div class="timeline">${t.events.map((e) => `<div class="event"><div><strong>${esc(e.name)}</strong><time>${fmt(e.at)}</time></div><p>${esc(e.detail)} · ${esc(e.by)}</p></div>`).join("")}</div><div class="drawer-actions">${[
      ["urge", "催办"],
      ["reassign", "转派"],
      [
        t.status === "ON_HOLD" ? "resume" : "hold",
        t.status === "ON_HOLD" ? "恢复" : "挂起",
      ],
      ["complete", "完成工单"],
    ]
      .map(
        ([action, name]) =>
          `<button type="button" class="button ${action === "urge" ? "primary" : ""}" data-ticket-action="${action}" data-id="${esc(t.id)}" ${t.status === "CLOSED" || !canWrite("ticket." + action) ? "disabled" : ""}>${name}</button>`,
      )
      .join("")}</div>`,
  );
  el.classList.add("ticket-dialog");
}
export function ticketAction(id: string, action: string) {
  const names: Record<string, string> = {
      urge: "催办",
      reassign: "转派",
      hold: "挂起",
      resume: "恢复",
      complete: "完成工单",
    },
    name = names[action];
  if (action === "reassign" || action === "hold") {
    const el = modal(
      name + " " + id,
      action === "hold"
        ? field("挂起原因", "reason", "", "text", 'required maxlength="500"') +
            field(
              "下次跟进时间（UTC+8）",
              "remindAt",
              "",
              "datetime-local",
              "required",
            )
        : w().integration
          ? `<label>目标小组<select name="groupId">${options(w().groups, w().groups[0]?.id)}</select></label><p>由远端按小组排班选择处理人，转派可能发送企微通知。</p>`
          : `<label>目标小组<select name="groupId">${options(w().groups, w().groups[0]?.id)}</select></label><label>处理人<select name="assigneeId">${options(
              w().people.filter(
                (p) => p.groupId === w().groups[0]?.id && p.active,
              ),
              "",
              "待接单",
            )}</select></label>`,
      {
        label: "预览操作",
        run: (form) => {
          const d = formData(form);
          confirmCommand(
            `确认${name} ${id}`,
            action === "hold"
              ? `原因：${d.reason}；跟进：${d.remindAt}`
              : `目标小组：${groupName(d.groupId)}；处理人：${personName(d.assigneeId)}`,
            "ticket.action",
            {
              id,
              action,
              ...d,
              ...(d.remindAt
                ? { remindAt: new Date(d.remindAt + ":00+08:00").toISOString() }
                : {}),
            },
          );
        },
      },
    );
    if (action === "reassign" && !w().integration)
      el.querySelector<HTMLSelectElement>('[name="groupId"]')!.onchange = (
        e,
      ) => {
        el.querySelector('[name="assigneeId"]')!.innerHTML = options(
          w().people.filter(
            (p) =>
              p.groupId === (e.target as HTMLSelectElement).value && p.active,
          ),
          "",
          "待接单",
        );
      };
  } else
    confirmCommand(
      `确认${name} ${id}`,
      `请核对工单 ${id}。${action === "complete" ? "完成后工单进入闭环状态。" : ""}`,
      "ticket.action",
      { id, action },
    );
}
