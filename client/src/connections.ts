import type { ConnectionWorkspace } from "../../shared/domain.js";
import { state, w, modal, post, api, closeModal, toast } from "./core.js";

export const connections = (): ConnectionWorkspace =>
  state.boot?.connections || {
    revision: 1,
    accounts: [],
    messages: [],
    audit: [],
    updatedAt: null,
    channelStatus: "not_connected",
  };
export function confirmConnectionCommand(
  heading: string,
  description: string,
  type: string,
  data: Record<string, unknown>,
  revision = connections().revision,
) {
  const identity = state.boot!.actor.id + ":" + state.boot!.actor.tenantId;
  const requestId = crypto.randomUUID();
  // modal content is plain text from editable instance/group names.
  const dialog = modal(
    heading,
    "<p class=connection-confirm-text></p><p>保存到工作台，消息通道接入后才能同步生效。</p>",
    {
      label: "确认保存",
      run: async () => {
        const updated = await post<ConnectionWorkspace>(
          "/connections/commands",
          {
            type,
            data,
            expectedRevision: revision,
            requestId,
          },
        );
        if (
          !state.boot ||
          state.boot.actor.id + ":" + state.boot.actor.tenantId !== identity
        )
          return;
        applyConnections(updated);
        closeModal();
        window.dispatchEvent(new Event("connections-updated"));
        toast("连接配置已保存");
      },
    },
  );
  dialog.querySelector(".connection-confirm-text")!.textContent = description;
}
function applyConnections(value: ConnectionWorkspace) {
  if (value.revision < connections().revision) return;
  const oldAuditIds = new Set(
    [...connections().audit, ...value.audit].map((a) => a.id),
  );
  state.boot!.connections = value;
  w().audit = [
    ...value.audit,
    ...w().audit.filter((a) => !oldAuditIds.has(a.id)),
  ].sort((a, b) => b.at.localeCompare(a.at));
}
export async function refreshConnections() {
  const identity = state.boot!.actor.id + ":" + state.boot!.actor.tenantId;
  const value = await api<ConnectionWorkspace>("/connections");
  if (
    !state.boot ||
    state.boot.actor.id + ":" + state.boot.actor.tenantId !== identity
  )
    return;
  applyConnections(value);
  window.dispatchEvent(new Event("connections-updated"));
}
