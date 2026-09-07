import type { Group, NotificationTier } from "../../shared/domain.ts";
import { number, requireValue, text } from "./errors.ts";

const record = (value: any) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const optionalRecord = (value: any) => value === undefined || record(value);
function containerValidity(roster: any, group: string, today: string) {
  return {
    defaults: record(roster?.default) && optionalRecord(roster.default[group]),
    date:
      optionalRecord(roster?.byDate) &&
      optionalRecord(roster?.byDate?.[today]) &&
      optionalRecord(roster?.byDate?.[today]?.[group]),
  };
}
const mode = (value: any): "people" | "all" | "special" =>
  value === "@ALL"
    ? "all"
    : value === undefined ||
        (Array.isArray(value) &&
          value.every(
            (p) =>
              p &&
              typeof p.userid === "string" &&
              p.userid !== "@ALL" &&
              typeof p.name === "string",
          ))
      ? "people"
      : "special";
export function notificationTiers(
  roster: any,
  groups: Group[],
  today: string,
): NotificationTier[] {
  return groups.flatMap((group) =>
    [1, 2, 3, 4].map((tier) => {
      const valid = containerValidity(roster, group.id, today);
      const key = "l" + tier,
        defaults = valid.defaults ? roster.default[group.id]?.[key] : null;
      const overridden = Object.hasOwn(
        roster.byDate?.[today]?.[group.id] || {},
        key,
      );
      const effective = !valid.date
        ? null
        : overridden
          ? roster.byDate[today][group.id][key]
          : defaults;
      const members = (value: any) =>
        mode(value) === "people"
          ? (value || []).map((p: any) => ({ userId: p.userid, name: p.name }))
          : [];
      return {
        groupId: group.id,
        tier,
        overridden,
        defaultMode: mode(defaults),
        effectiveMode: mode(effective),
        defaults: members(defaults),
        effective: members(effective),
      };
    }),
  );
}

function editableTier(
  snapshot: any,
  data: Record<string, unknown>,
  today: string,
) {
  requireValue(
    data.scope === "default" || data.scope === "today",
    "请选择默认或今日名单",
  );
  if (data.scope === "today")
    requireValue(
      data.date === today,
      "日期已变化，请刷新后重新设置今日名单",
      409,
    );
  const groupId = text(data.groupId, "小组", 128),
    tier = number(data.tier, "通知级别", 1, 4),
    key = "l" + tier;
  const valid = containerValidity(snapshot, groupId, today);
  requireValue(
    valid.defaults && (data.scope !== "today" || valid.date),
    "排班结构异常，请在源系统核对",
    502,
  );
  const roster = structuredClone(snapshot);
  const defaultGroup = roster.default[groupId] || {};
  const override = roster.byDate?.[today]?.[groupId] || {};
  const source =
    data.scope === "today" && Object.hasOwn(override, key)
      ? override[key]
      : defaultGroup[key];
  return { roster, groupId, key, source };
}
function saveTier(
  target: ReturnType<typeof editableTier>,
  scope: unknown,
  today: string,
  updated: unknown,
) {
  const { roster, groupId, key } = target;
  if (scope === "today") {
    roster.byDate ||= {};
    roster.byDate[today] ||= {};
    roster.byDate[today][groupId] ||= {};
    roster.byDate[today][groupId][key] = updated;
  } else {
    roster.default[groupId] ||= {};
    roster.default[groupId][key] = updated;
  }
  return roster;
}
/** Edit one notification tier without altering unrelated roster sections. */
export function changeNotificationMember(
  snapshot: any,
  data: Record<string, unknown>,
  action: "add" | "remove",
  today: string,
) {
  const target = editableTier(snapshot, data, today),
    { source } = target;
  const userId = text(data.userId, "人员 ID", 128);
  requireValue(!userId.startsWith("@"), "广播对象不能作为个人添加或移除");
  requireValue(
    mode(source) === "people",
    "该级别使用 @所有人或特殊配置，请在源系统调整",
  );
  const members = structuredClone(source || []);
  const matches = members.filter((p: any) => p.userid === userId);
  if (action === "add") {
    requireValue(matches.length === 0, "该人员已在本级通知名单中", 409);
    requireValue(members.length < 200, "本级通知人数已达上限");
    const name = text(data.name, "姓名", 100);
    members.push({ userid: userId, name });
  } else
    requireValue(matches.length === 1, "本级人员不存在或重复，请刷新核对", 409);
  const updated =
    action === "remove"
      ? members.filter((p: any) => p.userid !== userId)
      : members;
  return saveTier(target, data.scope, today, updated);
}

/** L3 can explicitly switch between department broadcast and selected people. */
export function changeNotificationMode(
  snapshot: any,
  data: Record<string, unknown>,
  today: string,
) {
  requireValue(data.tier === 3, "仅 L3 支持通知方式切换");
  requireValue(data.mode === "all" || data.mode === "people", "通知方式无效");
  const target = editableTier(snapshot, data, today);
  requireValue(mode(target.source) !== "special", "特殊通知配置请在源系统调整");
  requireValue(Array.isArray(data.members), "通知名单无效");
  if (data.mode === "all") {
    requireValue(data.members.length === 0, "全体通知不能同时指定人员");
    return saveTier(target, data.scope, today, "@ALL");
  }
  requireValue(
    data.members.length > 0 && data.members.length <= 200,
    "请选择 1–200 位通知人员",
  );
  const seen = new Set<string>();
  const members = data.members.map((item: unknown) => {
    requireValue(record(item), "人员信息无效");
    const person = item as Record<string, unknown>;
    const userId = text(person.userId, "人员 ID", 128),
      name = text(person.name, "姓名", 100);
    requireValue(
      !userId.startsWith("@") && !seen.has(userId),
      "人员 ID 重复或包含广播对象",
    );
    seen.add(userId);
    const existing = Array.isArray(target.source)
      ? target.source.find((p: any) => p.userid === userId)
      : undefined;
    return { ...existing, userid: userId, name };
  });
  return saveTier(target, data.scope, today, members);
}
