import { renderMarkdown } from "../../shared/markdown.js";
import type { Conversation } from "../../shared/domain.js";
import { state, w, esc, icon, fmt, post, toast } from "./core.js";
let generation = 0,
  pinnedTicket = "";
const readings = new Map<string, { top: number; bottom: boolean }>(),
  drafts = new Map<string, string>();
let lastAttempt: { fingerprint: string; requestId: string } | undefined;
let opened = false,
  expanded = false,
  contextEnabled = true,
  currentId = "",
  draft = "",
  pending = false,
  controller: AbortController | null = null;
type Frame = { left: number; top: number; width: number; height: number };
let frame: Frame | null = null,
  compactFrame: Frame | null = null,
  expandedFrame: Frame | null = null;
function selectedChatReport() {
  const report =
    w().reports.find((r) => r.id === state.report) || w().reports[0];
  return state.boot?.aiCapabilities?.channel === "mcp" &&
    report?.source !== "mcp"
    ? undefined
    : report;
}
const root = () => document.querySelector<HTMLElement>("#assistant-root")!;
export function resetAssistant() {
  generation++;
  activeTurn = undefined;
  lastAttempt = undefined;
  window.clearInterval(elapsedTimer);
  pinnedTicket = "";
  readings.clear();
  drafts.clear();
  opened = false;
  currentId = "";
  draft = "";
  pending = false;
  controller?.abort();
  frame = null;
  compactFrame = null;
  expandedFrame = null;
  renderAssistant();
}
type ChatTurn = {
  requestId?: string;
  conversationId: string;
  question: string;
  startedAt: number;
  endedAt?: number;
  status: "pending" | "failed" | "stopped";
  error?: string;
};
let activeTurn: ChatTurn | undefined;
let elapsedTimer: number | undefined;
let clockFormat: Intl.DateTimeFormat | undefined,
  clockZone = "";
