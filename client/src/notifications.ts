import {
  state,
  w,
  esc,
  options,
  table,
  tag,
  canWrite,
  modal,
  field,
  formData,
  confirmCommand,
} from "./core.js";

export const notificationLevels: Record<number, [string, string]> = {
  1: ["L1 · 一线响应", "首先通知的一线处理人员"],
  2: ["L2 · 二线升级", "未接单时升级通知二线人员"],
  3: ["L3 · 部门升级", "扩大通知范围；当前可配置为 @所有人"],
  4: ["L4 · 兜底通知", "最后一级通知的兜底负责人"],
};
export function notificationContent() {
  if (!w().notificationTiers) return "";
  if (!w().groups.some((g) => g.id === state.notificationGroup))
    state.notificationGroup = w().groups[0]?.id || "";
  const today = state.notificationScope === "today";
  const tiers = w().notificationTiers!.filter(
    (t) => t.groupId === state.notificationGroup,
  );
  return `<section class="notification-settings" aria-label="升级通知设置"><div class="config-title"><div><h2>升级通知设置</h2><p>未接单时逐级通知 · 当前升级间隔 ${w().parameters.escalationMinutes} 分钟 / 级</p></div><label>通知小组<select id="notification-group" aria-label="通知小组">${options(w().groups, state.notificationGroup)}</select></label></div>
  <div class="notification-scope"><label>修改范围<select id="notification-scope" aria-label="修改通知名单范围"><option value="today" ${today ? "selected" : ""}>今日有效名单 · ${esc(state.boot!.today)}</option><option value="default" ${!today ? "selected" : ""}>默认通知名单 · 持续生效</option></select></label><p>${today ? "修改仅覆盖今天对应级别，次日恢复默认名单。今日排班不代表实时在岗。" : "修改默认名单；今日已有覆盖的级别仍使用今日名单，后续未覆盖日期使用新默认。"}</p></div>
  ${table(
    ["通知级别", "通知人员", "名单来源", "操作"],
    tiers.map((t) => {
      const mode = today ? t.effectiveMode : t.defaultMode,
        members = today ? t.effective : t.defaults;
      const editable = mode === "people";
      return `<tr><td><strong>${notificationLevels[t.tier][0]}</strong><small>${notificationLevels[t.tier][1]}</small></td><td>${mode === "all" ? "<strong>部门全体（@所有人）</strong><small>广播规则，不作为个人增删</small>" : mode === "special" ? "特殊通知配置 · 请在源系统查看" : `<div class="notification-members">${members.map((p) => `<span class="notification-person">${esc(p.name)}<button class="text-link" data-notification-remove="${esc(p.userId)}" data-tier="${t.tier}" aria-label="从 L${t.tier} 移除 ${esc(p.name)}" ${canWrite("roster.member.remove") ? "" : "disabled"}>×</button></span>`).join("") || "<span>未配置通知人员</span>"}</div>`}</td><td>${tag(today ? (t.overridden ? "今日覆盖" : "沿用默认") : "默认名单")}${!today && t.overridden ? "<small>今日有单独覆盖</small>" : ""}</td><td>${editable ? `<button class="button" data-notification-add="${t.tier}" ${canWrite("roster.member.add") ? "" : "disabled"}>添加人员</button>` : "源系统管理"}</td></tr>`;
    }),
  )}<div class="panel-footer">这里只调整升级通知名单，不移除企业成员或修改群成员关系。楼栋、时段及专员规则仍由远端执行。</div></section>`;
}
export function editNotificationMember(tier: number, userId?: string) {
  const groupId = state.notificationGroup,
    scope = state.notificationScope,
    date = state.boot!.today;
  const groupName = w().groups.find((g) => g.id === groupId)?.name;
  const row = w().notificationTiers?.find(
    (t) => t.groupId === groupId && t.tier === tier,
  );
  if (!row) return;
  const members = scope === "today" ? row.effective : row.defaults;
  const person = members.find((p) => p.userId === userId);
  const range =
    scope === "today" ? `仅 ${date}` : "默认名单（持续生效，保留今日覆盖）";
  const context = `${groupName} · ${notificationLevels[tier][0]} · ${range}`;
  if (userId) {
    if (!person) return;
    confirmCommand(
      "确认移除通知人",
      `${context}：移除 ${person.name}（${userId}）。${members.length === 1 ? "移除后本级将没有通知人员。" : ""}只从本级名单移除，其他级别、日期与小组保持不变。`,
      "roster.member.remove",
      { groupId, scope, date, tier, userId },
    );
    return;
  }
  const known = [
    ...new Map(
      w()
        .people.filter((p) => p.rosterUserId && !p.rosterUserId.startsWith("@"))
        .map((p) => [p.rosterUserId!, p]),
    ).values(),
  ];
  const dialog = modal(
    "添加升级通知人",
    `<p>${esc(context)}</p><label>选择已知人员（可选）<select name="known">${options(
      known.map((p) => ({
        id: p.rosterUserId!,
        name: `${p.name} · ${p.rosterUserId}`,
      })),
      "",
      "手动填写新人员",
    )}</select></label>${field("姓名", "name", "", "text", 'required maxlength="100"')}${field("企微人员 ID", "userId", "", "text", 'required maxlength="128"')}<p>填写真实企微人员 ID，用于准确通知；姓名只用于显示。本操作不添加群成员。</p>`,
    {
      label: "预览变更",
      run: (form) => {
        const d = formData(form);
        confirmCommand(
          "确认添加通知人",
          `${context}：添加 ${d.name}（${d.userId}）。${scope === "today" ? "本级将保存为今日覆盖名单。" : ""}`,
          "roster.member.add",
          { groupId, scope, date, tier, userId: d.userId, name: d.name },
        );
      },
    },
  );
  dialog.onchange = (e) => {
    if ((e.target as HTMLSelectElement).name !== "known") return;
    const p = known.find(
      (p) => p.rosterUserId === (e.target as HTMLSelectElement).value,
    );
    dialog.querySelector<HTMLInputElement>('[name="name"]')!.value =
      p?.name || "";
    dialog.querySelector<HTMLInputElement>('[name="userId"]')!.value =
      p?.rosterUserId || "";
  };
}
