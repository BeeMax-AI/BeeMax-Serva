import { AppError, requireValue } from "./errors.ts";
export interface McpConfig {
  url: string;
  tenantId: string;
  tenantName: string;
  referenceLabel?: string;
}
export class McpClient {
  private sequence = 0;
  private session = "";
  private ready?: Promise<void>;
  tools = new Set<string>();
  constructor(private config: McpConfig) {
    const u = new URL(config.url);
    requireValue(
      u.protocol === "https:" ||
        (u.protocol === "http:" &&
          ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname)),
      "MCP 连接需要 HTTPS（本机测试除外）",
    );
    requireValue(
      !u.username && !u.password && !!config.tenantId && !!config.tenantName,
      "MCP 配置无效",
    );
  }
  private async rpc(
    method: string,
    params: unknown,
    notification = false,
    timeoutMs = 20000,
  ): Promise<any> {
    const id = ++this.sequence;
    try {
      const response = await fetch(this.config.url, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          "MCP-Protocol-Version": "2024-11-05",
          ...(this.session ? { "Mcp-Session-Id": this.session } : {}),
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          ...(notification ? {} : { id }),
          method,
          params,
        }),
      });
      if (!response.ok) throw new Error("upstream");
      const session = response.headers.get("mcp-session-id");
      if (session) this.session = session;
      if (notification) {
        await response.body?.cancel();
        return;
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error("body");
      let buffer = "",
        size = 0;
      const decoder = new TextDecoder();
      const sse = response.headers
        .get("content-type")
        ?.includes("text/event-stream");
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (value) {
            size += value.byteLength;
            if (size > 8_000_000) throw new Error("size");
            buffer += decoder.decode(value, { stream: true });
          }
          if (sse) {
            buffer = buffer.replace(/\r\n/g, "\n");
            let boundary;
            while ((boundary = buffer.indexOf("\n\n")) >= 0) {
              const event = buffer.slice(0, boundary);
              buffer = buffer.slice(boundary + 2);
              const data = event
                .split("\n")
                .filter((x) => x.startsWith("data:"))
                .map((x) => x.slice(5).trimStart())
                .join("\n");
              if (!data) continue;
              const result = JSON.parse(data);
              if (result.id === id) return this.result(result);
            }
          }
          if (done) break;
        }
        if (sse) throw new Error("incomplete");
        const result = JSON.parse(buffer);
        if (result.id !== id) throw new Error("id");
        return this.result(result);
      } finally {
        await reader.cancel().catch(() => {});
      }
    } catch {
      // Upstream errors may contain the credential-bearing URL or customer data.
      throw new AppError(
        502,
        "MCP_UNAVAILABLE",
        "MCP 请求未成功，请检查连接状态；未切换到演示数据。",
      );
    }
  }
  private result(value: any) {
    if (value.error || !("result" in value)) throw new Error("rpc");
    return value.result;
  }
  private discovering?: Promise<void>;
  toolsCheckedAt = 0;
  async initialize() {
    if (!this.ready)
      this.ready = (async () => {
        await this.rpc("initialize", {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "qianfeng-service-platform", version: "0.1.0" },
        });
        await this.rpc("notifications/initialized", {}, true);
      })().catch((error) => {
        this.ready = undefined;
        throw error;
      });
    await this.ready;
    await this.refreshTools();
  }
  async refreshTools(force = false) {
    if (!force && Date.now() - this.toolsCheckedAt < 60_000) return;
    if (!this.discovering)
      this.discovering = (async () => {
        let cursor: string | undefined;
        const names = new Set<string>();
        for (let page = 0; page < 20; page++) {
          const result = await this.rpc("tools/list", cursor ? { cursor } : {});
          if (
            !Array.isArray(result.tools) ||
            result.tools.some((t: any) => typeof t?.name !== "string")
          )
            throw new AppError(502, "MCP_SCHEMA", "MCP 工具清单格式无效");
          for (const t of result.tools) names.add(t.name);
          cursor = result.nextCursor;
          if (!cursor) {
            this.tools = names;
            this.toolsCheckedAt = Date.now();
            return;
          }
        }
        throw new AppError(502, "MCP_SCHEMA", "MCP 工具清单分页过多");
      })().finally(() => {
        this.discovering = undefined;
      });
    await this.discovering;
  }
  async call(
    name: string,
    args: Record<string, unknown> = {},
    timeoutMs = 20000,
  ): Promise<any> {
    await this.initialize();
    if (!this.tools.has(name))
      throw new AppError(
        503,
        "MCP_TOOL_MISSING",
        `当前 MCP 未提供 ${name} 工具`,
      );
    const result = await this.rpc(
      "tools/call",
      { name, arguments: args },
      false,
      timeoutMs,
    );
    if (result.isError)
      throw new AppError(
        502,
        "MCP_TOOL_ERROR",
        "MCP 工具未完成操作，请核对远端状态。",
      );
    if (result.structuredContent) return result.structuredContent;
    const content = result.content
      ?.filter((x: any) => x.type === "text")
      .map((x: any) => x.text)
      .join("\n");
    try {
      return JSON.parse(content);
    } catch {
      throw new AppError(
        502,
        "MCP_SCHEMA",
        "MCP 返回内容格式不符合已确认的接口契约",
      );
    }
  }
}
