import { canManageQiwe } from "../../shared/domain.ts";
import type { Actor, Audit, QiweConnection } from "../../shared/domain.ts";
import type { Store } from "./store.ts";
import { requireValue } from "./errors.ts";

/** QiWe credentials belong to the workspace, independently of its data provider. */
export function qiweConnection(store: Store, actor: Actor): QiweConnection {
  const values = store.getSecret(actor.tenantId);
  return {
    revision: Number(values.qiweRevision || 0),
    tokenSaved: !!values.token,
    accountSaved: !!values.account,
    passwordSaved: !!values.password,
    accountMask: values.account ? values.account.slice(0, 1) + "****" : "",
    updatedAt:
      values.qiweUpdatedAt ||
      localWorkspace(store, actor.tenantId)?.credentials.updatedAt ||
      null,
    connectionStatus: "unverified",
    canTest: false,
  };
}

export function saveQiweConnection(
  store: Store,
  actor: Actor,
  data: Record<string, unknown>,
) {
  requireValue(canManageQiwe(actor.role), "当前账号无权修改 QiWe 凭据", 403);
  const current = qiweConnection(store, actor);
  requireValue(
    Number.isSafeInteger(data.expectedRevision) &&
      data.expectedRevision === current.revision,
    "QiWe 配置已更新，请重新打开页面后再保存",
    409,
  );
  store.db.exec("BEGIN IMMEDIATE");
  try {
    const credentials = updateQiweCredentials(store, actor, data);
    const now = credentials.updatedAt!;
    const w = localWorkspace(store, actor.tenantId);
    const entry: Audit = {
      id: crypto.randomUUID(),
      at: now,
      actor: actor.name,
      action: "credentials.save",
      target: "QiWe",
      detail: "更新 QiWe 连接凭据（内容不记录）",
    };
    if (w) {
      w.credentials = credentials;
      w.revision++;
      w.audit = [entry, ...w.audit].slice(0, 2000);
      store.save(w);
    } else {
      // MCP-only tenants need no sample/local business workspace.
      const audit = [entry, ...qiweAudit(store, actor.tenantId)].slice(0, 2000);
      store.db
        .prepare(
          "INSERT INTO qiwe_audit VALUES(?,?) ON CONFLICT(tenant) DO UPDATE SET data=excluded.data",
        )
        .run(actor.tenantId, JSON.stringify(audit));
    }
    store.db.exec("COMMIT");
  } catch (error) {
    store.db.exec("ROLLBACK");
    throw error;
  }
  const saved = localWorkspace(store, actor.tenantId);
  return {
    ...qiweConnection(store, actor),
    workspaceRevision: saved?.revision ?? null,
    auditEntry: qiweAudit(store, actor.tenantId)[0],
  };
}

/** Shared by the independent API and the legacy local command, inside their transaction. */
export function updateQiweCredentials(
  store: Store,
  actor: Actor,
  data: Record<string, unknown>,
) {
  requireValue(canManageQiwe(actor.role), "当前账号无权修改 QiWe 凭据", 403);
  const values = store.getSecret(actor.tenantId);
  let changed = false;
  for (const field of ["token", "account", "password"] as const) {
    const value = data[field];
    if (value === undefined || value === "") continue;
    requireValue(
      typeof value === "string" &&
        value.length <= (field === "account" ? 100 : 500) &&
        value.trim().length > 0,
      "凭据格式无效，请检查输入长度和空白内容",
    );
    // Passwords are opaque: do not trim or otherwise transform them.
    values[field] = value;
    changed = true;
  }
  requireValue(changed, "请填写需要更新的凭据");
  const now = new Date().toISOString();
  values.qiweRevision = String(Number(values.qiweRevision || 0) + 1);
  values.qiweUpdatedAt = now;
  store.setSecret(actor.tenantId, values);
  return {
    configured: !!values.token,
    accountMask: values.account ? values.account.slice(0, 1) + "****" : "",
    updatedAt: now,
  };
}

function localWorkspace(store: Store, tenant: string) {
  return store.db
    .prepare("SELECT tenant FROM workspaces WHERE tenant=?")
    .get(tenant)
    ? store.read(tenant)
    : undefined;
}
export function qiweAudit(store: Store, tenant: string): Audit[] {
  const row = store.db
    .prepare("SELECT data FROM qiwe_audit WHERE tenant=?")
    .get(tenant) as { data: string } | undefined;
  return [
    ...(row ? (JSON.parse(row.data) as Audit[]) : []),
    ...(localWorkspace(store, tenant)?.audit || []).filter(
      (a) => a.action === "credentials.save",
    ),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 2000);
}
