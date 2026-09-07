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

/** Edit one notification tier, preserving raw person properties and all unrelated roster sections. */
export function changeNotificationMember(
  snapshot: any,
  data: Record<string, unknown>,
  action: "add" | "remove",
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
  const userId = text(data.userId, "人员 ID", 128);
  requireValue(
    userId !== "@ALL" && !userId.startsWith("@"),
    "广播对象不能作为个人添加或移除",
  );
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
  if (data.scope === "today") {
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
