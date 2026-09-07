import type { Group, Ticket } from "./domain.js";

export const ageLabels: Record<string, string> = {
  under1: "不足 1 小时",
  from1: "1–4 小时",
  from4: "4–24 小时",
  over24: "24 小时及以上",
  unknown: "时间待核对",
};
export type DimensionFilter = {
  kind:
    "age" | "waiting" | "open" | "response" | "processing" | "hour" | "type";
  key: string;
  from: number;
  at: number;
};
const instant = (s: string | null) => (s ? Date.parse(s) : NaN);
const inRange = (n: number, f: Pick<DimensionFilter, "from" | "at">) =>
  Number.isFinite(n) && n >= f.from && n <= f.at;
export function ageBucket(t: Ticket, at: number) {
  const age = (at - instant(t.createdAt)) / 3600000;
  return !Number.isFinite(age) || age < 0
    ? "unknown"
    : age < 1
      ? "under1"
      : age < 4
        ? "from1"
        : age < 24
          ? "from4"
          : "over24";
}
export function durationMinutes(
  t: Ticket,
  kind: "response" | "processing",
  at: number,
) {
  const created = instant(t.createdAt),
    accepted = instant(t.acceptedAt),
    closed = instant(t.closedAt);
  if (
    !Number.isFinite(created) ||
    !Number.isFinite(accepted) ||
    accepted < created ||
    accepted > at
  )
    return null;
  if (kind === "response") return (accepted - created) / 60000;
  return Number.isFinite(closed) &&
    closed >= accepted &&
    closed <= at &&
    t.status === "CLOSED"
    ? (closed - accepted) / 60000
    : null;
}
export function matchesDimension(t: Ticket, f: DimensionFilter) {
  if (f.kind === "age")
    return t.status !== "CLOSED" && ageBucket(t, f.at) === f.key;
  if (f.kind === "hour" || f.kind === "type") {
    const created = instant(t.createdAt);
    return (
      inRange(created, f) &&
      (f.kind === "type"
        ? (t.type || "未分类") === f.key
        : String(new Date(created + 8 * 3600000).getUTCHours()) === f.key)
    );
  }
  if (t.groupId !== f.key) return false;
  if (f.kind === "open") return t.status !== "CLOSED";
  if (f.kind === "waiting")
    return t.status === "DISPATCHED" || t.status === "NO_ACCEPT";
  return (
    inRange(instant(f.kind === "response" ? t.acceptedAt : t.closedAt), f) &&
    durationMinutes(t, f.kind, f.at) !== null
  );
}
export function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b),
    mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
export function overviewDimensions(
  tickets: Ticket[],
  groups: Group[],
  from: number,
  at: number,
) {
  const ages = Object.entries(ageLabels).map(([key, label]) => ({
    key,
    label,
    count: 0,
  }));
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0 }));
  const typeCounts = new Map<string, number>();
  const byGroup = new Map(
    groups.map((g) => [
      g.id,
      {
        id: g.id,
        name: g.name,
        waiting: 0,
        open: 0,
        responses: [] as number[],
        processing: [] as number[],
      },
    ]),
  );
  let createdCount = 0;
  for (const t of tickets) {
    if (t.status !== "CLOSED")
      ages.find((a) => a.key === ageBucket(t, at))!.count++;
    const created = instant(t.createdAt);
    if (inRange(created, { from, at })) {
      createdCount++;
      hours[new Date(created + 8 * 3600000).getUTCHours()].count++;
      const type = t.type || "未分类";
      typeCounts.set(type, (typeCounts.get(type) || 0) + 1);
    }
    if (!byGroup.has(t.groupId))
      byGroup.set(t.groupId, {
        id: t.groupId,
        name: t.groupId || "未分组",
        waiting: 0,
        open: 0,
        responses: [],
        processing: [],
      });
    const group = byGroup.get(t.groupId)!;
    if (t.status !== "CLOSED") group.open++;
    if (["DISPATCHED", "NO_ACCEPT"].includes(t.status)) group.waiting++;
    for (const kind of ["response", "processing"] as const) {
      const value = durationMinutes(t, kind, at);
      if (
        value !== null &&
        inRange(instant(kind === "response" ? t.acceptedAt : t.closedAt), {
          from,
          at,
        })
      )
        (kind === "response" ? group.responses : group.processing).push(value);
    }
  }
  return {
    ages,
    hours,
    createdCount,
    types: [...typeCounts]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, 5),
    groups: [...byGroup.values()]
      .map((g) => ({
        ...g,
        response: median(g.responses),
        process: median(g.processing),
      }))
      .sort((a, b) => b.open - a.open || a.name.localeCompare(b.name)),
  };
}
export function dimensionHref(f: DimensionFilter) {
  return (
    "#tickets?" +
    new URLSearchParams({
      dimension: f.kind,
      key: f.key,
      from: String(f.from),
      at: String(f.at),
    })
  );
}
export function readDimension(hash: string): DimensionFilter | null {
  const q = new URLSearchParams(hash.split("?")[1] || ""),
    kind = q.get("dimension"),
    key = q.get("key"),
    from = Number(q.get("from")),
    at = Number(q.get("at"));
  if (
    !kind ||
    key === null ||
    !q.has("from") ||
    !q.has("at") ||
    !Number.isFinite(from) ||
    !Number.isFinite(at) ||
    from > at ||
    from < 0 ||
    at > 8640000000000000 - 28800000 ||
    ![
      "age",
      "waiting",
      "open",
      "response",
      "processing",
      "hour",
      "type",
    ].includes(kind)
  )
    return null;
  if (kind === "age" && !Object.hasOwn(ageLabels, key)) return null;
  if (kind === "hour" && !/^(?:[0-9]|1[0-9]|2[0-3])$/.test(key)) return null;
  return { kind: kind as DimensionFilter["kind"], key, from, at };
}
