import { test } from "node:test";
import assert from "node:assert/strict";
import {
  notificationTiers,
  changeNotificationMember,
} from "../server/src/roster-notifications.ts";
const today = "2026-09-07";
const snapshot = () => ({
  default: {
    group: {
      l1: [{ userid: "one", name: "一线", extra: "keep" }],
      l2: [{ userid: "two", name: "二线" }],
      l3: "@ALL",
      l4: [{ userid: "last", name: "兜底" }],
    },
  },
  byDate: {
    [today]: {
      group: { l2: [{ userid: "temp", name: "临时", extra: "date" }] },
    },
  },
  specialists: { wifi: ["keep"] },
  buildingRouting: [{ unknown: "keep" }],
});
test("notification view distinguishes broadcast, default and effective date overrides", () => {
  const tiers = notificationTiers(
    snapshot(),
    [{ id: "group", name: "测试组" }],
    today,
  );
  assert.equal(tiers.length, 4);
  assert.equal(tiers[2].effectiveMode, "all");
  assert.equal(tiers[1].defaults[0].userId, "two");
  assert.equal(tiers[1].effective[0].userId, "temp");
  assert.equal(tiers[0].overridden, false);
  assert.equal(tiers[1].overridden, true);
});
test("today add and remove clone only the affected tier and preserve raw roster metadata", () => {
  const before = snapshot();
  let after = changeNotificationMember(
    before,
    {
      scope: "today",
      date: today,
      groupId: "group",
      tier: 1,
      userId: "new",
      name: "新增",
    },
    "add",
    today,
  );
  assert.deepEqual(before, snapshot());
  assert.deepEqual(after.default, before.default);
  assert.deepEqual(after.byDate[today].group.l1, [
    ...before.default.group.l1,
    { userid: "new", name: "新增" },
  ]);
  assert.deepEqual(after.byDate[today].group.l2, before.byDate[today].group.l2);
  assert.deepEqual(after.buildingRouting, before.buildingRouting);
  assert.deepEqual(after.specialists, before.specialists);
  after = changeNotificationMember(
    after,
    { scope: "today", date: today, groupId: "group", tier: 1, userId: "one" },
    "remove",
    today,
  );
  assert.deepEqual(after.byDate[today].group.l1, [
    { userid: "new", name: "新增" },
  ]);
  assert.equal(after.default.group.l1[0].extra, "keep");
});
test("default edits preserve today overrides and reject invalid broadcast or expired-day mutations", () => {
  const before = snapshot();
  const data = { scope: "default", groupId: "group", tier: 2, userId: "two" };
  const after = changeNotificationMember(before, data, "remove", today);
  assert.deepEqual(after.default.group.l2, []);
  assert.deepEqual(after.byDate, before.byDate);
  assert.throws(
    () =>
      changeNotificationMember(
        before,
        { ...data, userId: "temp" },
        "remove",
        today,
      ),
    /不存在/,
  );
  assert.throws(
    () =>
      changeNotificationMember(before, { ...data, name: "重复" }, "add", today),
    /已在/,
  );
  assert.throws(
    () =>
      changeNotificationMember(
        before,
        { ...data, tier: 3, userId: "new", name: "新" },
        "add",
        today,
      ),
    /特殊配置/,
  );
  assert.throws(
    () =>
      changeNotificationMember(
        before,
        { ...data, userId: "@ALL", name: "广播" },
        "add",
        today,
      ),
    /广播对象/,
  );
  assert.throws(
    () =>
      changeNotificationMember(
        before,
        { ...data, scope: "today", date: "2026-09-06" },
        "remove",
        today,
      ),
    /日期已变化/,
  );
  assert.throws(
    () =>
      changeNotificationMember(before, { ...data, tier: 5 }, "remove", today),
    /1–4/,
  );
});

test("malformed group and date containers cannot produce a silent no-op write", () => {
  for (const roster of [
    { default: { group: [] } },
    { default: { group: null } },
    { default: { group: {} }, byDate: [] },
    { default: { group: {} }, byDate: { [today]: [] } },
    { default: { group: {} }, byDate: { [today]: { group: [] } } },
  ]) {
    assert.equal(
      notificationTiers(roster, [{ id: "group", name: "组" }], today)[0]
        .effectiveMode,
      "special",
    );
    assert.throws(
      () =>
        changeNotificationMember(
          roster,
          {
            scope: "today",
            date: today,
            groupId: "group",
            tier: 1,
            userId: "new",
            name: "新人",
          },
          "add",
          today,
        ),
      /结构异常/,
    );
  }
  assert.throws(
    () =>
      changeNotificationMember(
        { default: { group: [] } },
        {
          scope: "default",
          groupId: "group",
          tier: 1,
          userId: "new",
          name: "新人",
        },
        "add",
        today,
      ),
    /结构异常/,
  );
});
