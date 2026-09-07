import type { Group, Ticket } from "./domain.js";
import { durationMinutes, median } from "./overview-dimensions.js";
const DAY = 86400000;
export const chinaDay = (time: number) =>
  new Date(time + 28800000).toISOString().slice(0, 10);
export function trendDetails(
  tickets: Ticket[],
  groups: Group[],
  today: string,
  period: string,
  now: number,
) {
  const length = period === "day" ? 1 : period === "month" ? 30 : 7;
  const todayStart = Date.parse(today + "T00:00:00+08:00");
  const from = todayStart - (length - 1) * DAY,
    at = Math.min(now, todayStart + DAY - 1);
  const previousFrom = from - length * DAY,
    previousAt = at - length * DAY;
  const days = Array.from({ length }, (_, i) => ({
    date: chinaDay(from + i * DAY),
    from: from + i * DAY,
    at: Math.min(at, from + (i + 1) * DAY - 1),
    created: 0,
    closed: 0,
    responses: [] as number[],
    processing: [] as number[],
    groups: new Map<string, number>(),
  }));
  const types = new Map<
    string,
    { id: string; name: string; current: number; previous: number }
  >();
  const byGroup = new Map(
    groups.map((g) => [
      g.id,
      { id: g.id, name: g.name, current: 0, previous: 0 },
    ]),
  );
  let total = 0,
    previousTotal = 0;
  const inRange = (time: number, start: number, end: number) =>
    Number.isFinite(time) && time >= start && time <= end;
  const increment = (
    map: typeof types,
    id: string,
    name: string,
    field: "current" | "previous",
  ) => {
    if (!map.has(id)) map.set(id, { id, name, current: 0, previous: 0 });
    map.get(id)![field]++;
  };
  for (const t of tickets) {
    const created = Date.parse(t.createdAt),
      accepted = t.acceptedAt ? Date.parse(t.acceptedAt) : NaN,
      closed = t.closedAt ? Date.parse(t.closedAt) : NaN;
    const current = inRange(created, from, at),
      previous = inRange(created, previousFrom, previousAt);
    if (current || previous) {
      const field = current ? "current" : "previous";
      increment(types, t.type || "未分类", t.type || "未分类", field);
      increment(
        byGroup,
        t.groupId,
        byGroup.get(t.groupId)?.name || t.groupId || "未分组",
        field,
      );
      if (current) {
        total++;
        const d = days[Math.floor((created - from) / DAY)];
        d.created++;
        d.groups.set(t.groupId, (d.groups.get(t.groupId) || 0) + 1);
      } else previousTotal++;
    }
    if (
      inRange(closed, from, at) &&
      t.status === "CLOSED" &&
      Number.isFinite(created) &&
      closed >= created
    )
      days[Math.floor((closed - from) / DAY)].closed++;
    for (const kind of ["response", "processing"] as const) {
      const timestamp = kind === "response" ? accepted : closed,
        value = durationMinutes(t, kind, at);
      if (inRange(timestamp, from, at) && value !== null)
        (kind === "response"
          ? days[Math.floor((timestamp - from) / DAY)].responses
          : days[Math.floor((timestamp - from) / DAY)].processing
        ).push(value);
    }
  }
  const sorted = (map: typeof types) =>
    [...map.values()].sort(
      (a, b) =>
        b.current - a.current ||
        b.previous - a.previous ||
        a.name.localeCompare(b.name),
    );
  return {
    from,
    at,
    previousFrom,
    previousAt,
    total,
    previousTotal,
    types: sorted(types),
    groups: sorted(byGroup),
    days: days.map((d) => ({
      ...d,
      response: median(d.responses),
      process: median(d.processing),
      net: d.created - d.closed,
    })),
  };
}
export type TrendDetails = ReturnType<typeof trendDetails>;
export function comparison(current: number, previous: number) {
  if (!previous) return "— · 上期未记录";
  const delta = current - previous,
    pct = (delta / previous) * 100;
  return `${delta > 0 ? "+" : ""}${delta} 单（${pct > 0 ? "+" : ""}${Number(pct.toFixed(1))}%）`;
}
