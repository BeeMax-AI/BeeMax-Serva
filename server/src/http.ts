import { readConnections, connectionCommand } from "./connections.ts";
import { qiweConnection, saveQiweConnection } from "./qiwe.ts";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import type { Actor, Command, Bootstrap } from "../../shared/domain.ts";
import { McpProvider } from "./mcp-provider.ts";
import type { McpConfig } from "./mcp-client.ts";
import { Store } from "./store.ts";
import {
  LocalProvider,
  PendingMcpProvider,
  type DataProvider,
} from "./provider.ts";
import { AnalysisService, aiConfigured } from "./ai.ts";
import { McpAiService } from "./mcp-ai.ts";
import { AppError, requireValue } from "./errors.ts";
import { metrics } from "./metrics.ts";
import { businessDate, addDays, validDate } from "./dates.ts";
async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  requireValue(
    req.headers["content-type"]?.startsWith("application/json"),
    "请求须使用 JSON",
    415,
  );
  let length = 0,
    chunks: Buffer[] = [];
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 65536) throw new AppError(413, "BODY_TOO_LARGE", "请求过大");
    chunks.push(chunk);
  }
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString());
    requireValue(
      data && typeof data === "object" && !Array.isArray(data),
      "JSON 须为对象",
    );
    return data;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(400, "INVALID_JSON", "JSON 格式错误");
  }
}
function send(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
}
export function createApp(
  store: Store,
  root = resolve("."),
  mode = process.env.DATA_PROVIDER || "local",
  mcpConfig?: McpConfig,
) {
  const provider: DataProvider =
      mode === "mcp"
        ? mcpConfig
          ? new McpProvider(store, mcpConfig)
          : new PendingMcpProvider()
        : new LocalProvider(store),
    analysis =
      provider instanceof McpProvider
        ? new McpAiService(provider)
        : provider instanceof LocalProvider
          ? new AnalysisService(provider)
          : null,
    attempts = new Map<string, { count: number; until: number }>();
  const server = createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    try {
      const url = new URL(req.url || "/", "http://localhost"),
        pathname = url.pathname;
      if (pathname === "/api/health") {
        send(res, 200, {
          ok: true,
          mode: provider.mode,
          mcpReady: provider instanceof McpProvider,
        });
        return;
      }
      if (pathname.startsWith("/api/")) {
        const method = req.method || "GET",
          mutable = !["GET", "HEAD"].includes(method);
        if (mutable) {
          const origin = req.headers.origin,
            expected =
              process.env.APP_PUBLIC_URL || `http://${req.headers.host}`;
          requireValue(origin === expected, "来源校验失败", 403);
        }
        const token =
            (req.headers.cookie || "")
              .split(";")
              .map((s) => s.trim())
              .find((s) => s.startsWith("qf_session="))
              ?.slice(11) || "",
          actor = store.session(token);
        if (pathname === "/api/login" && method === "POST") {
          const key = req.socket.remoteAddress || "unknown",
            entry = attempts.get(key);
          if (entry && entry.until > Date.now() && entry.count >= 10)
            throw new AppError(
              429,
              "LOGIN_LIMIT",
              "尝试过多，请 10 分钟后重试",
            );
          const data = await body(req);
          requireValue(
            typeof data.username === "string" &&
              typeof data.password === "string" &&
              data.username.length <= 100 &&
              data.password.length <= 200,
            "账号或密码格式无效",
          );
          const account = store.authenticate(data.username, data.password);
          if (!account) {
            attempts.set(key, {
              count: entry && entry.until > Date.now() ? entry.count + 1 : 1,
              until: Date.now() + 600000,
            });
            throw new AppError(401, "INVALID_LOGIN", "账号或密码错误");
          }
          attempts.delete(key);
          res.setHeader(
            "Set-Cookie",
            `qf_session=${store.createSession(account)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${process.env.SESSION_SECURE === "true" ? "; Secure" : ""}`,
          );
          send(res, 200, { actor: account });
          return;
        }
        if (!actor) throw new AppError(401, "UNAUTHENTICATED", "请登录后继续");
        if (pathname === "/api/logout" && method === "POST") {
          store.revokeSession(token);
          res.setHeader(
            "Set-Cookie",
            "qf_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
          );
          send(res, 200, { ok: true });
          return;
        }
        if (pathname === "/api/connections" && method === "GET") {
          send(res, 200, readConnections(store, actor.tenantId));
          return;
        }
        if (pathname === "/api/connections/commands" && method === "POST") {
          send(
            res,
            200,
            connectionCommand(
              store,
              actor,
              (await body(req)) as unknown as Command,
            ),
          );
          return;
        }
        if (pathname === "/api/qiwe/connection") {
          if (method === "GET") send(res, 200, qiweConnection(store, actor));
          else if (method === "POST")
            send(res, 200, saveQiweConnection(store, actor, await body(req)));
          else
            throw new AppError(405, "METHOD_NOT_ALLOWED", "不支持此请求方式");
          return;
        }
        if (pathname === "/api/commands" && method === "POST") {
          send(
            res,
            200,
            await provider.command(
              actor,
              (await body(req)) as unknown as Command,
            ),
          );
          return;
        }
        if (pathname === "/api/reports" && method === "POST") {
          if (!analysis)
            throw new AppError(
              503,
              "MCP_NOT_CONFIGURED",
              "尚未配置分析数据接口",
            );
          const data = await body(req);
          requireValue(
            typeof data.requestId === "string" && data.requestId.length <= 100,
            "请求标识无效",
          );
          send(
            res,
            analysis instanceof McpAiService ? 202 : 201,
            await analysis.generate(
              actor,
              data,
              actor.id + ":" + data.requestId,
            ),
          );
          return;
        }
        if (pathname === "/api/chat" && method === "POST") {
          if (!analysis)
            throw new AppError(503, "MCP_NOT_CONFIGURED", "尚未配置查询接口");
          send(res, 200, await analysis.chat(actor, await body(req)));
          return;
        }
        if (pathname.startsWith("/api/analysis-tasks/") && method === "GET") {
          requireValue(
            analysis instanceof McpAiService,
            "当前未接入 MCP 分析任务",
            404,
          );
          send(
            res,
            200,
            await analysis.getTask(
              actor,
              decodeURIComponent(pathname.slice("/api/analysis-tasks/".length)),
            ),
          );
          return;
        }
        if (pathname === "/api/analysis-tasks" && method === "GET") {
          requireValue(
            analysis instanceof McpAiService && provider instanceof McpProvider,
            "当前未接入 MCP 分析任务",
            404,
          );
          send(res, 200, {
            tasks: analysis.listTasks(actor),
            reports: provider.readDashboard(actor).reports,
          });
          return;
        }
        if (pathname.startsWith("/api/mcp/") && method === "GET") {
          requireValue(
            provider instanceof McpProvider,
            "当前没有 MCP 数据连接",
            503,
          );
          send(
            res,
            200,
            await provider.query(
              actor,
              pathname.slice("/api/mcp/".length),
              url.searchParams,
            ),
          );
          return;
        }
        if (pathname.startsWith("/api/tickets/") && method === "GET") {
          const ticket =
            provider instanceof LocalProvider
              ? await provider.getTicket(
                  actor,
                  decodeURIComponent(pathname.slice(13)),
                )
              : undefined;
          requireValue(ticket, "工单不存在", 404);
          send(res, 200, ticket);
          return;
        }
        const w = await provider.read(actor);
        if (pathname === "/api/bootstrap" && method === "GET") {
          const { conversations, ...workspace } = w;
          const capabilities =
            analysis instanceof McpAiService
              ? await analysis.capabilities(actor)
              : {
                  chat: aiConfigured(),
                  analysis: aiConfigured(),
                  channel: "direct" as const,
                };
          const connections = readConnections(store, actor.tenantId);
          workspace.audit = [...connections.audit, ...workspace.audit].sort(
            (a, b) => b.at.localeCompare(a.at),
          );
          const result: Bootstrap = {
            connections,
            qiwe: qiweConnection(store, actor),
            actor,
            mode: provider.mode,
            aiConfigured: capabilities.chat || capabilities.analysis,
            aiCapabilities: capabilities,
            analysisTasks:
              analysis instanceof McpAiService ? analysis.listTasks(actor) : [],
            workspace,
            conversations: conversations[actor.id] || [],
            today: businessDate(),
            metrics: metrics(w, businessDate(), businessDate()),
          };
          send(res, 200, result);
          return;
        }
        if (pathname === "/api/metrics" && method === "GET") {
          const start =
              url.searchParams.get("start") || addDays(businessDate(), -6),
            end = url.searchParams.get("end") || businessDate();
          requireValue(
            validDate(start) &&
              validDate(end) &&
              start <= end &&
              (Date.parse(end) - Date.parse(start)) / 86400000 <= 3660,
            "日期范围无效",
          );
          send(res, 200, metrics(w, start, end));
          return;
        }
        if (pathname === "/api/messages" && w.integration)
          throw new AppError(
            503,
            "MCP_TOOL_MISSING",
            "当前 MCP 未提供消息日志接口",
          );
        if (
          (pathname === "/api/tickets" || pathname === "/api/messages") &&
          method === "GET"
        ) {
          const q = (url.searchParams.get("q") || "").toLowerCase(),
            status = url.searchParams.get("status"),
            group = url.searchParams.get("group"),
            account = url.searchParams.get("account"),
            page = Math.max(1, Number(url.searchParams.get("page")) || 1),
            size = Math.min(
              100,
              Math.max(1, Number(url.searchParams.get("size")) || 20),
            );
          const rows = pathname.endsWith("tickets")
            ? w.tickets.filter(
                (t) =>
                  (!status || t.status === status) &&
                  (!group || t.groupId === group) &&
                  [t.id, t.subject, t.reference]
                    .join(" ")
                    .toLowerCase()
                    .includes(q),
              )
            : w.messages.filter(
                (m) =>
                  (!status || m.status === status) &&
                  (!account || m.accountId === account) &&
                  [m.id, m.content, m.contact, m.chatId, m.ticketId]
                    .join(" ")
                    .toLowerCase()
                    .includes(q),
              );
          send(res, 200, {
            items: rows.slice((page - 1) * size, page * size),
            total: rows.length,
            page,
            size,
          });
          return;
        }
        throw new AppError(404, "NOT_FOUND", "接口不存在");
      }
      requireValue(
        req.method === "GET" || req.method === "HEAD",
        "不支持的请求方法",
        405,
      );
      let base: string, relative: string;
      if (pathname.startsWith("/dist/")) {
        base = resolve(root, "client/dist");
        relative = pathname.slice(6);
      } else if (pathname.startsWith("/assets/")) {
        base = resolve(root, "design/gongdan-dashboard/assets");
        relative = pathname.slice(8);
      } else if (pathname === "/style.css") {
        base = resolve(root, "design/gongdan-dashboard");
        relative = "style.css";
      } else if (pathname === "/app.css") {
        base = resolve(root, "client");
        relative = "app.css";
      } else if (pathname === "/" || pathname === "/index.html") {
        base = resolve(root, "client");
        relative = "index.html";
      } else throw new AppError(404, "NOT_FOUND", "页面不存在");
      const file = resolve(base, decodeURIComponent(relative));
      requireValue(file.startsWith(base + sep), "文件路径无效", 403);
      let bytes: Buffer;
      try {
        bytes = await readFile(file);
      } catch {
        throw new AppError(
          404,
          "ASSET_NOT_FOUND",
          "应用尚未构建，请运行 npm run build",
        );
      }
      const mime: Record<string, string> = {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".svg": "image/svg+xml",
      };
      res.writeHead(200, {
        "Content-Type": mime[extname(file)] || "application/octet-stream",
        "Cache-Control": "no-cache",
      });
      res.end(req.method === "HEAD" ? undefined : bytes);
    } catch (error) {
      if (res.headersSent) {
        res.end();
        return;
      }
      if (error instanceof AppError)
        send(res, error.status, {
          error: { code: error.code, message: error.message },
        });
      else {
        console.error(
          "请求失败",
          error instanceof Error ? error.name : "Error",
        );
        send(res, 500, {
          error: {
            code: "INTERNAL_ERROR",
            message: "服务暂时不可用，请稍后重试。",
          },
        });
      }
    }
  });
  return { server, provider, analysis };
}
