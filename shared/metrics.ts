import type { Metrics, Workspace } from "./domain.js";
const dayOf = (instant: string) =>
  new Date(Date.parse(instant) + 8 * 3600000).toISOString().slice(0, 10);
export function metrics(
  w: Pick<Workspace, "tickets" | "groups">,
  start: string,
  end: string,
): Metrics {
  const createdDays = new Map<string, number>(),
    closedDays = new Map<string, number>(),
    types = new Map<string, number>(),
    groups = new Map<string, number>();
  const groupNames = new Map(w.groups.map((g) => [g.id, g.name]));
  let open = 0,
    waiting = 0,
    held = 0,
    escalated = 0,
    created = 0,
    closed = 0,
    responseSum = 0,
    responseCount = 0,
    resolutionSum = 0;
  const increment = (map: Map<string, number>, key: string) =>
    map.set(key, (map.get(key) || 0) + 1);
  for (const t of w.tickets) {
    const createdAt = t.createdAt,
      closedAt = t.closedAt,
      createdDay = dayOf(createdAt),
      closedDay = closedAt ? dayOf(closedAt) : null;
    if (t.status !== "CLOSED") open++;
    if (t.status === "DISPATCHED" || t.status === "NO_ACCEPT") waiting++;
    if (t.status === "ON_HOLD") held++;
    if (t.status.startsWith("ESCALATED")) escalated++;
    if (createdDay >= start && createdDay <= end) {
      created++;
      increment(createdDays, createdDay);
      increment(types, t.type);
      increment(groups, groupNames.get(t.groupId) || t.groupId);
      if (t.acceptedAt) {
        responseSum +=
          (Date.parse(t.acceptedAt) - Date.parse(createdAt)) / 60000;
        responseCount++;
      }
    }
    if (closedDay && closedDay >= start && closedDay <= end) {
      closed++;
      increment(closedDays, closedDay);
      resolutionSum += (Date.parse(closedAt!) - Date.parse(createdAt)) / 60000;
    }
  }
  const trend = [];
  for (
    let at = Date.parse(start + "T00:00:00Z"),
      last = Date.parse(end + "T00:00:00Z");
    at <= last;
    at += 86400000
  ) {
    const date = new Date(at).toISOString().slice(0, 10);
    trend.push({
      date,
      created: createdDays.get(date) || 0,
      closed: closedDays.get(date) || 0,
    });
  }
  const counts = (map: Map<string, number>) =>
    [...map]
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  return {
    total: w.tickets.length,
    open,
    waiting,
    held,
    escalated,
    created,
    closed,
    avgResponse: responseCount
      ? Math.round((responseSum / responseCount) * 10) / 10
      : null,
    avgResolution: closed
      ? Math.round((resolutionSum / closed) * 10) / 10
      : null,
    byType: counts(types),
    byGroup: counts(groups),
    trend,
  };
}
