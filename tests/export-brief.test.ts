import { test } from "node:test";
import assert from "node:assert/strict";
import { state } from "../client/src/core.ts";
import { exportBrief } from "../client/src/export-brief.ts";
import { seed } from "../server/src/seed.ts";
import { metrics } from "../server/src/metrics.ts";
import type { Bootstrap } from "../shared/domain.ts";
const boot = (): Bootstrap => {
  const workspace = seed("demo");
  return {
    actor: { id: "admin", name: "Admin", role: "admin", tenantId: "demo" },
    mode: "local",
    aiConfigured: false,
    workspace,
    connections: {
      revision: 0,
      accounts: [],
      messages: [],
      audit: [],
      updatedAt: null,
      channelStatus: "not_connected",
    },
    conversations: [],
    today: "2026-09-07",
    metrics: metrics(workspace, "2026-09-01", "2026-09-07"),
  };
};
test("late PDF results and errors are discarded after login identity changes", async () => {
  const originalFetch = globalThis.fetch;
  const originalDocument = Object.getOwnPropertyDescriptor(
    globalThis,
    "document",
  );
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previous = state.boot;
  const events: string[] = [];
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      querySelector: () => null,
      createElement: () => {
        throw new Error("must not download old PDF");
      },
    },
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { dispatchEvent: (e: Event) => events.push(e.type) },
  });
  try {
    for (const status of [200, 401]) {
      state.boot = boot();
      let complete!: (r: Response) => void;
      globalThis.fetch = () =>
        new Promise((r) => {
          complete = r;
        });
      const pending = exportBrief();
      state.boot = {
        ...boot(),
        actor: { ...boot().actor, id: "other", tenantId: "other" },
      };
      complete(
        new Response(status === 200 ? "%PDF-test" : "{}", {
          status,
          headers: {
            "Content-Type":
              status === 200 ? "application/pdf" : "application/json",
          },
        }),
      );
      await pending;
    }
    state.boot = boot();
    let release!: (blob: Blob) => void;
    const response = new Response("%PDF-test", {
      headers: { "Content-Type": "application/pdf" },
    });
    response.blob = () =>
      new Promise((r) => {
        release = r;
      });
    globalThis.fetch = async () => response;
    const pending = exportBrief();
    await Promise.resolve();
    state.boot = null;
    release(new Blob(["%PDF-test"]));
    await pending;
    assert.deepEqual(events, []);
  } finally {
    globalThis.fetch = originalFetch;
    state.boot = previous;
    for (const [name, descriptor] of [
      ["document", originalDocument],
      ["window", originalWindow],
    ] as const) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
