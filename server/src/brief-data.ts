import type { Workspace } from "../../shared/domain.ts";
import { durationMinutes } from "../../shared/overview-dimensions.ts";
import { addDays } from "./dates.ts";

export function briefData(
  w: Workspace,
  start: string,
  end: string,
  now = new Date(),
) {
  const from = Date.parse(start + "T00:00:00+08:00");
  const at = Math.min(now.getTime(), Date.parse(end + "T23:59:59.999+08:00"));
  const inRange = (value: string | null) =>
    !!value && Date.parse(value) >= from && Date.parse(value) <= at;
  const created = w.tickets.filter((t) => inRange(t.createdAt));
  const closed = w.tickets.filter(
    (t) =>
      t.status === "CLOSED" &&
      inRange(t.closedAt) &&
      Date.parse(t.closedAt!) >= Date.parse(t.createdAt),
  );
  const open = w.tickets.filter((t) => t.status !== "CLOSED");
  const day = (value: string) =>
    new Date(Date.parse(value) + 28800000).toISOString().slice(0, 10);
  const counts = (
    rows: typeof created,
    field: (t: (typeof created)[number]) => string,
  ) => {
    const map = new Map<string, number>();
    for (const t of rows) {
      const key = field(t);
      map.set(key, (map.get(key) || 0) + 1);
    }
    return map;
  };
  const newDays = counts(created, (t) => day(t.createdAt));
  const closedDays = counts(closed, (t) => day(t.closedAt!));
  const trend = [];
  for (let date = start; date <= end; date = addDays(date, 1))
    trend.push({
      date,
      created: newDays.get(date) || 0,
      closed: closedDays.get(date) || 0,
    });
  const groups = new Map(w.groups.map((g) => [g.id, g.name]));
  const distribution = (field: (t: (typeof created)[number]) => string) =>
    [...counts(created, field)]
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  const attentionRank = (status: string) =>
    status.startsWith("ESCALATED")
      ? 0
      : status === "NO_ACCEPT"
        ? 1
        : status === "DISPATCHED"
          ? 2
          : status === "ON_HOLD"
            ? 3
            : 4;
  const attention = open
    .filter((t) => attentionRank(t.status) < 4)
    .sort(
      (a, b) =>
        attentionRank(a.status) - attentionRank(b.status) ||
        (Date.parse(a.createdAt) || Infinity) -
          (Date.parse(b.createdAt) || Infinity),
    );
  const names = new Map(w.people.map((p) => [p.id, p.name]));
  const staff = new Map<
    string,
    { id: string; name: string; group: string; accepted: number; open: number }
  >();
  for (const t of w.tickets) {
    if (!t.assigneeId) continue;
    const accepted =
      inRange(t.acceptedAt) &&
      durationMinutes(t, "response", now.getTime()) !== null;
    if (!accepted && t.status === "CLOSED") continue;
    const p = w.people.find((p) => p.id === t.assigneeId);
    const row = staff.get(t.assigneeId) || {
      id: t.assigneeId,
      name: names.get(t.assigneeId) || t.assigneeId,
      group: groups.get(p?.groupId || t.groupId) || "未分组",
      accepted: 0,
      open: 0,
    };
    if (accepted) row.accepted++;
    if (t.status !== "CLOSED") row.open++;
    staff.set(t.assigneeId, row);
  }
  return {
    tenant: w.tenant.name,
    start,
    end,
    generatedAt: now.toISOString(),
    total: w.tickets.length,
    created: created.length,
    closed: closed.length,
    open: open.length,
    waiting: open.filter(
      (t) => t.status === "DISPATCHED" || t.status === "NO_ACCEPT",
    ).length,
    held: open.filter((t) => t.status === "ON_HOLD").length,
    trend,
    types: distribution((t) => t.type || "未分类"),
    groups: distribution((t) => groups.get(t.groupId) || t.groupId || "未分组"),
    attention,
    staff: [...staff.values()].sort(
      (a, b) => b.open - a.open || b.accepted - a.accepted,
    ),
    names,
  };
}
export type BriefData = ReturnType<typeof briefData>;
