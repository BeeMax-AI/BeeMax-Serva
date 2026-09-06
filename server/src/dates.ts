import type { Plan } from "../../shared/domain.ts";
// Business dates use fixed UTC+8. Persist actual instants in UTC.
const OFFSET = 8 * 3600000,
  DAY = 86400000;
export const businessDate = (instant = new Date()) =>
  new Date(instant.getTime() + OFFSET).toISOString().slice(0, 10);
export const addDays = (date: string, n: number) =>
  new Date(Date.parse(date + "T00:00:00Z") + n * DAY)
    .toISOString()
    .slice(0, 10);
export const validDate = (value: unknown): value is string =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 10) === value;
function candidate(y: number, m: number, d: number, time: string) {
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      y,
      m,
      Math.min(d, last),
      Number(time.slice(0, 2)) - 8,
      Number(time.slice(3)),
    ),
  );
}
export function nextRun(p: Plan, after = new Date()): string {
  const now = new Date(after.getTime() + OFFSET),
    y = now.getUTCFullYear(),
    m = now.getUTCMonth(),
    day = now.getUTCDate();
  if (["daily", "weekly", "half"].includes(p.frequency)) {
    for (let n = 0; n < 40; n++) {
      const local = new Date(Date.UTC(y, m, day + n)),
        d = candidate(
          local.getUTCFullYear(),
          local.getUTCMonth(),
          local.getUTCDate(),
          p.time,
        );
      if (
        d > after &&
        (p.frequency === "daily" ||
          (p.frequency === "weekly" && local.getUTCDay() === p.weekday) ||
          (p.frequency === "half" && [1, 16].includes(local.getUTCDate())))
      )
        return d.toISOString();
    }
  }
  if (["monthly", "quarterly", "yearly"].includes(p.frequency)) {
    for (let n = 0; n < 25; n++) {
      const date = new Date(Date.UTC(y, m + n, 1)),
        month = date.getUTCMonth();
      if (
        (p.frequency === "quarterly" && month % 3 !== 0) ||
        (p.frequency === "yearly" && month !== p.yearMonth - 1)
      )
        continue;
      const d = candidate(date.getUTCFullYear(), month, p.monthDay, p.time);
      if (d > after) return d.toISOString();
    }
  }
  if (p.frequency === "interval") {
    const a = new Date(p.anchor + "T00:00:00Z");
    if (p.unit === "days" || p.unit === "weeks") {
      const step = p.every * (p.unit === "weeks" ? 7 : 1) * DAY,
        first = candidate(
          a.getUTCFullYear(),
          a.getUTCMonth(),
          a.getUTCDate(),
          p.time,
        );
      return new Date(
        first.getTime() +
          Math.max(
            0,
            Math.floor((after.getTime() - first.getTime()) / step) + 1,
          ) *
            step,
      ).toISOString();
    }
    const step = p.every * (p.unit === "years" ? 12 : 1),
      diff = (y - a.getUTCFullYear()) * 12 + m - a.getUTCMonth();
    for (
      let n = Math.max(0, Math.floor(diff / step));
      n < Math.max(0, Math.floor(diff / step)) + 3;
      n++
    ) {
      const month = a.getUTCMonth() + n * step,
        d = candidate(
          a.getUTCFullYear() + Math.floor(month / 12),
          month % 12,
          a.getUTCDate(),
          p.time,
        );
      if (d > after) return d.toISOString();
    }
  }
  throw new Error("无法计算计划时间");
}
export function planRange(
  p: Plan,
  at = new Date(),
): { start: string; end: string } {
  const today = businessDate(at),
    d = new Date(today + "T00:00:00Z"),
    y = d.getUTCFullYear(),
    m = d.getUTCMonth(),
    day = d.getUTCDate(),
    fmt = (y: number, m: number, d: number) =>
      new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
  switch (p.range) {
    case "previousDay":
      return { start: addDays(today, -1), end: addDays(today, -1) };
    case "previousWeek": {
      const monday = addDays(today, -((d.getUTCDay() + 6) % 7));
      return { start: addDays(monday, -7), end: addDays(monday, -1) };
    }
    case "previousHalf":
      return day <= 15
        ? { start: fmt(y, m - 1, 16), end: fmt(y, m, 0) }
        : { start: fmt(y, m, 1), end: fmt(y, m, 15) };
    case "previousMonth":
      return { start: fmt(y, m - 1, 1), end: fmt(y, m, 0) };
    case "previousQuarter": {
      const q = m - (m % 3);
      return { start: fmt(y, q - 3, 1), end: fmt(y, q, 0) };
    }
    case "previousYear":
      return { start: fmt(y - 1, 0, 1), end: fmt(y - 1, 11, 31) };
    default:
      return { start: addDays(today, -p.rangeDays), end: addDays(today, -1) };
  }
}
