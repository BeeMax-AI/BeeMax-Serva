import type { Bootstrap } from "../../shared/domain.js";

/** A slower business refresh must not replace a newer independently saved connection configuration. */
export function preserveConnections(
  current: Bootstrap | null,
  incoming: Bootstrap,
) {
  if (
    !current?.connections ||
    current.actor.id !== incoming.actor.id ||
    current.actor.tenantId !== incoming.actor.tenantId ||
    current.connections.revision <= (incoming.connections?.revision || 0)
  )
    return;
  incoming.connections = current.connections;
  const ids = new Set(current.connections.audit.map((a) => a.id));
  incoming.workspace.audit = [
    ...current.connections.audit,
    ...incoming.workspace.audit.filter((a) => !ids.has(a.id)),
  ].sort((a, b) => b.at.localeCompare(a.at));
}
