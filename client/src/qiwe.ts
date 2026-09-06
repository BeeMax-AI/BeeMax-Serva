import { canManageQiwe } from "../../shared/domain.js";
import { state, esc, fmt, tag } from "./core.js";
const eye =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
const key =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M14 3a7 7 0 0 0-6.5 9.6L3 17v4h4v-3h3l2.4-2.5A7 7 0 1 0 14 3Z"/><circle cx="16" cy="8" r="1"/></svg>';
function credentialRow(
  name: string,
  label: string,
  description: string,
  saved: boolean,
  max: number,
  secret = false,
) {
  return `<div class="qiwe-field"><label for="qiwe-${name}">${label}</label><div><div class="qiwe-input-wrap"><input id="qiwe-${name}" name="${name}" type="${secret ? "password" : "text"}" maxlength="${max}" autocomplete="${secret ? "new-password" : "off"}" placeholder="输入新${label}以更新" aria-describedby="qiwe-${name}-help">${secret ? `<button type="button" class="qiwe-reveal" data-qiwe-secret="${name}" aria-label="显示${label}" aria-controls="qiwe-${name}" aria-pressed="false" title="显示${label}">${eye}</button>` : ""}</div><small id="qiwe-${name}-help">${description} · ${saved ? "已保存，留空保留现有值" : "尚未配置"}</small></div></div>`;
}
export function qiweContent() {
  const q = state.boot?.qiwe;
  if (!q)
    return `<div class="config-title"><div><h2>QiWe 凭据</h2><p>配置状态尚未加载，请刷新页面重试。</p></div></div>`;
  const saved = q.tokenSaved || q.accountSaved || q.passwordSaved;
  return `<div class="qiwe-card-head"><span class="qiwe-key">${key}</span><div><h2>QiWe 凭据</h2><p>配置消息接口 Token 和 QiWe Manager 管理账号。</p></div>${tag(saved ? "凭据已保存" : "待配置", saved)}</div>
  ${
    canManageQiwe(state.boot!.actor.role)
      ? `<form id="credential-form" class="qiwe-form" data-revision="${q.revision}" autocomplete="off"><div class="qiwe-fields">
    ${credentialRow("token", "Token", "QiWe 消息接口 X-QIWE-TOKEN", q.tokenSaved, 500, true)}
    ${credentialRow("account", "账号", "QiWe Manager 控制台管理账号" + (q.accountMask ? "（" + esc(q.accountMask) + "）" : ""), q.accountSaved, 100)}
    ${credentialRow("password", "密码", "QiWe Manager 控制台管理密码", q.passwordSaved, 500, true)}
  </div><div class="qiwe-form-actions"><span>留空保留现有值，保存后清空输入。</span><button type="reset" class="button">重置输入</button><button type="submit" class="button primary">保存配置</button></div></form>`
      : `<div class="qiwe-readonly"><div>Token：${q.tokenSaved ? "已保存" : "未配置"}</div><div>账号：${esc(q.accountMask || "未配置")}</div><div>密码：${q.passwordSaved ? "已保存" : "未配置"}</div><p>当前账号为只读账号，无法修改配置。</p></div>`
  }
  <div class="qiwe-connection-meta"><span>连接状态：<strong>未验证</strong> · ${q.updatedAt ? "最近更新 " + fmt(q.updatedAt) : "尚未保存配置"}</span><button class="button" disabled title="尚未接入 QiWe 检测接口">检测连接</button></div><div class="panel-footer"><a class="text-link" href="#accounts">管理企微账号 →</a><span>连接检测待 QiWe 接口接入。</span></div>`;
}
export function toggleQiweSecret(button: HTMLButtonElement) {
  const name = button.dataset.qiweSecret;
  if (name !== "token" && name !== "password") return;
  const input = document.querySelector<HTMLInputElement>(`#qiwe-${name}`);
  if (!input) return;
  const show = input.type === "password";
  input.type = show ? "text" : "password";
  button.setAttribute("aria-pressed", String(show));
  const label = `${show ? "隐藏" : "显示"}${name === "token" ? "Token" : "密码"}`;
  button.setAttribute("aria-label", label);
  button.title = label;
}
export function resetQiweSecrets(form: HTMLFormElement) {
  form
    .querySelectorAll<HTMLInputElement>('[name="token"], [name="password"]')
    .forEach((input) => (input.type = "password"));
  form
    .querySelectorAll<HTMLButtonElement>("[data-qiwe-secret]")
    .forEach((button) => {
      button.setAttribute("aria-pressed", "false");
      const label = `显示${button.dataset.qiweSecret === "token" ? "Token" : "密码"}`;
      button.setAttribute("aria-label", label);
      button.title = label;
    });
}