function chatTime(at: string | number) {
  if (!Number.isFinite(new Date(at).getTime())) return "—";
  const zone = w().tenant.timezone;
  if (!clockFormat || clockZone !== zone) {
    clockZone = zone;
    clockFormat = new Intl.DateTimeFormat("zh-CN", {
      timeZone: zone,
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
  }
  return clockFormat.format(new Date(at));
}
function elapsed(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return seconds < 60
    ? `${seconds} 秒`
    : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}
function contextName(m: Conversation["messages"][number]) {
  if (m.context?.reportId)
    return (
      w().reports.find((r) => r.id === m.context!.reportId)?.name || "分析报告"
    );
  if (m.context?.ticketId) return `工单 ${m.context.ticketId}`;
  return (
    (
      {
        overview: "运营总览",
        insights: "AI智能分析",
        tickets: "工单管理 · 工单明细",
        trends: "工单管理 · 工单趋势",
        staff: "人员与负载 · 人员负载",
        "staff-roster": "人员与负载 · 排班人员",
        settings: "配置管理",
        accounts: "企微账号",
        messages: "消息日志",
      } as Record<string, string>
    )[m.context?.page || ""] || ""
  );
}
function messageView(m: Conversation["messages"][number]) {
  const isUser = m.role === "user",
    context = contextName(m);
  return `<div class="${isUser ? "chat-user" : "chat-reply"}"><div><div class="chat-message-heading"><strong>${isUser ? "我" : "AI助手"}</strong><span class="chat-message-status">${isUser ? "已发送" : "已完成"}</span><time datetime="${esc(m.at)}">${chatTime(m.at)}</time></div>${isUser ? `<p class="message-text">${esc(m.text)}</p>` : `<div class="message-text chat-markdown">${renderMarkdown(m.text)}</div>`}${m.coverage || m.references?.length ? `<details class="chat-sources"><summary>数据来源与范围</summary>${m.coverage ? `<p>${esc(m.coverage)}</p>` : ""}${m.references?.length ? `<p>${m.references.map((r) => esc(r)).join("；")}</p>` : ""}</details>` : ""}${m.ticketIds?.map((id) => `<button class="button" data-ticket="${esc(id)}">${esc(id)} →</button>`).join("") || ""}${context || m.durationMs !== undefined ? `<div class="chat-message-meta">${context ? `<span>${esc(context)}</span>` : ""}${m.durationMs !== undefined ? `<span>耗时 ${elapsed(m.durationMs)}</span>` : ""}</div>` : ""}</div></div>`;
}
function turnView() {
  if (!activeTurn || activeTurn.conversationId !== currentId) return "";
  const turn = activeTurn,
    waiting = turn.status === "pending";
  return `<div class="chat-user"><div><div class="chat-message-heading"><strong>我</strong><span class="chat-message-status">已提交请求</span><time>${chatTime(turn.startedAt)}</time></div><p class="message-text">${esc(turn.question)}</p></div></div><div class="chat-request-state" role="status" data-status="${turn.status}"><div><span class="chat-state-dot" aria-hidden="true"></span><strong>${waiting ? "正在等待 AI 回复" : turn.status === "failed" ? "回复失败" : "已停止等待"}</strong><span data-chat-elapsed>${elapsed((turn.endedAt || Date.now()) - turn.startedAt)}</span></div><p>${waiting ? "请求已提交，可继续使用其他页面。" : esc(turn.error || "")}</p><small>${waiting ? "开始于" : "结束于"} ${chatTime(turn.endedAt || turn.startedAt)}</small></div>`;
}
function syncElapsedTimer() {
  window.clearInterval(elapsedTimer);
  if (!pending || !opened || !activeTurn) return;
  elapsedTimer = window.setInterval(() => {
    const timer = root().querySelector<HTMLElement>("[data-chat-elapsed]");
    if (timer && activeTurn)
      timer.textContent = elapsed(Date.now() - activeTurn.startedAt);
  }, 1000);
}
export function renderAssistant() {
  if (!state.boot) {
    root().innerHTML = "";
    return;
  }
  if (!pending && activeTurn?.requestId) {
    const recovered = state.boot.conversations.find((c) =>
      c.messages.some(
        (m) => m.role === "user" && m.requestId === activeTurn!.requestId,
      ),
    );
    if (recovered) {
      if (currentId === activeTurn.conversationId) {
        currentId = recovered.id;
        if (draft === activeTurn.question) draft = "";
      }
      activeTurn = undefined;
      lastAttempt = undefined;
    }
  }
  const host = root().querySelector<HTMLElement>("#assistant-widget"),
    scroll = root().querySelector(".chat-messages") as HTMLElement | null;
  if (host && scroll)
    readings.set(host.dataset.readingKey!, {
      top: scroll.scrollTop,
      bottom: scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 50,
    });
  const readingKey = currentId + ":" + (expanded ? "expanded" : "compact"),
    reading = readings.get(readingKey),
    current = state.boot.conversations.find((c) => c.id === currentId);
  root().innerHTML = opened
    ? `<aside id="assistant-widget" data-reading-key="${esc(readingKey)}" class="assistant-widget ${expanded ? "assistant-expanded" : ""}" role="dialog" aria-modal="false" aria-label="AI助手"><div class="assistant-widget-head"><div><img src="/assets/beemax-logo-mark.svg" alt=""><div><strong>AI助手</strong><small>查询数据，继续手头的工作</small></div></div><div><button class="icon-button" data-chat-new aria-label="新对话" ${pending ? "disabled" : ""}>${icon("plus")}</button><button class="icon-button" data-chat-expand aria-label="${expanded ? "还原" : "放大"}AI助手">${icon("expand")}</button><button class="icon-button" data-chat-close aria-label="收起AI助手">${icon("close")}</button></div></div><div class="assistant-page-context"><span>当前上下文：<strong>${contextEnabled ? esc(pinnedTicket ? `工单 ${pinnedTicket}` : state.page === "insights" ? selectedChatReport()?.name || "AI智能分析" : document.querySelector("#crumb")?.textContent || "工作空间") : "不引用当前页面"}</strong></span><button class="text-link" data-chat-context>${contextEnabled ? "清除" : "引用"}</button></div><div class="chat-history-select"><label>对话记录<select id="chat-history" ${pending ? "disabled" : ""}><option value="">新对话</option>${state.boot.conversations.map((c) => `<option value="${c.id}" ${c.id === currentId ? "selected" : ""}>${esc(c.title)}</option>`).join("")}</select></label></div><div class="chat-messages" role="log" aria-label="对话记录" aria-live="polite">${current?.messages.length || activeTurn?.conversationId === currentId ? (current?.messages || []).map(messageView).join("") : `<div class="widget-welcome"><h2>需要我帮你查什么？</h2><p>${w().integration ? "查询工单、处理人与运营汇总。" : "查询工单、人员、账号与运营汇总。"}</p><button class="button" data-chat-prompt="今天有哪些工单？">看看当前工单 →</button></div>`}${turnView()}</div><form id="chat-form" class="chat-composer"><label class="visually-hidden" for="chat-input">向AI助手提问</label><textarea id="chat-input" maxlength="2000" rows="2" placeholder="输入问题，或继续追问…">${esc(draft)}</textarea><div class="composer-controls"><span>Enter 发送 · Shift + Enter 换行</span>${pending ? '<button type="button" class="button" data-chat-stop>停止等待</button>' : `<button class="button primary" ${draft.trim() ? "" : "disabled"} id="chat-send">发送 →</button>`}</div></form><div class="chat-disclosure">${(state.boot.aiCapabilities?.chat ?? state.boot.aiConfigured) ? (state.boot.aiCapabilities?.channel === "mcp" ? "MCP · AI助手已接入" : "模型已配置") : "模型待配置 · 数据查询模式"} · 操作需确认</div>${["n", "s", "e", "w", "ne", "nw", "se", "sw"].map((dir) => `<button class="assistant-resize-handle resize-${dir}" data-resize="${dir}" aria-label="调整助手${dir}方向大小" title="拖动调整大小" ${dir === "se" ? "" : 'tabindex="-1"'}></button>`).join("")}</aside>`
    : `<button class="assistant-launcher" data-chat-open aria-label="打开AI助手">${icon("chat")}AI助手</button>`;
  applyFrame();
  syncElapsedTimer();
  const next = root().querySelector<HTMLElement>(".chat-messages");
  if (next)
    next.scrollTop =
      !reading || reading.bottom ? next.scrollHeight : reading.top;
}
function clamp(f: NonNullable<typeof frame>) {
  const width = Math.min(
      Math.max(Math.min(340, innerWidth - 16), f.width),
      innerWidth - 16,
    ),
    height = Math.min(
      Math.max(Math.min(440, innerHeight - 16), f.height),
      innerHeight - 16,
    );
  return {
    width,
    height,
    left: Math.min(Math.max(8, f.left), innerWidth - width - 8),
    top: Math.min(Math.max(8, f.top), innerHeight - height - 8),
  };
}
function applyFrame() {
  const host = root().querySelector<HTMLElement>("#assistant-widget");
  if (!host || !frame) return;
  frame = clamp(frame);
  Object.assign(host.style, {
    left: frame.left + "px",
    top: frame.top + "px",
    width: frame.width + "px",
    height: frame.height + "px",
    right: "auto",
    bottom: "auto",
    transform: "none",
    maxHeight: "none",
  });
}
export function askAboutTicket(id: string) {
  pinnedTicket = id;
  contextEnabled = true;
  opened = true;
  draft = "这单现在是什么状态？";
  renderAssistant();
}
export function assistantPageChanged() {
  pinnedTicket = "";
}
export function closeAssistant() {
  opened = false;
  renderAssistant();
}
async function submit() {
  if (pending || !draft.trim()) return;
  const question = draft,
    turn = ++generation;
  draft = "";
  pending = true;
  activeTurn = {
    conversationId: currentId,
    question,
    startedAt: Date.now(),
    status: "pending",
  };
  controller = new AbortController();
  renderAssistant();
  try {
    const context = contextEnabled
      ? {
          page: state.page,
          ...(pinnedTicket ? { ticketId: pinnedTicket } : {}),
          ...(state.page === "insights" && selectedChatReport()
            ? { reportId: selectedChatReport()!.id }
            : {}),
        }
      : undefined;
    const fingerprint = JSON.stringify([
      state.boot!.actor.tenantId,
      state.boot!.actor.id,
      currentId,
      question,
      context,
    ]);
    if (lastAttempt?.fingerprint !== fingerprint)
      lastAttempt = { fingerprint, requestId: crypto.randomUUID() };
    activeTurn!.requestId = lastAttempt.requestId;
    const result = await post<Conversation>(
      "/chat",
      {
        question,
        requestId: lastAttempt.requestId,
        ...(currentId ? { conversationId: currentId } : {}),
        context,
      },
      controller.signal,
    );
    if (turn !== generation || !state.boot) return;
    const i = state.boot.conversations.findIndex((c) => c.id === result.id);
    if (i < 0) state.boot.conversations.unshift(result);
    else state.boot.conversations[i] = result;
    currentId = result.id;
    lastAttempt = undefined;
    activeTurn = undefined;
  } catch (error) {
    if (turn !== generation) return;
    if (!draft) draft = question;
    if (activeTurn) {
      activeTurn.endedAt = Date.now();
      activeTurn.status =
        error instanceof Error && error.name === "AbortError"
          ? "stopped"
          : "failed";
      activeTurn.error =
        activeTurn.status === "stopped"
          ? "仅停止等待，服务端可能继续处理；可刷新对话查看结果。"
          : (error instanceof Error ? error.message : "服务暂时不可用") +
            "，问题已保留，可重新发送。";
    }
    if (error instanceof Error && error.name === "AbortError")
      toast("已停止等待；服务端可能仍会保存结果，可刷新对话查看。");
    else toast(error instanceof Error ? error.message : "查询失败，草稿已保留");
  } finally {
    if (turn === generation) {
      pending = false;
      renderAssistant();
    }
  }
}
root().addEventListener("click", (e) => {
  const b = (e.target as Element).closest<HTMLButtonElement>("button");
  if (!b) return;
  if (b.hasAttribute("data-chat-open")) {
    opened = true;
    renderAssistant();
  }
  if (b.hasAttribute("data-chat-close")) closeAssistant();
  if (b.hasAttribute("data-chat-new") && !pending) {
    activeTurn = undefined;
    lastAttempt = undefined;
    drafts.set(currentId, draft);
    currentId = "";
    draft = "";
    renderAssistant();
  }
  if (b.hasAttribute("data-chat-context")) {
    contextEnabled = !contextEnabled;
    renderAssistant();
  }
  if (b.hasAttribute("data-chat-expand")) {
    if (expanded) expandedFrame = frame;
    else compactFrame = frame;
    expanded = !expanded;
    frame = expanded ? expandedFrame : compactFrame;
    renderAssistant();
  }
  if (b.dataset.chatPrompt) {
    draft = b.dataset.chatPrompt;
    void submit();
  }
  if (b.hasAttribute("data-chat-stop")) controller?.abort();
});
root().addEventListener("input", (e) => {
  const target = e.target as HTMLTextAreaElement;
  if (target.id === "chat-input") {
    draft = target.value;
    const b = root().querySelector<HTMLButtonElement>("#chat-send");
    if (b) b.disabled = !draft.trim();
  }
});
root().addEventListener("change", (e) => {
  const target = e.target as HTMLSelectElement;
  if (target.id === "chat-history") {
    drafts.set(currentId, draft);
    currentId = target.value;
    draft = drafts.get(currentId) || "";
    renderAssistant();
  }
});
root().addEventListener("submit", (e) => {
  if ((e.target as Element).id === "chat-form") {
    e.preventDefault();
    void submit();
  }
});
root().addEventListener("keydown", (e) => {
  if (
    (e.target as Element).id === "chat-input" &&
    e.key === "Enter" &&
    !e.shiftKey &&
    !e.isComposing
  ) {
    e.preventDefault();
    void submit();
  }
  const handle = (e.target as Element).closest<HTMLElement>("[data-resize]");
  if (handle && e.key.startsWith("Arrow")) {
    e.preventDefault();
    const r = root()
      .querySelector("#assistant-widget")!
      .getBoundingClientRect();
    frame = clamp({
      left: r.left,
      top: r.top,
      width: r.width + ({ ArrowLeft: -8, ArrowRight: 8 }[e.key] || 0),
      height: r.height + ({ ArrowUp: -8, ArrowDown: 8 }[e.key] || 0),
    });
    applyFrame();
  }
});
root().addEventListener("pointerdown", (e) => {
  const h = (e.target as Element).closest<HTMLElement>("[data-resize]");
  if (!h) return;
  e.preventDefault();
  const r = root().querySelector("#assistant-widget")!.getBoundingClientRect(),
    start = { x: e.clientX, y: e.clientY },
    dir = h.dataset.resize!;
  h.setPointerCapture(e.pointerId);
  const move = (ev: PointerEvent) => {
    const dx = ev.clientX - start.x,
      dy = ev.clientY - start.y,
      minW = Math.min(340, innerWidth - 16),
      minH = Math.min(440, innerHeight - 16);
    let left = r.left,
      top = r.top,
      width = r.width,
      height = r.height;
    if (dir.includes("e"))
      width = Math.max(minW, Math.min(r.width + dx, innerWidth - r.left - 8));
    if (dir.includes("s"))
      height = Math.max(minH, Math.min(r.height + dy, innerHeight - r.top - 8));
    if (dir.includes("w")) {
      left = Math.min(r.right - minW, Math.max(8, r.left + dx));
      width = r.right - left;
    }
    if (dir.includes("n")) {
      top = Math.min(r.bottom - minH, Math.max(8, r.top + dy));
      height = r.bottom - top;
    }
    frame = { left, top, width, height };
    applyFrame();
  };
  const end = () => {
    h.removeEventListener("pointermove", move);
    h.removeEventListener("pointerup", end);
    h.removeEventListener("pointercancel", end);
  };
  h.addEventListener("pointermove", move);
  h.addEventListener("pointerup", end);
  h.addEventListener("pointercancel", end);
});
window.addEventListener("resize", applyFrame);
