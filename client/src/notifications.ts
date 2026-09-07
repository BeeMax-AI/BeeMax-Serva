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
  3: ["L3 · 部门升级", "通知部门全体，可排除指定人员"],
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
      return `<tr><td><strong>${notificationLevels[t.tier][0]}</strong><small>${notificationLevels[t.tier][1]}</small></td><td>${mode === "all" ? "<strong>部门全体（@所有人）</strong><small>可指定人员或设置排除名单</small>" : mode === "special" ? "特殊通知配置 · 请在源系统查看" : `<div class="notification-members">${members.map((p) => `<span class="notification-person">${esc(p.name)}<button class="text-link" data-notification-remove="${esc(p.userId)}" data-tier="${t.tier}" aria-label="从 L${t.tier} 移除 ${esc(p.name)}" ${canWrite("roster.member.remove") ? "" : "disabled"}>×</button></span>`).join("") || "<span>未配置通知人员</span>"}</div>`}</td><td>${tag(today ? (t.overridden ? "今日覆盖" : "沿用默认") : "默认名单")}${!today && t.overridden ? "<small>今日有单独覆盖</small>" : ""}</td><td>${t.tier === 3 && mode !== "special" ? `<button class="button" data-notification-mode="3" ${canWrite("roster.level.save") ? "" : "disabled"}>编辑通知方式</button> ` : ""}${editable ? `<button class="button" data-notification-add="${t.tier}" ${canWrite("roster.member.add") ? "" : "disabled"}>添加人员</button>` : t.tier === 3 && mode === "all" ? "" : "源系统管理"}</td></tr>`;
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

export function editNotificationMode() {
  const groupId = state.notificationGroup,
    scope = state.notificationScope,
    date = state.boot!.today;
  const row = w().notificationTiers?.find(
    (t) => t.groupId === groupId && t.tier === 3,
  );
  if (!row) return;
  const currentMode = scope === "today" ? row.effectiveMode : row.defaultMode;
  if (currentMode === "special") return;
  const current = scope === "today" ? row.effective : row.defaults;
  const known = [
    ...new Map(
      [
        ...w()
          .people.filter(
            (p) => p.rosterUserId && !p.rosterUserId.startsWith("@"),
          )
          .map((p) => ({ userId: p.rosterUserId!, name: p.name })),
        ...current,
      ].map((p) => [p.userId, p]),
    ).values(),
  ];
  const context = `${w().groups.find((g) => g.id === groupId)?.name} · L3 · ${scope === "today" ? "仅 " + date : "默认持续生效（保留今日覆盖）"}`;
  const before =
    currentMode === "all"
      ? "部门全体（@所有人）"
      : current.map((p) => `${p.name}（${p.userId}）`).join("、") || "空名单";
  const excluded = new Map<string, { userId: string; name: string }>();
  const exclusionCandidates = known.filter((person) =>
    w().people.some((p) => p.groupId === groupId && p.rosterUserId === person.userId),
  );
  const dialog = modal(
    "编辑 L3 通知方式",
    `<p>${esc(context)}</p><label>通知方式<select name="mode"><option value="all" ${currentMode === "all" ? "selected" : ""}>部门全体（@所有人）</option><option value="people" ${currentMode === "people" ? "selected" : ""}>指定人员</option><option value="all_except">部门全体 · 排除指定人员（预览）</option></select></label><fieldset class="notification-options" ${currentMode === "all" ? "hidden disabled" : ""}><legend>指定通知人员（至少一位）</legend><label>新增人员（可选）<textarea name="newMembers" rows="3" maxlength="26000" placeholder="每行填写：企微人员ID,姓名"></textarea></label>${known.map((p) => `<label><input type="checkbox" name="member" value="${esc(p.userId)}" ${current.some((c) => c.userId === p.userId) ? "checked" : ""}><span>${esc(p.name)}<small>${esc(p.userId)}</small></span></label>`).join("") || "<p>暂无已知人员，可在上方填写新人员。</p>"}</fieldset><p data-people-help>可勾选已知人员或填写新人员，合并为本级通知名单。</p>${exclusionEditorContent(exclusionCandidates)}`,
    {
      label: "预览变更",
      run: (form) => {
        const mode = formData(form).mode;
        if (mode === "all_except") {
          const pendingId = formData(form).excludedId?.trim();
          const pendingName = formData(form).excludedName?.trim();
          if (pendingId || pendingName)
            throw new Error("请先点击添加排除人员，或清空未添加的输入");
          if (!excluded.size) throw new Error("请至少添加一位排除人员");
          const preview = dialog.querySelector<HTMLElement>("[data-exclusion-preview]")!;
          preview.hidden = false;
          preview.innerHTML = `<h3>变更预览</h3><p>${esc(context)}</p><p>当前设置：${esc(before)}</p><p>拟设置：部门全体，排除 ${excluded.size} 人</p><p>${[...excluded.values()].map((p) => `${esc(p.name)}（${esc(p.userId)}）`).join("、")}</p><p><strong>尚未生效</strong> · 接口接通后才可保存，此次预览未改变实际通知。</p>`;
          preview.scrollIntoView({ block: "nearest" });
          return;
        }
        const selected = new Set(
          new FormData(form).getAll("member").map(String),
        );
        const members =
          mode === "people"
            ? [
                ...known.filter((p) => selected.has(p.userId)),
                ...parseNotificationPeople(formData(form).newMembers || ""),
              ]
            : [];
        if (new Set(members.map((p) => p.userId)).size !== members.length)
          throw new Error("通知人员 ID 重复，请核对勾选和新增名单");
        if (mode === "people" && !members.length)
          throw new Error("请至少选择一位通知人员");
        const after =
          mode === "all"
            ? "部门全体（@所有人）"
            : members.map((p) => `${p.name}（${p.userId}）`).join("、");
        confirmCommand(
          "确认 L3 通知方式变更",
          `${context}。原设置：${before}。新设置：${after}。保存将替换当前范围的 L3 名单，其他级别不变。`,
          "roster.level.save",
          { groupId, scope, date, tier: 3, mode, members },
        );
      },
    },
  );
  const exclusionPanel = dialog.querySelector<HTMLFieldSetElement>("[data-exclusions]")!;
  const preview = dialog.querySelector<HTMLElement>("[data-exclusion-preview]")!;
  const error = dialog.querySelector<HTMLElement>(".form-error")!;
  const updateExcluded = () => {
    preview.hidden = true;
    error.textContent = "";
    dialog.querySelector<HTMLElement>("[data-excluded-count]")!.textContent = `已排除 ${excluded.size} 人`;
    dialog.querySelector<HTMLElement>("[data-excluded-list]")!.innerHTML =
      [...excluded.values()].map((p) => `<div class="exclusion-person"><span>${esc(p.name)}<small>${esc(p.userId)}</small></span><button type="button" class="text-link" data-cancel-exclusion="${esc(p.userId)}" aria-label="取消排除 ${esc(p.name)}">取消排除</button></div>`).join("") || '<p class="muted">暂未排除任何人员</p>';
  };
  dialog.querySelector("[data-excluded-list]")!.addEventListener("click", (e) => {
    const button = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-cancel-exclusion]");
    if (!button) return;
    excluded.delete(button.dataset.cancelExclusion!);
    updateExcluded();
  });
  dialog.querySelector("[data-add-exclusion]")!.addEventListener("click", () => {
    try {
      const id = dialog.querySelector<HTMLInputElement>('[name="excludedId"]')!;
      const name = dialog.querySelector<HTMLInputElement>('[name="excludedName"]')!;
      const person = parseNotificationPeople(`${id.value.trim()},${name.value.trim()}`)[0];
      if (!person) throw new Error("请填写姓名和企微人员 ID");
      if (excluded.has(person.userId)) throw new Error("该人员已在排除名单中");
      if (excluded.size >= 200) throw new Error("最多排除 200 人");
      excluded.set(person.userId, person);
      id.value = name.value = "";
      dialog.querySelector<HTMLSelectElement>('[name="excludedKnown"]')!.value = "";
      updateExcluded();
    } catch (e) { error.textContent = e instanceof Error ? e.message : "添加失败"; }
  });
  dialog.onchange = (e) => {
    const target = e.target as HTMLSelectElement;
    if (target.name === "excludedKnown") {
      const person = exclusionCandidates.find((p) => p.userId === target.value);
      dialog.querySelector<HTMLInputElement>('[name="excludedId"]')!.value = person?.userId || "";
      dialog.querySelector<HTMLInputElement>('[name="excludedName"]')!.value = person?.name || "";
    }
    if (target.name !== "mode") return;
    const fieldset = dialog.querySelector<HTMLFieldSetElement>(".notification-options")!;
    fieldset.hidden = fieldset.disabled = target.value !== "people";
    exclusionPanel.hidden = exclusionPanel.disabled = target.value !== "all_except";
    dialog.querySelector<HTMLElement>("[data-people-help]")!.hidden = target.value !== "people";
    preview.hidden = true;
    error.textContent = "";
  };
  exclusionPanel.addEventListener("input", () => { preview.hidden = true; });

}

