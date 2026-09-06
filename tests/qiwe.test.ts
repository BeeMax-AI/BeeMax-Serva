import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/src/store.ts";
import { createApp } from "../server/src/http.ts";
import type { Actor } from "../shared/domain.ts";

for (const mode of ["local", "mcp"])
  test(`QiWe is independent in ${mode} mode, tenant scoped and encrypted`, async () => {
    const dir = mkdtempSync(join(tmpdir(), "qf-qiwe-")),
      store = new Store(dir);
    store.initialize();
    const app = createApp(store, process.cwd(), mode);
    await new Promise<void>((resolve) =>
      app.server.listen(0, "127.0.0.1", resolve),
    );
    const base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
    const cookies: Record<string, string> = {};
    for (const [id, role, tenantId] of [
      ["owner", "owner", "demo"],
      ["admin", "admin", "demo"],
      ["viewer", "viewer", "demo"],
      ["other", "admin", "other"],
    ])
      cookies[id] =
        "qf_session=" +
        store.createSession({ id, name: id, role, tenantId } as Actor);
    const req = (user: string, data?: unknown, origin = base) =>
      fetch(base + "/api/qiwe/connection", {
        method: data === undefined ? "GET" : "POST",
        headers: {
          Cookie: cookies[user] || "",
          Origin: origin,
          "Content-Type": "application/json",
        },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      });
    try {
      assert.equal((await req("none")).status, 401);
      assert.equal(
        (await req("admin", { token: "test", expectedRevision: 0 })).status,
        403,
      );
      assert.equal(
        (await req("viewer", { token: "test", expectedRevision: 0 })).status,
        403,
      );
      assert.equal(
        (
          await req(
            "owner",
            { token: "test", expectedRevision: 0 },
            "https://foreign.invalid",
          )
        ).status,
        403,
      );
      const saved = await req("owner", {
        token: "qiwe-secret-token",
        account: "manager-account",
        password: " password with spaces ",
        expectedRevision: 0,
      });
      assert.equal(saved.status, 200);
      const state = await saved.json();
      assert.equal(state.revision, 1);
      assert.equal(state.tokenSaved, true);
      assert.equal(state.passwordSaved, true);
      assert.equal(state.accountMask, "m****");
      assert.ok(state.updatedAt);
      assert.equal(state.connectionStatus, "unverified");
      assert.equal(state.canTest, false);
      assert.ok(!JSON.stringify(state).includes("qiwe-secret-token"));
      assert.equal(store.getSecret("demo").password, " password with spaces ");
      assert.ok(
        !JSON.stringify(
          store.db.prepare("SELECT * FROM secrets").all(),
        ).includes("qiwe-secret-token"),
      );
      assert.ok(
        !JSON.stringify(store.read("demo")).includes("qiwe-secret-token"),
      );
      assert.equal((await (await req("other")).json()).tokenSaved, false);
      assert.equal((await (await req("viewer")).json()).tokenSaved, true);
      assert.equal(
        (await req("owner", { token: "stale", expectedRevision: 0 })).status,
        409,
      );
      assert.equal(
        (
          await req("owner", {
            token: "new-token",
            password: "",
            expectedRevision: 1,
          })
        ).status,
        200,
      );
      assert.equal(store.getSecret("demo").password, " password with spaces ");
      const reopened = new Store(dir);
      assert.equal(reopened.getSecret("demo").token, "new-token");
      reopened.close();
      assert.equal(
        (await req("owner", { token: "", expectedRevision: 2 })).status,
        400,
      );
      assert.equal(
        (await req("owner", { token: " ", expectedRevision: 2 })).status,
        400,
      );
      assert.equal(
        (await req("owner", { token: 123, expectedRevision: 2 })).status,
        400,
      );
      assert.equal(
        (
          await req("owner", {
            token: "valid",
            account: "x".repeat(101),
            expectedRevision: 2,
          })
        ).status,
        400,
      );
      assert.equal(
        store.getSecret("demo").token,
        "new-token",
        "invalid partial updates must not be saved",
      );
      if (mode === "local") {
        const boot = await (
          await fetch(base + "/api/bootstrap", {
            headers: { Cookie: cookies.owner },
          })
        ).json();
        assert.equal(boot.qiwe.revision, 2);
        assert.equal(boot.qiwe.tokenSaved, true);
      }
    } finally {
      await new Promise<void>((resolve) => app.server.close(() => resolve()));
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

test("MCP-only tenants can manage QiWe without creating a sample business workspace", async () => {
  const { qiweConnection, saveQiweConnection, qiweAudit } =
    await import("../server/src/qiwe.ts");
  const dir = mkdtempSync(join(tmpdir(), "qf-qiwe-standalone-"));
  const store = new Store(dir);
  const actor: Actor = {
    id: "custom-owner",
    name: "平台管理员",
    role: "owner",
    tenantId: "custom",
  };
  try {
    assert.equal(qiweConnection(store, actor).updatedAt, null);
    const saved = saveQiweConnection(store, actor, {
      token: "isolated-token",
      expectedRevision: 0,
    });
    assert.equal(saved.tokenSaved, true);
    assert.equal(saved.workspaceRevision, null);
    assert.equal(qiweAudit(store, "custom").length, 1);
    assert.equal(qiweAudit(store, "another").length, 0);
    assert.deepEqual(store.tenants(), []);
    assert.equal(qiweConnection(store, actor).revision, 1);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
