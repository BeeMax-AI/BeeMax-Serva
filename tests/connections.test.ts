import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../server/src/store.ts";
import { createApp } from "../server/src/http.ts";
import type { Actor, ConnectionWorkspace } from "../shared/domain.ts";

for (const mode of ["local", "mcp"])
  test(`connection configuration persists independently in ${mode} mode`, async () => {
    const dir = mkdtempSync(join(tmpdir(), "qf-connections-")),
      store = new Store(dir);
    store.initialize();
    const app = createApp(store, process.cwd(), mode);
    await new Promise<void>((r) => app.server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
    const cookies: Record<string, string> = {};
    for (const [id, role, tenantId] of [
      ["admin", "admin", "demo"],
      ["viewer", "viewer", "demo"],
      ["other", "admin", "other"],
    ])
      cookies[id] =
        "qf_session=" +
        store.createSession({ id, name: id, role, tenantId } as Actor);
    const req = (user: string, data?: unknown, origin = base) =>
      fetch(base + "/api/connections" + (data ? "/commands" : ""), {
        method: data ? "POST" : "GET",
        headers: {
          Cookie: cookies[user] || "",
          Origin: origin,
          "Content-Type": "application/json",
        },
        ...(data ? { body: JSON.stringify(data) } : {}),
      });
    const cmd = (type: string, data: Record<string, unknown>, rev: number) => ({
      type,
      data,
      expectedRevision: rev,
      requestId: randomUUID(),
    });
    const read = async (user = "admin") =>
      (await (await req(user)).json()) as ConnectionWorkspace;
    try {
      assert.equal((await req("none")).status, 401);
      const original = await read();
      assert.deepEqual(
        original.accounts,
        [],
        "prototype/local sample accounts must not migrate as live accounts",
      );
      assert.deepEqual(original.messages, []);
      const add = cmd(
        "account.save",
        {
          name: "客服服务号",
          company: "示例公司",
          status: "online",
          login: "pretend",
        },
        original.revision,
      );
      assert.equal((await req("viewer", add)).status, 403);
      assert.equal(
        (await req("admin", add, "https://foreign.invalid")).status,
        403,
      );
      const saved = await req("admin", add);
      assert.equal(saved.status, 200);
      const first = (await saved.json()) as ConnectionWorkspace,
        account = first.accounts[0];
      assert.equal(account.status, "offline");
      assert.equal(account.login, "未登录");
      assert.equal((await req("admin", add)).status, 200);
      assert.equal(
        (await read()).accounts.length,
        1,
        "retry must not duplicate account",
      );
      assert.equal(
        (await req("admin", { ...add, data: { ...add.data, name: "changed" } }))
          .status,
        409,
      );
      assert.equal(
        (
          await req(
            "admin",
            cmd(
              "account.save",
              { id: account.id, name: "过期", company: "公司" },
              1,
            ),
          )
        ).status,
        409,
      );
      assert.equal(
        (
          await req(
            "other",
            cmd(
              "account.save",
              { id: account.id, name: "越权", company: "公司" },
              1,
            ),
          )
        ).status,
        404,
      );
      const group = cmd(
        "group.add",
        { accountId: account.id, chatId: "chat_123:long-id", name: "客服群" },
        first.revision,
      );
      assert.equal((await req("admin", group)).status, 200);
      let current = await read();
      assert.equal(current.accounts[0].groups.length, 1);
      assert.equal(
        (await req("admin", cmd("group.add", group.data, current.revision)))
          .status,
        409,
      );
      assert.equal(
        (
          await req(
            "admin",
            cmd(
              "group.add",
              { ...group.data, chatId: "<invalid>" },
              current.revision,
            ),
          )
        ).status,
        400,
      );
      const second = await req(
        "admin",
        cmd(
          "account.save",
          { name: "第二个账号", company: "公司" },
          current.revision,
        ),
      );
      current = await second.json();
      assert.equal(
        (
          await req(
            "admin",
            cmd(
              "group.add",
              { ...group.data, accountId: current.accounts[1].id },
              current.revision,
            ),
          )
        ).status,
        200,
        "same chat ID allowed under distinct account",
      );
      current = await read();
      assert.equal(
        (
          await req(
            "other",
            cmd(
              "group.remove",
              { accountId: account.id, chatId: "chat_123:long-id" },
              1,
            ),
          )
        ).status,
        404,
      );
      assert.equal(
        (
          await req(
            "admin",
            cmd(
              "group.remove",
              { accountId: account.id, chatId: "chat_123:long-id" },
              current.revision,
            ),
          )
        ).status,
        200,
      );
      current = await read();
      assert.equal(current.accounts[0].groups.length, 0);
      assert.equal(current.accounts[1].groups.length, 1);
      assert.ok(current.updatedAt);
      assert.ok(current.audit.every((a) => a.actor === "运营管理员"));
      assert.equal((await read("other")).accounts.length, 0);
      const another = new Store(dir);
      const { readConnections } = await import("../server/src/connections.ts");
      assert.equal(readConnections(another, "demo").accounts.length, 2);
      another.close();
      if (mode === "local") {
        const boot = await (
          await fetch(base + "/api/bootstrap", {
            headers: { Cookie: cookies.admin },
          })
        ).json();
        assert.equal(boot.connections.accounts.length, 2);
        assert.ok(
          boot.workspace.audit.some((a: any) => a.id === current.audit[0].id),
        );
      }
    } finally {
      await new Promise<void>((r) => app.server.close(() => r()));
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
