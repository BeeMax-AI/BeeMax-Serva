import type { Account } from "../../shared/domain.js";
import { connections } from "./connections.js";
import { accessContent } from "./mcp.js";
import {
  state,
  esc,
  fmt,
  options,
  tag,
  empty,
  table,
  pager,
  slicePage,
  canWrite,
} from "./core.js";

const tabs = [
  ["authorization", "白名单授权"],
  ["push", "推送设置"],
  ["access", "访问权限"],
];
export function whitelistSection() {
  const accounts = connections().accounts;
  if (!accounts.some((a) => a.id === state.agent))
    state.agent = accounts.length === 1 ? accounts[0].id : "";
  const account = accounts.find((a) => a.id === state.agent);
  const header = `<section id="account-whitelist" class="account-whitelist" aria-label="白名单管理"><div class="config-title"><div><h2>白名单管理</h2><p>授权、推送与访问权限，在这里统一管理。</p></div><label class="whitelist-account">管理实例<select id="whitelist-account" aria-label="选择白名单管理实例" ${accounts.length ? "" : "disabled"}>${options(
    accounts.map((a) => ({
      id: a.id,
      name: `${a.name} · ${a.company} · ${a.id}`,
    })),
    state.agent,
    accounts.length ? "请选择实例" : "暂无账号实例",
  )}</select></label></div>`;
  const navigation = `<div class="tabbar" role="tablist" aria-label="白名单功能">${tabs.map(([id, name]) => `<button role="tab" data-whitelist-tab="${id}" aria-selected="${state.whitelistTab === id}" class="${state.whitelistTab === id ? "active" : ""}">${name}</button>`).join("")}</div>`;
  let content: string;
  if (state.whitelistTab === "access") {
    content = `<section class="panel"><div class="note-band"><strong>生效范围：整个渠道</strong> · 以下策略由 MCP 管理，影响对应渠道的所有账号，不只影响当前实例。实例白名单配置不会自动合并到渠道名单。</div>${accessContent("whitelist", state.whitelistPageSize)}</section>`;
  } else if (!account) {
    content = `<section class="panel">${empty(accounts.length ? "请选择上方的管理实例，再配置白名单与推送范围。" : "暂无账号实例，添加企微账号后即可配置群、人员和推送范围。")}</section>`;
  } else {
    content =
      state.whitelistTab === "push"
        ? pushContent(account)
        : authorizationContent(account);
  }
  return (
    header +
    (account
      ? `<p class="whitelist-scope">当前实例：${esc(account.name)} · ${esc(account.company)}<br>实例 ID：${esc(account.id)}</p>`
      : "") +
    navigation +
    content +
    "</section>"
  );
}
function authorizationContent(account: Account) {
  const member = state.whitelistKind === "members",
    label = member ? "人员" : "群";
  const entries = member ? account.members || [] : account.groups;
  return `<section class="panel"><div class="config-title"><div><h2>白名单授权</h2><p>维护当前实例的授权对象；通道接入后同步生效。</p></div>${tag(`${entries.length} 个已配置`)}</div>
    <div class="whitelist-types" role="tablist" aria-label="授权对象类型">${[
      ["groups", `群白名单 · ${account.groups.length}`],
      ["members", `人员白名单 · ${account.members?.length || 0}`],
    ]
      .map(
        ([id, name]) =>
          `<button class="button ${state.whitelistKind === id ? "primary" : ""}" role="tab" aria-selected="${state.whitelistKind === id}" data-whitelist-kind="${id}">${name}</button>`,
      )
      .join("")}</div>
    ${canWrite() ? `<form id="whitelist-form" class="whitelist-form" data-kind="${member ? "member" : "group"}" data-account-id="${esc(account.id)}"><label>${label} ID<input name="${member ? "userId" : "chatId"}" required maxlength="128" pattern="[a-zA-Z0-9_:\\-]+" placeholder="填写${member ? "人员唯一 ID" : "群 chat_id"}"></label><label>${label}名称（可选）<input name="name" maxlength="40" placeholder="填写名称，便于识别"></label><button class="button primary">加入白名单</button></form>` : `<div class="note-band">当前账号可查看白名单。</div>`}
    ${table(
      [`${label}名称`, `${label} ID`, "加入时间", "操作"],
      slicePage(entries, state.whitelistPageSize, "whitelist").map(
        (entry) =>
          `<tr><td>${esc(entry.name || `未命名${label}`)}</td><td class="whitelist-id">${esc(entry.id)}</td><td>${fmt(entry.addedAt)}</td><td><button class="text-link" data-whitelist-remove="${esc(entry.id)}" data-kind="${member ? "member" : "group"}" ${canWrite() ? "" : "disabled"}>移除</button></td></tr>`,
      ),
    )}${pager(entries.length, state.whitelistPageSize, "whitelist")}</section>`;
}
function pushContent(account: Account) {
  return `<section class="panel"><div class="config-title"><div><h2>推送设置</h2><p>从群白名单中开启主动推送，无需重复添加。配置待通道接入后生效。</p></div>${tag(`${account.groups.filter((g) => g.pushEnabled !== false).length} 个群开启`)}</div>
  ${
    account.groups.length
      ? table(
          ["群名称", "群 ID", "主动推送", "操作"],
          slicePage(account.groups, state.whitelistPageSize, "whitelist").map(
            (g) =>
              `<tr><td>${esc(g.name || "未命名群")}</td><td class="whitelist-id">${esc(g.id)}</td><td>${tag(g.pushEnabled !== false ? "已开启 · 待同步" : "未开启")}</td><td><button class="button" data-push-group="${esc(g.id)}" data-enabled="${g.pushEnabled === false}" ${canWrite() ? "" : "disabled"}>${g.pushEnabled === false ? "开启推送" : "关闭推送"}</button></td></tr>`,
          ),
        ) + pager(account.groups.length, state.whitelistPageSize, "whitelist")
      : empty("尚无授权群，请先在白名单授权中添加群。")
  }</section>`;
}
