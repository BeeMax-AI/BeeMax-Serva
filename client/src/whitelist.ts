import type { Account } from "../../shared/domain.js";
import { connections } from "./connections.js";
import { accessContent } from "./mcp.js";
import {
  state,
  esc,
  fmt,
  title,
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
export function whitelistPage() {
  const account = connections().accounts.find((a) => a.id === state.agent);
  const header =
    `<a class="connection-back text-link" href="#accounts">← 返回企微账号</a>` +
    title("白名单", "管理授权对象、主动推送范围和访问规则。") +
    (account
      ? `<div class="agent-identity"><div><h3>${esc(account.name)}</h3><small>实例 ID：${esc(account.id)}</small></div>${tag("实例配置待同步")}</div>`
      : "");
  const navigation = `<div class="tabbar" role="tablist" aria-label="白名单功能">${tabs.map(([id, name]) => `<button role="tab" data-whitelist-tab="${id}" aria-selected="${state.whitelistTab === id}" class="${state.whitelistTab === id ? "active" : ""}" ${!account && id !== "access" ? "disabled" : ""}>${name}</button>`).join("")}</div>`;
  if (state.whitelistTab === "access")
    return (
      header +
      navigation +
      `<section class="panel"><div class="note-band"><strong>生效范围：整个渠道</strong> · 以下策略由 MCP 管理，影响对应渠道的所有账号，不只影响当前实例。实例白名单配置不会自动合并到渠道名单。</div>${accessContent()}</section>`
    );
  if (!account)
    return header + empty("请从企微账号选择一个实例，再管理白名单。");
  return (
    header +
    navigation +
    (state.whitelistTab === "push"
      ? pushContent(account)
      : authorizationContent(account))
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
      slicePage(entries).map(
        (entry) =>
          `<tr><td>${esc(entry.name || `未命名${label}`)}</td><td class="whitelist-id">${esc(entry.id)}</td><td>${fmt(entry.addedAt)}</td><td><button class="text-link" data-whitelist-remove="${esc(entry.id)}" data-kind="${member ? "member" : "group"}" ${canWrite() ? "" : "disabled"}>移除</button></td></tr>`,
      ),
    )}${pager(entries.length)}</section>`;
}
function pushContent(account: Account) {
  return `<section class="panel"><div class="config-title"><div><h2>推送设置</h2><p>从群白名单中开启主动推送，无需重复添加。配置待通道接入后生效。</p></div>${tag(`${account.groups.filter((g) => g.pushEnabled !== false).length} 个群开启`)}</div>
  ${
    account.groups.length
      ? table(
          ["群名称", "群 ID", "主动推送", "操作"],
          slicePage(account.groups).map(
            (g) =>
              `<tr><td>${esc(g.name || "未命名群")}</td><td class="whitelist-id">${esc(g.id)}</td><td>${tag(g.pushEnabled !== false ? "已开启 · 待同步" : "未开启")}</td><td><button class="button" data-push-group="${esc(g.id)}" data-enabled="${g.pushEnabled === false}" ${canWrite() ? "" : "disabled"}>${g.pushEnabled === false ? "开启推送" : "关闭推送"}</button></td></tr>`,
          ),
        ) + pager(account.groups.length)
      : empty("尚无授权群，请先在白名单授权中添加群。")
  }</section>`;
}
