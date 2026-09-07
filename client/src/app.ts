import {
  editNotificationMember,
  editNotificationMode,
} from "./notifications.js";
import { toggleQiweSecret, resetQiweSecrets } from "./qiwe.js";
import { preserveConnections } from "./bootstrap-state.js";
import {
  connections,
  confirmConnectionCommand,
  refreshConnections,
} from "./connections.js";
import type { QiweSaveResult } from "../../shared/domain.js";
import { pollAnalysisTasks } from "./analysis-tasks.js";
import { metrics } from "../../shared/metrics.js";
import {
  SyncSchedule,
  readSyncMinutes,
  validSyncMinutes,
  type SyncOutcome,
} from "../../shared/sync.js";
import {
  queryAnalytics,
  queryReport,
  showScheduleRules,
  editRoster,
  editRosterPerson,
  editAccess,
} from "./mcp.js";
import type { Bootstrap } from "../../shared/domain.js";
import {
  state,
  currentPage,
  setPage,
  w,
  esc,
  fmt,
  icon,
  button,
  tag,
  modal,
  field,
  formData,
  confirmCommand,
  closeModal,
  toast,
  api,
  post,
  command,
  offsetDate,
  canWrite,
  personName,
  options,
} from "./core.js";
import * as pages from "./pages.js";
import {
  settings,
  editRoute,
  editPerson,
  editParameters,
  editAccount,
  editPlan,
  showPlans,
  analyze,
  ticketDetail,
  ticketAction,
} from "./settings.js";
import {
  renderAssistant,
  resetAssistant,
  closeAssistant,
  askAboutTicket,
  assistantPageChanged,
} from "./assistant.js";
const navs = [
  ["insights", "spark", "AI智能分析"],
  ["overview", "overview", "运营总览"],
  ["trends", "trend", "工单趋势"],
  ["tickets", "ticket", "工单明细"],
  ["staff", "staff", "人员与负载"],
  ["accounts", "staff", "企微账号"],
  ["messages", "chat", "消息日志"],
  ["settings", "settings", "配置管理"],
];
let pendingLoad: Promise<SyncOutcome> | undefined;
let loadController: AbortController | undefined;
let loadSequence = 0,
  messageAuto = false,
  refreshTimer: number;
const syncSchedule = new SyncSchedule();
let syncIdentity = "",
  syncKey = "",
  syncPhase: "synced" | "syncing" | "failed" = "synced",
  syncTimer: number | undefined;
