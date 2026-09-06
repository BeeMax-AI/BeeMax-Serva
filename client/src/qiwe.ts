import { state, esc, fmt, tag, field, isOwner } from "./core.js";

export function qiweContent() {
  const q = state.boot?.qiwe;
  if (!q)
    return `<div class="config-title"><div><h2>QiWe 连接</h2><p>配置状态尚未加载，请刷新页面重试。</p></div></div>`;
  const saved = q.tokenSaved || q.accountSaved || q.passwordSaved;
  return `<div class="config-title"><div><h2>QiWe 连接</h2><p>管理企业微信通道的接口 Token 和 Manager 账号。</p></div>${tag(saved ? "凭据已保存" : "待配置", saved)}</div>
  <div class="qiwe-status-grid"><div><span>接口 Token</span><strong>${q.tokenSaved ? "已保存" : "未配置"}</strong></div><div><span>Manager 账号</span><strong>${esc(q.accountMask || "未配置")}</strong></div><div><span>Manager 密码</span><strong>${q.passwordSaved ? "已保存" : "未配置"}</strong></div><div><span>连接状态</span><strong>未验证</strong></div></div>
  <div class="qiwe-update">${q.updatedAt ? "最近更新：" + fmt(q.updatedAt) : "尚未保存配置"}</div>
  ${
    isOwner()
      ? `<form id="credential-form" class="credential-form" data-revision="${q.revision}" autocomplete="off">
    ${field("接口 Token", "token", "", "password", 'maxlength="500" autocomplete="new-password" placeholder="输入新 Token，留空保留现有值"')}
    ${field("Manager 账号", "account", "", "text", 'maxlength="100" autocomplete="off" placeholder="输入新账号，留空保留现有值"')}
    ${field("Manager 密码", "password", "", "password", 'maxlength="500" autocomplete="new-password" placeholder="输入新密码，留空保留现有值"')}
    <label class="inline-check"><input id="show-secrets" type="checkbox">显示本次输入</label>
    <div class="credential-footer"><span>凭据加密保存，保存后清空输入。</span><button type="reset" class="button">重置输入</button><button type="submit" class="button primary">保存配置</button></div>
  </form>`
      : `<div class="qiwe-readonly">当前账号可查看配置状态；修改凭据请使用平台管理员账号。</div>`
  }
  <div class="qiwe-test"><div><strong>连接检测</strong><p>尚未接入 QiWe 检测接口。凭据保存后，连接状态仍为未验证。</p></div><button class="button" disabled title="等待接入 QiWe 检测接口">检测连接</button></div><div class="panel-footer"><a class="text-link" href="#accounts">管理企微账号 →</a><span>在账号页面配置实例与推送群。</span></div>`;
}