export function parseNotificationPeople(value: string) {
  if (!value.trim()) return [];
  return value
    .trim()
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line, index) => {
      const parts = line.split(/[,，]/).map((part) => part.trim());
      if (
        parts.length !== 2 ||
        !parts[0] ||
        !parts[1] ||
        parts[0].startsWith("@") ||
        parts[0].length > 128 ||
        parts[1].length > 100
      )
        throw new Error(`第 ${index + 1} 行请按“企微人员ID,姓名”填写`);
      return { userId: parts[0], name: parts[1] };
    });
}

function exclusionEditorContent(people: { userId: string; name: string }[]) {
  return `<fieldset class="exclusion-editor" data-exclusions hidden disabled>
    <legend>排除人员</legend>
    <div class="note-band"><strong>界面预览 · 尚未生效</strong><p>仅编辑本次预览，关闭后不保留。接通接口后才可保存。</p></div>
    <label>选择当前小组已知人员<select name="excludedKnown">${options(people.map((p) => ({ id: p.userId, name: `${p.name} · ${p.userId}` })), "", "选择人员，或手动填写")}</select></label>
    <p class="muted">候选来自已知排班，暂非完整部门名单。</p>
    <div class="exclusion-inputs">${field("姓名", "excludedName", "", "text", 'maxlength="100"')}${field("企微人员 ID", "excludedId", "", "text", 'maxlength="128"')}</div>
    <button type="button" class="button" data-add-exclusion>添加排除人员</button>
    <h3 data-excluded-count aria-live="polite">已排除 0 人</h3>
    <div class="exclusion-list" data-excluded-list><p class="muted">暂未排除任何人员</p></div>
    <p>排除后不 @ 此人，仍可看到群消息；不影响其他通知级别。</p>
  </fieldset><section class="note-band exclusion-preview" data-exclusion-preview aria-live="polite" hidden></section>`;
}