function dirtyPageForm() {
  return [
    ...document.querySelectorAll<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >("#content form input, #content form textarea, #content form select"),
  ].some((input) => {
    if (input instanceof HTMLSelectElement)
      return [...input.options].some((o) => o.selected !== o.defaultSelected);
    if (
      input instanceof HTMLInputElement &&
      ["checkbox", "radio"].includes(input.type)
    )
      return input.checked !== input.defaultChecked;
    return input.value !== input.defaultValue;
  });
}
function restoreSyncFocus(previous: HTMLElement | null) {
  if (!previous || previous === document.body || previous.isConnected) return;
  const attrs = [...previous.attributes].filter(
    (a) =>
      a.name === "id" ||
      a.name === "href" ||
      a.name === "aria-label" ||
      a.name.startsWith("data-"),
  );
  const replacement = [
    ...document.querySelectorAll<HTMLElement>(previous.tagName),
  ].find(
    (el) =>
      attrs.every((a) => el.getAttribute(a.name) === a.value) &&
      el.textContent === previous.textContent,
  );
  if (replacement && !replacement.matches(":disabled"))
    replacement.focus({ preventScroll: true });
  else {
    const heading = document.querySelector<HTMLElement>("#content h1");
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
  }
}
function syncBlocked() {
  return (
    document.hidden ||
    dirtyPageForm() ||
    !!document.querySelector<HTMLDialogElement>("#modal")?.open ||
    !!document.activeElement?.matches(
      "input, textarea, select, [contenteditable=true]",
    ) ||
    !!document.querySelector("[data-chat-stop]")
  );
}
function syncStatus() {
  const b = document.querySelector<HTMLButtonElement>("#sync-status");
  if (!b) return;
  const label =
    syncPhase === "syncing"
      ? "正在同步"
      : syncPhase === "failed"
        ? "同步失败"
        : w().integration?.complete === false
          ? "部分数据已同步"
          : "数据已同步";
  b.dataset.syncedAt = w().integration?.checkedAt || "";
  b.dataset.state =
    syncPhase === "synced" && w().integration?.complete === false
      ? "partial"
      : syncPhase;
  b.innerHTML = `<span class="sync-dot" aria-hidden="true"></span><span>${label}</span>`;
  b.title = `每 ${syncSchedule.minutes} 分钟自动同步 · 点击设置周期`;
  b.setAttribute("aria-label", `${label}，设置同步周期`);
}
function startDataSync() {
  if (!state.boot || state.boot.mode !== "mcp") return;
  const identity = JSON.stringify([
    state.boot.actor.tenantId,
    state.boot.actor.id,
  ]);
  if (syncIdentity !== identity) {
    syncIdentity = identity;
    syncKey = "qf:sync-minutes:" + identity;
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(syncKey);
    } catch {
      /* Private browsing can disable storage. */
    }
    syncSchedule.configure(readSyncMinutes(saved));
  }
  if (syncTimer === undefined)
    syncTimer = window.setInterval(() => {
      void syncSchedule.tick(
        () => load(true),
        () => !state.boot || state.boot.mode !== "mcp" || syncBlocked(),
      );
    }, 1000);
  syncStatus();
}
function stopDataSync() {
  loadController?.abort();
  pendingLoad = undefined;
  clearInterval(syncTimer);
  syncTimer = undefined;
  syncIdentity = "";
  ++loadSequence;
}
function editSync() {
  const minutes = syncSchedule.minutes;
  const dialog = modal(
    "自动同步",
    `<label>同步周期<select name="cycle"><option value="5" ${minutes === 5 ? "selected" : ""}>每 5 分钟</option><option value="10" ${minutes === 10 ? "selected" : ""}>每 10 分钟</option><option value="custom" ${![5, 10].includes(minutes) ? "selected" : ""}>自定义</option></select></label><div data-custom-sync ${[5, 10].includes(minutes) ? "hidden" : ""}>${field("间隔（分钟）", "minutes", String(minutes), "number", 'min="1" max="1440" step="1" required ' + ([5, 10].includes(minutes) ? "disabled" : ""))}</div><p>当前浏览器记住此设置，页面打开时自动同步。</p>`,
    {
      label: "保存",
      run: (form) => {
        const d = formData(form),
          next = Number(d.cycle === "custom" ? d.minutes : d.cycle);
        if (!validSyncMinutes(next))
          throw new Error("请输入 1–1440 的整数分钟");
        try {
          localStorage.setItem(syncKey, String(next));
        } catch {
          throw new Error("浏览器无法保存设置，请允许本站使用本地存储后重试");
        }
        syncSchedule.configure(next);
        closeModal();
        syncStatus();
        toast(`已设置每 ${next} 分钟自动同步`);
      },
    },
  );
  dialog.onchange = (e) => {
    if ((e.target as HTMLSelectElement).name === "cycle") {
      const custom = (e.target as HTMLSelectElement).value === "custom";
      dialog.querySelector<HTMLElement>("[data-custom-sync]")!.hidden = !custom;
      dialog.querySelector<HTMLInputElement>('[name="minutes"]')!.disabled =
        !custom;
    }
  };
}
function login() {
  stopDataSync();
  state.boot = null;
  resetAssistant();
  document.querySelector("#app")!.innerHTML =
    `<main class="login-screen"><section class="login-card"><img src="/assets/beemax-logo-mark.svg" alt="千蜂智服"><div class="eyebrow">BEEMAX / SERVICE</div><h1>千蜂智服</h1><p>AI 服务运营平台</p><form id="login-form">${field("账号", "username", "", "text", 'required autocomplete="username" placeholder="请输入账号"')}${field("密码", "password", "", "password", 'required autocomplete="current-password"')}<p class="form-error" role="alert"></p><button class="button primary">登录工作空间 →</button></form><small>首次启动的本地账号保存在服务器 .local/access.json。</small></section></main>`;
  document.querySelector<HTMLFormElement>("#login-form")!.onsubmit = async (
    e,
  ) => {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement,
      b = form.querySelector("button")!;
    b.disabled = true;
    try {
      await post("/login", formData(form));
      await load();
    } catch (error) {
      form.querySelector(".form-error")!.textContent =
        error instanceof Error ? error.message : "登录失败";
    } finally {
      b.disabled = false;
    }
  };
}
function renderShell() {
  const a = state.boot!.actor;
  document.querySelector("#app")!.innerHTML =
    `<aside class="sidebar"><a class="brand" href="#overview" aria-label="千蜂智服首页"><img class="brand-mark" src="/assets/beemax-logo-mark.svg" alt=""><img class="brand-name" src="/assets/beemax-wordmark-white.svg" alt="千蜂AI"></a><div class="workspace"><div><strong>千蜂智服</strong><small>AI 服务运营平台</small></div></div><div class="nav-label">AI 工作区</div><nav id="navigation">${navs.map(([id, i, name]) => `${id === "overview" ? '<div class="nav-separator"></div><div class="nav-label">工作空间</div>' : id === "accounts" ? '<div class="nav-separator"></div><div class="nav-label">连接管理</div>' : ""}<a href="#${id}" class="nav-item ${id === state.page || (id === "accounts" && state.page === "agent") ? "active" : ""} ${id === "insights" ? "ai-nav-item" : ""}" ${id === state.page ? 'aria-current="page"' : ""}>${icon(i)}<span>${name}</span></a>`).join("")}</nav><div class="sidebar-bottom"><div class="demo-status"><span></span>${state.boot!.mode === "local" ? "本地开发数据" : "MCP 数据源"}</div><div class="profile"><span class="avatar inverse">${esc(a.name[0])}</span><div>${esc(a.name)}<small>${esc({ owner: "平台管理员", admin: "运营管理员", viewer: "只读用户" }[a.role])} · ${esc(w().tenant.name)}</small></div><button class="icon-button" data-action="logout" aria-label="退出登录">${icon("arrow")}</button></div></div></aside><div class="shell"><header class="topbar"><div class="breadcrumb"><button class="icon-button mobile-menu" data-action="nav" aria-label="打开导航">☰</button><span>工作空间</span><span>/</span><strong id="crumb">${state.page === "agent" ? "企微账号" : navs.find((n) => n[0] === state.page)?.[2] || ""}</strong></div><div class="top-actions">${state.boot!.mode === "local" ? `<span class="demo-label">本地模式 · MCP 待接入</span>` : `<button id="sync-status" class="sync-status" data-action="sync-settings" aria-label="设置同步周期"></button>`}<button class="icon-button" data-action="refresh" aria-label="刷新页面">${icon("refresh")}</button></div></header><main id="content"></main><footer class="page-footer"><span>BeeMax AI · 让每一件事，都有回应</span><span>${esc(w().tenant.name)} · UTC+8</span></footer></div>`;
}
function renderContent() {
  if (!state.boot) return;
  const previousReport =
    document.querySelector<HTMLElement>(".report-reading")?.dataset.reportId;
  const expandedReportSections = new Set(
    [
      ...document.querySelectorAll<HTMLDetailsElement>(
        "details[data-report-disclosure][open]",
      ),
    ].map((el) => el.dataset.reportDisclosure),
  );
  const map: Record<string, () => string> = {
    overview: pages.overview,
    trends: pages.trends,
    tickets: pages.tickets,
    staff: pages.staff,
    accounts: pages.accounts,
    messages: pages.messages,
    agent: pages.agent,
    insights: pages.insights,
    settings,
  };
  document.querySelector("#content")!.innerHTML = (
    map[state.page] || pages.overview
  )();
  if (
    previousReport &&
    document.querySelector<HTMLElement>(".report-reading")?.dataset.reportId ===
      previousReport
  )
    document
      .querySelectorAll<HTMLDetailsElement>("details[data-report-disclosure]")
      .forEach((el) => {
        el.open = expandedReportSections.has(el.dataset.reportDisclosure);
      });
  const auto = document.querySelector<HTMLInputElement>("#message-auto");
  if (auto) auto.checked = messageAuto;
}
function loadMetrics() {
  if (!state.boot) return;
  const end = state.boot.today,
    start = offsetDate(
      end,
      state.period === "day" ? 0 : state.period === "month" ? -29 : -6,
    );
  state.metrics = metrics(w(), start, end);
}
function load(automatic = false): Promise<SyncOutcome> {
  if (pendingLoad) return pendingLoad;
  const request = runLoad(automatic).finally(() => {
    if (pendingLoad === request) pendingLoad = undefined;
  });
  pendingLoad = request;
  return request;
}
async function runLoad(automatic = false): Promise<SyncOutcome> {
  const seq = ++loadSequence;
  const previousPhase = syncPhase === "failed" ? "failed" : "synced";
  try {
    syncPhase = "syncing";
    syncStatus();
    loadController = new AbortController();
    const boot = await api<Bootstrap>("/bootstrap", {
      signal: loadController.signal,
    });
    const period = state.period;
    const start = offsetDate(
      boot.today,
      period === "day" ? 0 : period === "month" ? -29 : -6,
    );
    const freshMetrics = metrics(boot.workspace, start, boot.today);
    if (
      seq !== loadSequence ||
      (automatic && (syncBlocked() || period !== state.period))
    ) {
      if (seq === loadSequence) {
        syncPhase = previousPhase;
        syncStatus();
      }
      return "deferred";
    }
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    preserveConnections(state.boot, boot);
    state.boot = boot;
    state.metrics = freshMetrics;
    if (!state.date) state.date = boot.today;
    syncPhase = "synced";
    syncSchedule.reset();
    state.page = location.hash.slice(1) || "insights";
    if (!navs.some((n) => n[0] === state.page) && state.page !== "agent")
      state.page = "overview";
    if (!document.querySelector("#content")) renderShell();
    updateNavigation();
    renderContent();
    renderAssistant();
    startDataSync();
    if (automatic) restoreSyncFocus(previousFocus);
    return "synced";
  } catch (error) {
    if (seq !== loadSequence) return "deferred";
    syncPhase = "failed";
    syncStatus();
    if (!state.boot) {
      if (error instanceof Error && error.message === "请登录后继续") {
        login();
        return "failed";
      }
      document.querySelector("#app")!.innerHTML =
        `<main class="loading-screen"><h1>暂时无法加载工作空间</h1><p>${esc(error instanceof Error ? error.message : "连接失败")}</p>${button("重试", "refresh")}</main>`;
    } else if (!automatic)
      toast(error instanceof Error ? error.message : "加载失败");
    return "failed";
  }
}
function updateNavigation() {
  document
    .querySelectorAll<HTMLAnchorElement>("#navigation a")
    .forEach((link) => {
      const active =
        link.hash === "#" + (state.page === "agent" ? "accounts" : state.page);
      link.classList.toggle("active", active);
      if (active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
  const crumb = document.querySelector("#crumb");
  if (crumb)
    crumb.textContent =
      state.page === "agent"
        ? "企微账号"
        : navs.find((n) => n[0] === state.page)?.[2] || "运营总览";
}
function showLoadedPage() {
  if (!state.boot) {
    void load();
    return;
  }
  if (!navs.some((n) => n[0] === state.page) && state.page !== "agent")
    state.page = "overview";
  loadMetrics();
  updateNavigation();
  renderContent();
  renderAssistant();
  syncStatus();
}
function navigate(page: string) {
  if (location.hash === "#" + page) {
    state.page = page;
    showLoadedPage();
  } else location.hash = page;
}
function focusPagedList(scope: string) {
  const container = document
    .querySelector(`[data-pagination="${scope}"]`)
    ?.closest<HTMLElement>("section, aside, dialog");
  const target = container?.querySelector<HTMLElement>("h2") || container;
  if (target) {
    target.tabIndex = -1;
    target.focus({ preventScroll: true });
  }
  container?.scrollIntoView({ block: "start" });
}
function renderPaging(scope: string) {
  if (scope === "plans-modal") showPlans();
  else renderContent();
  focusPagedList(scope);
}
async function handleClick(e: MouseEvent) {
  const b = (e.target as Element).closest<HTMLButtonElement>("button");
  if (!b || b.disabled) return;
  if (b.dataset.pageStep) {
    const scope = b.dataset.pageScope || "main";
    setPage(currentPage(scope) + Number(b.dataset.pageStep), scope);
    renderPaging(scope);
    return;
  }
  const a = b.dataset.action;
  if (a === "nav") {
    document.body.classList.toggle("nav-open");
    return;
  }
  if (a === "logout") {
    await post("/logout", {});
    clearInterval(refreshTimer);
    login();
    return;
  }
  if (a === "refresh") {
    if ((await load()) === "synced") toast("数据已同步");
    return;
  }
  if (!state.boot) return;
  if (a === "sync-settings") {
    editSync();
    return;
  }
  if (b.dataset.askTicket) {
    closeModal();
    askAboutTicket(b.dataset.askTicket);
    return;
  }
  if (b.dataset.ticket) {
    closeAssistant();
    await ticketDetail(b.dataset.ticket);
    return;
  }
  if (b.dataset.ticketAction) {
    ticketAction(b.dataset.id!, b.dataset.ticketAction);
    return;
  }
  if (b.dataset.tab) {
    state.tab = b.dataset.tab;
    state.query = "";
    state.group = "";
    state.tier = "";
    state.listPage = 1;
    renderContent();
    document
      .querySelector<HTMLElement>(`[data-tab="${state.tab}"]`)
      ?.focus({ preventScroll: true });
    return;
  }
  if (b.dataset.period) {
    state.period = b.dataset.period;
    loadMetrics();
    renderContent();
    return;
  }
  if (b.dataset.qiweSecret) {
    toggleQiweSecret(b as HTMLButtonElement);
    return;
  }
  if (b.dataset.whitelistTab || b.dataset.whitelistKind) {
    if (b.dataset.whitelistTab)
      state.whitelistTab = b.dataset.whitelistTab as typeof state.whitelistTab;
    if (b.dataset.whitelistKind)
      state.whitelistKind = b.dataset
        .whitelistKind as typeof state.whitelistKind;
    state.extraPages.whitelist = 1;
    renderContent();
    document
      .querySelector<HTMLElement>(
        b.dataset.whitelistTab
          ? `[data-whitelist-tab="${state.whitelistTab}"]`
          : `[data-whitelist-kind="${state.whitelistKind}"]`,
      )
      ?.focus({ preventScroll: true });
    return;
  }
  if (b.dataset.pushGroup) {
    confirmConnectionCommand(
      "确认调整推送范围",
      `${b.dataset.enabled === "true" ? "开启" : "关闭"}群 ${b.dataset.pushGroup} 的主动推送配置。`,
      "group.push",
      {
        accountId: state.agent,
        chatId: b.dataset.pushGroup,
        enabled: b.dataset.enabled === "true",
      },
    );
    return;
  }
  if (b.dataset.agent) {
    state.whitelistTab = "authorization";
    state.whitelistKind = "groups";
    state.extraPages.whitelist = 1;
    state.agent = b.dataset.agent;
    renderContent();
    document
      .querySelector("#account-whitelist")
      ?.scrollIntoView({ block: "start" });
    return;
  }
  if (b.dataset.logs) {
    state.account = b.dataset.logs;
    state.query = "";
    state.status = "";
    state.direction = "";
    state.messageType = "";
    state.listPage = 1;
    navigate("messages");
    return;
  }
  if (b.dataset.editAccount) editAccount(b.dataset.editAccount);
  if (b.dataset.route) editRoute(b.dataset.route);
  if (b.dataset.deleteRoute)
    confirmCommand(
      "删除路由规则",
      w().integration
        ? "移除关键词规则，或撤销类型覆盖并恢复基础路由；会立即生效。"
        : "删除后不再使用此规则。",
      "route.delete",
      {
        id: b.dataset.deleteRoute,
      },
    );
  if (b.dataset.person) editPerson(b.dataset.person);
  if (b.dataset.notificationMode) editNotificationMode();
  if (b.dataset.notificationAdd)
    editNotificationMember(Number(b.dataset.notificationAdd));
  if (b.dataset.notificationRemove)
    editNotificationMember(
      Number(b.dataset.tier),
      b.dataset.notificationRemove,
    );
  if (b.dataset.rosterPerson) editRosterPerson(b.dataset.rosterPerson);
  if (b.dataset.accessPolicy) editAccess(b.dataset.accessPolicy, true);
  if (b.dataset.accessAdd) editAccess(b.dataset.accessAdd);
  if (b.dataset.accessRemove)
    confirmCommand(
      "移除私聊白名单用户",
      `${b.dataset.accessRemove} 将移出 ${b.dataset.channel === "wecom" ? "企微" : "飞书"} 白名单；渠道服务会重启。`,
      "access.save",
      {
        channel: b.dataset.channel,
        action: "remove_dm_allow",
        userId: b.dataset.accessRemove,
      },
    );
  if (b.dataset.plan) editPlan(b.dataset.plan);
  if (b.dataset.deletePlan)
    confirmCommand(
      "删除分析计划",
      "已生成的历史报告仍会保留。",
      "plan.delete",
      { id: b.dataset.deletePlan },
    );
  if (b.dataset.learning) {
    const key = b.dataset.learning as "autoApply" | "routingShadow";
    confirmCommand(
      "确认开关变更",
      `${key === "autoApply" ? "转单学习自动应用" : "路由灰度观察"} → ${w().learning[key] ? "关闭" : "开启"}`,
      "learning.save",
      { ...w().learning, [key]: !w().learning[key] },
    );
  }
  if (b.dataset.whitelistRemove) {
    const member = b.dataset.kind === "member";
    confirmConnectionCommand(
      "移除白名单授权",
      `移除${member ? "人员" : "群"} ${b.dataset.whitelistRemove}。${member ? "" : "对应的主动推送配置也会移除。"}`,
      member ? "member.remove" : "group.remove",
      {
        accountId: state.agent,
        [member ? "userId" : "chatId"]: b.dataset.whitelistRemove,
      },
    );
  }
  if (b.dataset.message) {
    const m = connections().messages.find((m) => m.id === b.dataset.message);
    if (!m) return;
    modal(
      "消息详情",
      `<div class="modal-summary">消息 ID：${esc(m.id)}<br>会话：${esc(m.contact)}<br>chat_id：${esc(m.chatId)}<br>状态：${pages.messageStatuses[m.status]}<br>时间：${fmt(m.at)}</div><p class="message-text">${esc(m.content)}</p>${m.error ? `<div class="note-band">${esc(m.error)}</div>` : ""}${m.ticketId ? `<button type="button" class="button" data-ticket="${esc(m.ticketId)}">查看工单 ${esc(m.ticketId)}</button>` : ""}`,
    );
  }
  if (b.dataset.reportSelect) {
    const library =
      document.querySelector<HTMLDetailsElement>(".report-library");
    if (library) library.open = false;
    state.report = b.dataset.reportSelect;
    renderContent();
    renderAssistant();
  }
  if (b.dataset.advice) {
    const report = w().reports.find((r) => r.id === b.dataset.report)!,
      advice = report.advice.find((a) => a.id === b.dataset.advice)!;
    if (advice.status === "following")
      confirmCommand("完成建议跟进", advice.title, "advice.update", {
        id: advice.id,
        reportId: report.id,
        status: "done",
      });
    else
      modal(
        "安排建议跟进",
        `<p>${esc(advice.title)}</p><label>负责人<select name="ownerId">${options(w().people)}</select></label>` +
          field("复盘日期", "reviewAt", state.boot.today, "date", "required"),
        {
          label: "确认跟进",
          run: async (form) => {
            await command("advice.update", {
              ...formData(form),
              id: advice.id,
              reportId: report.id,
              status: "following",
            });
            closeModal();
            toast("跟进安排已保存");
          },
        },
      );
  }
  const actions: Record<string, () => unknown> = {
    "remote-analytics-overview": () => queryAnalytics(),
    "remote-analytics-trends": () => queryAnalytics("trends"),
    "remote-analytics-staff": () => queryAnalytics("staff"),
    "remote-report": queryReport,
    "roster-rules": showScheduleRules,
    "roster-today": () => editRoster(),
    "roster-import": () => editRoster(true),
    "add-account": () => editAccount(),
    "refresh-connections": () => refreshConnections(),
    "add-route": () => editRoute(),
    "add-person": () => editPerson(),
    parameters: editParameters,
    plans: showPlans,
    "add-plan": () => editPlan(),
    analyze,
    credentials: () => {
      state.tab = "connection";
      navigate("settings");
    },
    roster: () => {
      state.tab = "roster";
      navigate("settings");
    },
    reset: () => {
      state.query = "";
      state.status = "";
      state.group = "";
      state.tier = "";
      state.listPage = 1;
      renderContent();
    },
    export: () => {
      const m = state.metrics!,
        content = `千蜂智服运营简报\n客户：${w().tenant.name}\n数据模式：${state.boot!.mode}\n范围：${m.trend[0]?.date} — ${m.trend.at(-1)?.date}\n新建：${m.created}\n闭环：${m.closed}\n当前待闭环：${m.open}\n`;
      const url = URL.createObjectURL(
          new Blob([content], { type: "text/plain;charset=utf-8" }),
        ),
        link = document.createElement("a");
      link.href = url;
      link.download = "运营简报.txt";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
  };
  if (a) await actions[a]?.();
}
document.addEventListener("click", (e) => {
  void handleClick(e).catch((error) =>
    toast(error instanceof Error ? error.message : "操作失败"),
  );
});
let composingSearch = false;
function updateSearch(input: HTMLInputElement) {
  if (input.id !== "search" || state.query === input.value) return;
  const start = input.selectionStart,
    end = input.selectionEnd;
  state.query = input.value;
  state.listPage = 1;
  renderContent();
  const next = document.querySelector<HTMLInputElement>("#search");
  next?.focus({ preventScroll: true });
  next?.setSelectionRange(start, end);
}
document.addEventListener("compositionstart", (e) => {
  if ((e.target as HTMLInputElement).id === "search") composingSearch = true;
});
document.addEventListener("compositionend", (e) => {
  composingSearch = false;
  updateSearch(e.target as HTMLInputElement);
});
document.addEventListener("input", (e) => {
  if (!composingSearch && !(e as InputEvent).isComposing)
    updateSearch(e.target as HTMLInputElement);
});
document.addEventListener("change", (e) => {
  const input = e.target as HTMLInputElement;
  if (input.dataset.pageSize) {
    const size = Number(input.value),
      scope = input.dataset.pageSize;
    if (![20, 30].includes(size)) return;
    if (scope === "whitelist") {
      state.whitelistPageSize = size;
      state.extraPages.whitelist = 1;
    } else {
      state.pageSize = size;
      state.listPage = 1;
      state.extraPages = { whitelist: state.extraPages.whitelist || 1 };
    }
    renderContent();
    renderPaging(scope);
    return;
  }
  if (input.id === "notification-group" || input.id === "notification-scope") {
    if (input.id === "notification-group")
      state.notificationGroup = input.value;
    else state.notificationScope = input.value as "default" | "today";
    renderContent();
    document.getElementById(input.id)?.focus({ preventScroll: true });
    return;
  }
  if (input.id === "whitelist-account") {
    state.agent = input.value;
    state.extraPages.whitelist = 1;
    renderContent();
    document
      .querySelector<HTMLElement>("#whitelist-account")
      ?.focus({ preventScroll: true });
    return;
  }
  if (input.dataset.filter) {
    const key = input.dataset.filter as
      "account" | "status" | "direction" | "messageType" | "group" | "tier";
    state[key] = input.value;
    state.listPage = 1;
    renderContent();
    document
      .querySelector<HTMLElement>(`[data-filter="${key}"]`)
      ?.focus({ preventScroll: true });
  }
  if (input.id === "message-auto") {
    messageAuto = input.checked;
    syncRefresh();
  }
});
document.addEventListener("submit", (e) => {
  const form = e.target as HTMLFormElement;
  if (form.id === "whitelist-form") {
    e.preventDefault();
    const d = formData(form);
    confirmConnectionCommand(
      "确认加入白名单",
      `${d.name || "未命名对象"} · ${d.chatId || d.userId}`,
      form.dataset.kind === "member" ? "member.add" : "group.add",
      { ...d, accountId: form.dataset.accountId },
    );
  }
  if (form.id === "credential-form") {
    e.preventDefault();
    const d = formData(form);
    if (!Object.values(d).some((v) => v.trim())) {
      toast("请填写需要更新的凭据");
      return;
    }
    const submit = form.querySelector<HTMLButtonElement>(
      'button[type="submit"]',
    )!;
    if (submit.disabled) return;
    const identity = state.boot!.actor.id + ":" + state.boot!.actor.tenantId;
    submit.disabled = true;
    submit.textContent = "正在保存…";
    void post<QiweSaveResult>("/qiwe/connection", {
      ...d,
      expectedRevision: Number(form.dataset.revision),
    })
      .then(({ workspaceRevision, auditEntry, ...qiwe }) => {
        if (
          !state.boot ||
          state.boot.actor.id + ":" + state.boot.actor.tenantId !== identity
        )
          return;
        state.boot.qiwe = qiwe;
        if (state.boot.mode === "local" && workspaceRevision !== null)
          state.boot.workspace.revision = workspaceRevision;
        state.boot.workspace.audit = [
          auditEntry,
          ...state.boot.workspace.audit.filter((a) => a.id !== auditEntry.id),
        ].slice(0, 2000);
        form.reset();
        if (state.page === "settings" && state.tab === "connection")
          renderContent();
        toast("QiWe 凭据已保存");
      })
      .catch((error) =>
        toast(error instanceof Error ? error.message : "保存失败，请重试"),
      )
      .finally(() => {
        Object.keys(d).forEach((key) => (d[key] = ""));
        submit.disabled = false;
        submit.textContent = "保存配置";
      });
  }
});
function syncRefresh() {
  clearInterval(refreshTimer);
  if (messageAuto && state.page === "messages")
    refreshTimer = window.setInterval(() => {
      if (!document.querySelector<HTMLDialogElement>("#modal")!.open)
        void refreshConnections().catch(() =>
          toast("消息记录刷新失败，请稍后重试"),
        );
    }, 15000);
}
window.addEventListener("hashchange", () => {
  assistantPageChanged();
  state.query = "";
  state.status = "";
  state.group = "";
  state.tier = "";
  state.listPage = 1;
  state.extraPages = {};
  state.page = location.hash.slice(1) || "insights";
  document.body.classList.remove("nav-open");
  closeModal();
  showLoadedPage();
  syncRefresh();
  window.scrollTo(0, 0);
});
window.addEventListener("connections-updated", () => {
  if (!state.boot) return;
  if (
    ["accounts", "agent", "messages"].includes(state.page) ||
    (state.page === "settings" && state.tab === "audit")
  )
    renderContent();
});
window.addEventListener("data-updated", () => {
  ++loadSequence;
  loadController?.abort();
  pendingLoad = undefined;
  if (!state.boot) return;
  loadMetrics();
  renderContent();
  renderAssistant();
  syncPhase = "synced";
  syncSchedule.reset();
  syncStatus();
});
window.addEventListener("session-expired", () => {
  clearInterval(refreshTimer);
  login();
});
void load();

let analysisChanged = false;
window.setInterval(async () => {
  analysisChanged = (await pollAnalysisTasks()) || analysisChanged;
  if (
    analysisChanged &&
    state.boot &&
    state.page === "insights" &&
    !document.querySelector<HTMLDialogElement>("#modal")?.open
  ) {
    renderContent();
    analysisChanged = false;
  }
}, 2000);

document.addEventListener("reset", (e) => {
  const form = e.target as HTMLFormElement;
  if (form.id === "credential-form") resetQiweSecrets(form);
});
