import { preserveConnections } from "./bootstrap-state.js";
import { pageWindow, pageSizes } from "../../shared/pagination.js";
import type { Bootstrap, Metrics, Ticket } from "../../shared/domain.js";
import { statuses } from "../../shared/domain.js";
export const state: {
  boot: Bootstrap | null;
  page: string;
  tab: string;
  account: string;
  agent: string;
  notificationGroup: string;
  notificationScope: "default" | "today";
  whitelistTab: "authorization" | "push" | "access";
  whitelistPageSize: number;
  whitelistKind: "groups" | "members";
  query: string;
  status: string;
  group: string;
  tier: string;
  direction: string;
  messageType: string;
  listPage: number;
  pageSize: number;
  extraPages: Record<string, number>;
  period: string;
  metrics: Metrics | null;
  report: string;
  date: string;
} = {
  boot: null,
  page: "insights",
  tab: "routing",
  account: "",
  agent: "",
  notificationGroup: "",
  notificationScope: "today",
  whitelistTab: "authorization",
  whitelistPageSize: 20,
  whitelistKind: "groups",
  query: "",
  status: "",
  group: "",
  tier: "",
  direction: "",
  messageType: "",
  listPage: 1,
  pageSize: 20,
  extraPages: {},
  period: "week",
  metrics: null,
  report: "",
  date: "",
};
export const w = () => state.boot!.workspace;
export const canWrite = (capability?: string) =>
  state.boot?.actor.role !== "viewer" &&
  (!capability ||
    !state.boot?.workspace.integration ||
    state.boot.workspace.integration.commands.includes(capability));
export const isOwner = () => state.boot?.actor.role === "owner";
export const esc = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
let formatTimezone = "";
let dateFormatter: Intl.DateTimeFormat;
export function fmt(v: string | null | undefined) {
  if (!v) return "—";
  const timezone = w().tenant.timezone;
  if (!dateFormatter || timezone !== formatTimezone) {
    formatTimezone = timezone;
    dateFormatter = new Intl.DateTimeFormat("zh-CN", {
      timeZone: timezone,
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }
  return dateFormatter.format(new Date(v));
}
export const dateOf = (v: string) =>
  new Date(Date.parse(v) + 8 * 3600000).toISOString().slice(0, 10);
export const offsetDate = (date: string, n: number) =>
  new Date(Date.parse(date + "T00:00:00Z") + n * 86400000)
    .toISOString()
    .slice(0, 10);
const paths: Record<string, string> = {
  overview:
    '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  trend: '<path d="M3 3v18h18M6 15l5-5 4 3 6-8"/>',
  ticket:
    '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 7h6M9 11h6M9 15h4"/>',
  staff:
    '<circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0112 0v3M16 4a3 3 0 010 6M18 13a5 5 0 013 5v3"/>',
  spark:
    '<path d="M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/>',
  settings:
    '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="16" cy="17" r="3"/>',
  chat: '<path d="M21 11a8 8 0 01-8 8H7l-5 3 2-6a9 9 0 1117-5Z"/><path d="M8 10h8M8 14h5"/>',
  plus: '<path d="M12 4v16M4 12h16"/>',
  close: '<path d="M6 6l12 12M6 18L18 6"/>',
  arrow: '<path d="M4 12h16M15 7l5 5-5 5"/>',
  expand: '<path d="M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="M15 15l6 6"/>',
  refresh:
    '<path d="M20 10a8 8 0 00-14-5L3 8m0-5v5h5M4 14a8 8 0 0014 5l3-3m0 5v-5h-5"/>',
};
export const icon = (name: string) =>
  `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none">${paths[name] || paths.ticket}</svg>`;
export const button = (
  label: string,
  action: string,
  primary = false,
  disabled = false,
) =>
  `<button class="button ${primary ? "primary" : ""}" data-action="${action}" ${disabled ? "disabled" : ""}>${label}</button>`;
export const tag = (text: string, blue = false) =>
  `<span class="status ${blue ? "blue" : "muted"}">${esc(text)}</span>`;
export const statusTag = (s: Ticket["status"]) =>
  tag(
    statuses[s],
    s.startsWith("ESCALATED_") ||
      ["NO_ACCEPT", "IN_PROGRESS", "ACCEPTED"].includes(s),
  );
export const groupName = (id: string) =>
  w().groups.find((g) => g.id === id)?.name || id;
export const personName = (id: string | null) =>
  w().people.find((p) => p.id === id)?.name || "待接单";
export const title = (name: string, description: string, actions = "") =>
  `<div class="page-heading"><div><div class="eyebrow">SERVICE / ${esc(state.page.toUpperCase())}</div><h1>${esc(name)}</h1><p>${esc(description)}</p></div><div class="heading-actions">${actions}</div></div>`;
export const rail = (items: [string, unknown, string][]) =>
  `<div class="connection-kpis">${items.map(([label, value, note]) => `<div><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(note)}</small></div>`).join("")}</div>`;
export const options = (
  rows: { id: string; name: string }[],
  selected = "",
  all?: string,
) =>
  `${all ? `<option value="">${esc(all)}</option>` : ""}${rows.map((r) => `<option value="${esc(r.id)}" ${r.id === selected ? "selected" : ""}>${esc(r.name)}</option>`).join("")}`;
export const empty = (message: string) =>
  `<div class="connection-empty">${esc(message)}</div>`;
export function table(headers: string[], rows: string[], className = "") {
  return `<div class="table-box"><table class="${className}"><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.length ? rows.join("") : `<tr><td colspan="${headers.length}">${empty("暂无匹配记录")}</td></tr>`}</tbody></table></div>`;
}
export function currentPage(scope = "main") {
  return scope === "main" ? state.listPage : state.extraPages[scope] || 1;
}
export function setPage(page: number, scope = "main") {
  if (scope === "main") state.listPage = page;
  else state.extraPages[scope] = page;
}
export function pager(count: number, size = state.pageSize, scope = "main") {
  const p = pageWindow(count, currentPage(scope), size);
  setPage(p.page, scope);
  return `<div class="connection-pagination" data-pagination="${esc(scope)}"><label class="page-size-control">每页<select data-page-size="${esc(scope)}" aria-label="每页记录数">${pageSizes.map((n) => `<option value="${n}" ${p.size === n ? "selected" : ""}>${n} 条</option>`).join("")}</select></label><span>共 ${count} 条 · ${count ? p.start + 1 : 0}–${p.end} 条 · 第 ${p.page} / ${p.pages} 页</span><div class="page-buttons"><button class="button" data-page-step="-1" data-page-scope="${esc(scope)}" ${p.page === 1 ? "disabled" : ""}>上一页</button><button class="button" data-page-step="1" data-page-scope="${esc(scope)}" ${p.page === p.pages ? "disabled" : ""}>下一页</button></div></div>`;
}
export function slicePage<T>(rows: T[], size = state.pageSize, scope = "main") {
  const p = pageWindow(rows.length, currentPage(scope), size);
  setPage(p.page, scope);
  return rows.slice(p.start, p.end);
}
let toastTimer: number;
export function toast(message: string) {
  const el = document.querySelector("#toast")!;
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove("show"), 5000);
}
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch("/api" + path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401 && path !== "/login")
      window.dispatchEvent(new Event("session-expired"));
    throw new ApiError(response.status, data.error?.message || "请求失败");
  }
  return data as T;
}
export const post = <T>(path: string, data: unknown, signal?: AbortSignal) =>
  api<T>(path, { method: "POST", body: JSON.stringify(data), signal });
