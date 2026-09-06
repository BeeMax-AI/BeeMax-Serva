import type { ChannelAccess, RemoteAnalytics } from "../../shared/domain.ts";
import { requireValue } from "./errors.ts";
export const isObject = (value: any): value is Record<string, any> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const numeric = (value: unknown): number => {
  requireValue(
    typeof value === "number" && Number.isFinite(value),
    "MCP 统计字段格式已变化",
    502,
  );
  return value;
};
const nullable = (value: unknown) => (value === null ? null : numeric(value));
export function normalizeAnalytics(raw: any): RemoteAnalytics {
  requireValue(
    isObject(raw?.overview) &&
      Array.isArray(raw?.trends?.series) &&
      Array.isArray(raw?.staff?.staff),
    "MCP 统计结构已变化",
    502,
  );
  const o = raw.overview;
  requireValue(
    typeof o.today === "string" &&
      Number.isFinite(new Date(raw.generated_at).getTime()),
    "MCP 统计日期无效",
    502,
  );
  return {
    generatedAt: new Date(raw.generated_at).toISOString(),
    today: o.today,
    total: numeric(o.total_tickets),
    periods: [
      ["今日", o.today_stats],
      ["昨日", o.yesterday_stats],
      ["上周", o.lastweek_stats],
    ].map(([label, p]: any) => ({
      label,
      created: numeric(p?.created),
      closed: numeric(p?.closed),
      noAccept: numeric(p?.noAccept),
      response: nullable(p?.avgRespMin),
      resolution: nullable(p?.avgResoMin),
      completionRate: nullable(p?.completionRate),
    })),
    trend: raw.trends.series.map((r: any) => {
      requireValue(typeof r.key === "string", "MCP 趋势日期无效", 502);
      return {
        date: r.key,
        created: numeric(r.created),
        closed: numeric(r.closed),
        backlog: numeric(r.backlog),
      };
    }),
    staff: raw.staff.staff.map((p: any) => {
      requireValue(typeof p.name === "string", "MCP 人员统计姓名无效", 502);
      return {
        name: p.name,
        accepted: numeric(p.accepted),
        closed: numeric(p.closed),
        share: numeric(p.share),
        response: nullable(p.avgRespMin),
        handling: nullable(p.avgHandleMin),
      };
    }),
  };
}
export function normalizeAccess(raw: any): ChannelAccess[] {
  requireValue(isObject(raw), "MCP 渠道权限结构无效", 502);
  return (["wecom", "feishu"] as const)
    .filter((channel) => raw[channel] !== undefined)
    .map((channel) => {
      const v = raw[channel];
      requireValue(
        isObject(v) &&
          typeof v.dmPolicy === "string" &&
          typeof v.groupPolicy === "string" &&
          Array.isArray(v.dmAllowFrom) &&
          v.dmAllowFrom.every((x: unknown) => typeof x === "string") &&
          isObject(v.groups),
        "MCP 渠道权限字段无效",
        502,
      );
      return {
        channel,
        dmPolicy: v.dmPolicy,
        groupPolicy: v.groupPolicy,
        dmAllowFrom: v.dmAllowFrom,
        groups: Object.entries(v.groups).map(([id, g]: [string, any]) => ({
          id,
          name: typeof g?.name === "string" ? g.name : "未命名群",
          mode: typeof g?.mode === "string" ? g.mode : "未说明",
        })),
      };
    });
}
