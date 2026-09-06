import { test } from "node:test";
import assert from "node:assert/strict";
import { metrics } from "../server/src/metrics.ts";
import { seed } from "../server/src/seed.ts";
test("year-long trends scan ticket dates once rather than once per calendar day", () => {
  const w = seed("metrics-perf");
  let reads = 0;
  const original = w.tickets;
  w.tickets = Array.from({ length: 1000 }, (_, i) => {
    const t = original[i % original.length];
    return {
      ...t,
      id: "row-" + i,
      get createdAt() {
        reads++;
        return t.createdAt;
      },
    };
  });
  const r = metrics(w, "2026-01-01", "2026-12-31");
  assert.equal(r.trend.length, 365);
  assert.equal(r.created, 1000);
  assert.ok(
    reads <= 3000,
    `Ticket timestamps read ${reads} times; expected linear work`,
  );
});
test("metrics preserve UTC+8 boundaries, resolution and date buckets", () => {
  const w = seed("metrics-boundary"),
    base = w.tickets[0];
  w.tickets = [
    {
      ...base,
      id: "1",
      createdAt: "2026-09-05T15:59:00Z",
      acceptedAt: "2026-09-05T16:01:00Z",
      closedAt: "2026-09-05T16:03:00Z",
      status: "CLOSED",
    },
    {
      ...base,
      id: "2",
      createdAt: "2026-09-05T16:00:00Z",
      acceptedAt: null,
      closedAt: null,
      status: "NO_ACCEPT",
    },
  ];
  const m = metrics(w, "2026-09-06", "2026-09-06");
  assert.equal(m.created, 1);
  assert.equal(m.closed, 1);
  assert.equal(m.avgResponse, null);
  assert.equal(m.avgResolution, 4);
  assert.equal(m.open, 1);
  assert.equal(m.waiting, 1);
  assert.deepEqual(m.trend, [{ date: "2026-09-06", created: 1, closed: 1 }]);
});
