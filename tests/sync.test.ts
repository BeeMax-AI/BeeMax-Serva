import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SyncSchedule,
  readSyncMinutes,
  validSyncMinutes,
} from "../shared/sync.ts";
test("sync preferences default to five minutes and accept bounded custom intervals", () => {
  for (const value of [null, "", "garbage", "0", "1.5", "1441"])
    assert.equal(readSyncMinutes(value), 5);
  for (const minutes of [1, 5, 10, 17, 1440]) {
    assert.equal(readSyncMinutes(String(minutes)), minutes);
    assert.ok(validSyncMinutes(minutes));
  }
  assert.ok(!validSyncMinutes(Infinity));
});
test("automatic sync follows the selected interval, pauses for editing and avoids overlapping reads", async (t) => {
  let now = 0,
    calls = 0,
    blocked = false;
  t.mock.method(Date, "now", () => now);
  const schedule = new SyncSchedule(5);
  let finish!: () => void;
  const task = async () => {
    calls++;
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    return "synced" as const;
  };
  now = 299999;
  await schedule.tick(task, () => blocked);
  assert.equal(calls, 0);
  now = 300000;
  blocked = true;
  await schedule.tick(task, () => blocked);
  assert.equal(calls, 0);
  blocked = false;
  const running = schedule.tick(task, () => blocked);
  await schedule.tick(task, () => blocked);
  assert.equal(calls, 1);
  now = 301000;
  finish();
  await running;
  assert.equal(schedule.nextAt, 601000);
  schedule.configure(10);
  assert.equal(schedule.nextAt, 901000);
  schedule.configure(17);
  assert.equal(schedule.nextAt, 1321000);
});
test("failed sync waits for the next cycle, deferred results retry and invalid preferences retain the schedule", async (t) => {
  let now = 0;
  t.mock.method(Date, "now", () => now);
  const schedule = new SyncSchedule(5);
  now = 300000;
  await schedule.tick(
    async () => "failed",
    () => false,
  );
  assert.equal(schedule.nextAt, 600000);
  now = 600000;
  await schedule.tick(
    async () => "deferred",
    () => false,
  );
  assert.equal(schedule.nextAt, 600000);
  now = 601000;
  await schedule.tick(
    async () => {
      throw new Error("offline");
    },
    () => false,
  );
  assert.equal(schedule.nextAt, 901000);
  assert.throws(() => schedule.configure(0), /1–1440/);
  assert.equal(schedule.minutes, 5);
});
