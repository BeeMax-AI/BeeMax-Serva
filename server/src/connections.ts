import { createHash, randomUUID } from "node:crypto";
import type {
  Actor,
  ConnectionWorkspace,
  Command,
} from "../../shared/domain.ts";
import type { Store } from "./store.ts";
import { requireValue, text } from "./errors.ts";

/** Independent channel configuration; never populated with prototype accounts or messages. */
export function readConnections(
  store: Store,
  tenant: string,
): ConnectionWorkspace {
  const row = store.db
    .prepare("SELECT data FROM wecom_connections WHERE tenant=?")
    .get(tenant) as { data: string } | undefined;
  return row
    ? JSON.parse(row.data)
    : {
        revision: 1,
        accounts: [],
        messages: [],
        audit: [],
        updatedAt: null,
        channelStatus: "not_connected",
      };
}
export function connectionCommand(
  store: Store,
  actor: Actor,
  command: Command,
): ConnectionWorkspace {
  requireValue(actor.role !== "viewer", "当前账号只有查看权限", 403);
  requireValue(
    command &&
      ["account.save", "group.add", "group.remove"].includes(command.type) &&
      command.data &&
      typeof command.data === "object" &&
      !Array.isArray(command.data),
    "连接配置请求无效",
  );
  text(command.requestId, "请求标识", 100);
  requireValue(Number.isSafeInteger(command.expectedRevision), "配置版本无效");
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(command))
    .digest("hex");
  const namespace = "wecom:" + actor.tenantId;
  store.db.exec("BEGIN IMMEDIATE");
  try {
    const prior = store.db
      .prepare(
        "SELECT fingerprint FROM requests WHERE tenant=? AND actor=? AND id=?",
      )
      .get(namespace, actor.id, command.requestId) as
      { fingerprint: string } | undefined;
    if (prior) {
      requireValue(
        prior.fingerprint === fingerprint,
        "请求标识已用于其他操作",
        409,
      );
      const latest = readConnections(store, actor.tenantId);
      store.db.exec("COMMIT");
      return latest;
    }
    const state = readConnections(store, actor.tenantId),
      data = command.data;
    requireValue(
      state.revision === command.expectedRevision,
      "连接配置已更新，请刷新后核对并重试",
      409,
    );
    const now = new Date().toISOString();
    let target: string, detail: string;
    if (command.type === "account.save") {
      const name = text(data.name, "实例名称", 40),
        company = text(data.company, "所属空间", 60);
      const existing = data.id
        ? state.accounts.find((a) => a.id === data.id)
        : undefined;
      requireValue(!data.id || existing, "账号实例不存在", 404);
      if (existing) {
        existing.name = name;
        existing.company = company;
      } else {
        requireValue(state.accounts.length < 2000, "账号实例数量已达上限");
        state.accounts.push({
          id: randomUUID(),
          name,
          company,
          status: "offline",
          login: "未登录",
          groups: [],
        });
      }
      target = existing?.id || state.accounts.at(-1)!.id;
      detail = `${existing ? "更新" : "添加"}企微实例：${name}`;
    } else {
      const account = state.accounts.find((a) => a.id === data.accountId);
      requireValue(account, "账号实例不存在", 404);
      const chatId = text(data.chatId, "会话 ID", 128);
      requireValue(
        /^[a-zA-Z0-9_:\-]+$/.test(chatId),
        "会话 ID 请使用字母、数字、下划线、短横线或冒号",
      );
      if (command.type === "group.add") {
        requireValue(
          !account.groups.some((g) => g.id === chatId),
          "该会话已在当前实例的名单中",
          409,
        );
        requireValue(account.groups.length < 2000, "推送群数量已达上限");
        const name =
          data.name === "" || data.name === undefined
            ? ""
            : text(data.name, "群名称", 40);
        account.groups.push({ id: chatId, name, addedAt: now });
        detail = `保存推送群配置：${name || chatId}`;
      } else {
        requireValue(
          account.groups.some((g) => g.id === chatId),
          "推送群配置不存在",
          404,
        );
        account.groups = account.groups.filter((g) => g.id !== chatId);
        detail = `移除推送群配置：${chatId}`;
      }
      target = account.id;
    }
    state.revision++;
    state.updatedAt = now;
    state.audit.unshift({
      id: randomUUID(),
      at: now,
      actor: actor.name,
      action: command.type,
      target,
      detail,
    });
    state.audit = state.audit.slice(0, 2000);
    store.db
      .prepare(
        "INSERT INTO wecom_connections VALUES(?,?) ON CONFLICT(tenant) DO UPDATE SET data=excluded.data",
      )
      .run(actor.tenantId, JSON.stringify(state));
    store.db
      .prepare("INSERT INTO requests VALUES(?,?,?,?,?)")
      .run(
        namespace,
        actor.id,
        command.requestId,
        fingerprint,
        JSON.stringify({ revision: state.revision }),
      );
    store.db.exec("COMMIT");
    return state;
  } catch (error) {
    store.db.exec("ROLLBACK");
    throw error;
  }
}
