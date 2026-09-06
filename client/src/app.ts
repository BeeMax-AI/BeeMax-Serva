import type { Metrics } from "../../shared/domain.js";
import {
  state,
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
  refresh,
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
let loadSequence = 0,
  messageAuto = false,
  refreshTimer: number;
function login() {
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
    `<aside class="sidebar"><a class="brand" href="#overview" aria-label="千蜂智服首页"><img class="brand-mark" src="/assets/beemax-logo-mark.svg" alt=""><img class="brand-name" src="/assets/beemax-wordmark-white.svg" alt="千蜂AI"></a><div class="workspace"><div><strong>千蜂智服</strong><small>AI 服务运营平台</small></div></div><div class="nav-label">AI 工作区</div><nav id="navigation">${navs.map(([id, i, name]) => `${id === "overview" ? '<div class="nav-separator"></div><div class="nav-label">工作空间</div>' : id === "accounts" ? '<div class="nav-separator"></div><div class="nav-label">连接管理</div>' : ""}<a href="#${id}" class="nav-item ${id === state.page || (id === "accounts" && state.page === "agent") ? "active" : ""} ${id === "insights" ? "ai-nav-item" : ""}" ${id === state.page ? 'aria-current="page"' : ""}>${icon(i)}<span>${name}</span></a>`).join("")}</nav><div class="sidebar-bottom"><div class="demo-status"><span></span>${state.boot!.mode === "local" ? "本地开发数据" : "MCP 数据源"}</div><div class="profile"><span class="avatar inverse">${esc(a.name[0])}</span><div>${esc(a.name)}<small>${esc(a.role)} · ${esc(w().tenant.name)}</small></div><button class="icon-button" data-action="logout" aria-label="退出登录">${icon("arrow")}</button></div></div></aside><div class="shell"><header class="topbar"><div class="breadcrumb"><button class="icon-button mobile-menu" data-action="nav" aria-label="打开导航">☰</button><span>工作空间</span><span>/</span><strong id="crumb">${state.page === "agent" ? "企微账号 / Agent 详情" : navs.find((n) => n[0] === state.page)?.[2] || ""}</strong></div><div class="top-actions"><span class="demo-label">${state.boot!.mode === "local" ? "本地模式 · MCP 待接入" : "MCP 模式"}</span><button class="icon-button" data-action="refresh" aria-label="刷新页面">${icon("refresh")}</button></div></header><main id="content"></main><footer class="page-footer"><span>BeeMax AI · 让每一件事，都有回应</span><span>${esc(w().tenant.name)} · UTC+8</span></footer></div>`;
}
function renderContent() {
  if (!state.boot) return;
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
  const auto = document.querySelector<HTMLInputElement>("#message-auto");
  if (auto) auto.checked = messageAuto;
}
async function loadMetrics() {
  const end = state.boot!.today,
    start = offsetDate(
      end,
      state.period === "day" ? 0 : state.period === "month" ? -29 : -6,
    );
  state.metrics = await api<Metrics>(`/metrics?start=${start}&end=${end}`);
}
async function load() {
  const seq = ++loadSequence;
  try {
    await refresh();
    await loadMetrics();
    if (seq !== loadSequence) return;
    state.page = location.hash.slice(1) || "insights";
    if (!navs.some((n) => n[0] === state.page) && state.page !== "agent")
      state.page = "overview";
    renderShell();
    renderContent();
    renderAssistant();
  } catch (error) {
    if (!state.boot) {
      if (error instanceof Error && error.message === "请登录后继续") {
        login();
        return;
      }
      document.querySelector("#app")!.innerHTML =
        `<main class="loading-screen"><h1>暂时无法加载工作空间</h1><p>${esc(error instanceof Error ? error.message : "连接失败")}</p>${button("重试", "refresh")}</main>`;
    } else toast(error instanceof Error ? error.message : "加载失败");
  }
}
function navigate(page: string) {
  if (location.hash === "#" + page) {
    state.page = page;
    renderShell();
    renderContent();
    renderAssistant();
  } else location.hash = page;
}
async function handleClick(e: MouseEvent) {
  const b = (e.target as Element).closest<HTMLButtonElement>("button");
  if (!b || b.disabled) return;
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
    await load();
    toast("已从后端刷新数据");
    return;
  }
  if (!state.boot) return;
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
    renderContent();
    return;
  }
  if (b.dataset.period) {
    state.period = b.dataset.period;
    await loadMetrics();
    renderContent();
    return;
  }
  if (b.dataset.agent) {
    state.agent = b.dataset.agent;
    navigate("agent");
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
    confirmCommand("删除路由规则", "删除后不再使用此规则。", "route.delete", {
      id: b.dataset.deleteRoute,
    });
  if (b.dataset.person) editPerson(b.dataset.person);
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
  if (b.dataset.removeGroup)
    confirmCommand(
      "移除主动推送授权",
      `将移除群 ${b.dataset.removeGroup} 的主动推送权限，保留历史消息。`,
      "group.remove",
      { accountId: state.agent, chatId: b.dataset.removeGroup },
    );
  if (b.dataset.message) {
    const m = w().messages.find((m) => m.id === b.dataset.message)!;
    modal(
      "消息详情",
      `<div class="modal-summary">消息 ID：${esc(m.id)}<br>会话：${esc(m.contact)}<br>chat_id：${esc(m.chatId)}<br>状态：${pages.messageStatuses[m.status]}<br>时间：${fmt(m.at)}</div><p class="message-text">${esc(m.content)}</p>${m.error ? `<div class="note-band">${esc(m.error)}</div>` : ""}${m.ticketId ? `<button type="button" class="button" data-ticket="${esc(m.ticketId)}">查看工单 ${esc(m.ticketId)}</button>` : ""}`,
    );
  }
  if (b.dataset.reportSelect) {
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
    "add-account": () => editAccount(),
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
      state.listPage = 1;
      renderContent();
    },
    prev: () => {
      state.listPage--;
      renderContent();
    },
    next: () => {
      state.listPage++;
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
  if (a) actions[a]?.();
}
document.addEventListener("click", (e) => {
  void handleClick(e).catch((error) =>
    toast(error instanceof Error ? error.message : "操作失败"),
  );
});
document.addEventListener("input", (e) => {
  const input = e.target as HTMLInputElement;
  if (input.id === "search") {
    const pos = input.selectionStart;
    state.query = input.value;
    state.listPage = 1;
    renderContent();
    const next = document.querySelector<HTMLInputElement>("#search")!;
    next.focus();
    next.setSelectionRange(pos, pos);
  }
});
document.addEventListener("change", (e) => {
  const input = e.target as HTMLInputElement;
  if (input.dataset.filter) {
    const key = input.dataset.filter as
      "account" | "status" | "direction" | "messageType" | "group";
    state[key] = input.value;
    state.listPage = 1;
    renderContent();
  }
  if (input.id === "show-secrets")
    document
      .querySelectorAll<HTMLInputElement>(
        '#credential-form input[name="token"],#credential-form input[name="password"]',
      )
      .forEach((el) => (el.type = input.checked ? "text" : "password"));
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
    confirmCommand(
      "确认添加授权群",
      `${d.name || "未命名群"} · ${d.chatId}`,
      "group.add",
      { ...d, accountId: state.agent },
    );
  }
  if (form.id === "credential-form") {
    e.preventDefault();
    const d = formData(form);
    if (!Object.values(d).some((v) => v.trim())) {
      toast("请填写需要更新的凭据");
      return;
    }
    modal(
      "确认保存连接凭据",
      "<p>凭据将在后端加密保存，留空字段保留现有值。</p>",
      {
        label: "确认保存",
        run: async () => {
          await command("credentials.save", d);
          form.reset();
          Object.keys(d).forEach((k) => (d[k] = ""));
          closeModal();
          toast("凭据已保存，未记录明文内容");
        },
      },
    );
  }
});
function syncRefresh() {
  clearInterval(refreshTimer);
  if (messageAuto && state.page === "messages")
    refreshTimer = window.setInterval(() => {
      if (!document.querySelector<HTMLDialogElement>("#modal")!.open)
        void load();
    }, 15000);
}
window.addEventListener("hashchange", () => {
  assistantPageChanged();
  state.query = "";
  state.status = "";
  state.group = "";
  state.listPage = 1;
  state.page = location.hash.slice(1) || "insights";
  document.body.classList.remove("nav-open");
  closeModal();
  void load();
  syncRefresh();
  window.scrollTo(0, 0);
});
window.addEventListener("data-updated", () => {
  void loadMetrics()
    .then(() => {
      renderContent();
      renderAssistant();
    })
    .catch((e) => toast(e.message));
});
window.addEventListener("session-expired", () => {
  clearInterval(refreshTimer);
  login();
});
void load();