export async function refresh() {
  const previous = state.boot;
  const incoming = await api<Bootstrap>("/bootstrap");
  if (
    previous &&
    (!state.boot ||
      previous.actor.id !== state.boot.actor.id ||
      previous.actor.tenantId !== state.boot.actor.tenantId)
  )
    return;
  preserveConnections(state.boot, incoming);
  state.boot = incoming;
  if (!state.date) state.date = state.boot.today;
}
export async function command(
  type: string,
  data: Record<string, unknown>,
  expectedRevision?: number,
) {
  const dialog = document.querySelector<HTMLDialogElement>("#modal");
  const revision =
    expectedRevision ??
    (dialog?.open ? Number(dialog.dataset.revision) : w().revision);
  await post("/commands", {
    type,
    data,
    expectedRevision: revision,
    requestId: crypto.randomUUID(),
  });
  await refresh();
  window.dispatchEvent(new Event("data-updated"));
}
let modalSequence = 0;
export function modal(
  heading: string,
  content: string,
  submit?: {
    label: string;
    run: (form: HTMLFormElement) => Promise<void> | void;
  },
) {
  const el = document.querySelector<HTMLDialogElement>("#modal")!;
  if (el.open) el.close();
  el.className = "";
  el.dataset.instance = String(++modalSequence);
  el.onchange = null;
  el.dataset.revision = String(state.boot?.workspace.revision || 0);
  el.innerHTML = `<form id="dialog-form"><h2>${esc(heading)}</h2>${content}<p class="form-error" role="alert"></p><div class="modal-actions"><button type="button" class="button" data-close-modal>${submit ? "取消" : "关闭"}</button>${submit ? `<button type="submit" class="button primary">${esc(submit.label)}</button>` : ""}</div></form>`;
  el.querySelector("[data-close-modal]")!.addEventListener("click", () =>
    el.close(),
  );
  if (submit)
    el.querySelector("form")!.onsubmit = async (e) => {
      e.preventDefault();
      const form = e.currentTarget as HTMLFormElement,
        b = form.querySelector<HTMLButtonElement>('[type="submit"]')!;
      b.disabled = true;
      try {
        await submit.run(form);
      } catch (error) {
        form.querySelector(".form-error")!.textContent =
          error instanceof Error ? error.message : "操作失败";
        if (error instanceof ApiError && error.status === 409) {
          await refresh();
          window.dispatchEvent(new Event("data-updated"));
        }
      } finally {
        b.disabled = false;
      }
    };
  el.showModal();
  return el;
}
export const closeModal = () =>
  document.querySelector<HTMLDialogElement>("#modal")!.close();
export const field = (
  label: string,
  name: string,
  value = "",
  type = "text",
  extra = "",
) =>
  `<label>${esc(label)}<input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
export const formData = (form: HTMLFormElement) =>
  Object.fromEntries(new FormData(form)) as Record<string, string>;
export function confirmCommand(
  name: string,
  description: string,
  type: string,
  data: Record<string, unknown>,
) {
  const current = document.querySelector<HTMLDialogElement>("#modal"),
    revision = current?.open ? Number(current.dataset.revision) : w().revision;
  modal(
    name,
    `<p>${esc(description)}</p><div class="note-band">${state.boot!.mode === "local" ? "将保存到本地开发数据，不发送外部通知。" : ["plan.save", "plan.delete", "advice.update"].includes(type) ? "将保存到工作台；分析数据来自 MCP。" : "操作将通过 MCP 执行，可能发送企微通知。"}操作人：${esc(state.boot!.actor.name)}</div>`,
    {
      label: "确认保存",
      run: async () => {
        await command(type, data, revision);
        closeModal();
        toast("已保存并记录变更");
      },
    },
  );
}
