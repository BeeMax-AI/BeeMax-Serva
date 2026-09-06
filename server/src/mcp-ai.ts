import { createHash, randomUUID } from "node:crypto";
import type {
  Actor,
  AnalysisTask,
  Conversation,
  Report,
} from "../../shared/domain.ts";
import { McpProvider } from "./mcp-provider.ts";
import { AppError, requireValue, text } from "./errors.ts";
import { businessDate, validDate, nextRun, planRange } from "./dates.ts";

type Operation = {
  id: string;
  actor: Actor;
  kind: "analysis" | "chat";
  request: string;
  input: Record<string, unknown>;
  fingerprint: string;
  remoteId?: string;
  task: AnalysisTask;
  nextPoll: number;
  planId?: string;
  runKey?: string;
  conversation?: Conversation;
  remoteReportId?: string;
};
const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const string = (value: unknown, max = 16000) =>
  typeof value === "string" ? value.slice(0, max) : "";
const object = (v: unknown): v is Record<string, any> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const list = (v: unknown): Record<string, any>[] =>
  Array.isArray(v) ? v.filter(object).slice(0, 100) : [];

/** Only this backend can translate local actor/session identifiers into MCP identifiers. */
export class McpAiService {
  private active = new Map<string, Promise<AnalysisTask>>();
  private chatting = new Set<string>();
  constructor(public provider: McpProvider) {
    provider.store.db.exec(`CREATE TABLE IF NOT EXISTS ai_operations(
      id TEXT PRIMARY KEY, tenant TEXT NOT NULL, actor TEXT NOT NULL,
      kind TEXT NOT NULL, request TEXT NOT NULL, data TEXT NOT NULL,
      UNIQUE(tenant,actor,kind,request));
      CREATE TABLE IF NOT EXISTS ai_conversations(
      tenant TEXT NOT NULL, actor TEXT NOT NULL, local_id TEXT NOT NULL,
      remote_id TEXT NOT NULL, PRIMARY KEY(tenant,actor,local_id));`);
  }
  private authorize(actor: Actor) {
    this.provider.readDashboard(actor);
  }
  private save(op: Operation) {
    this.provider.store.db
      .prepare(
        `INSERT INTO ai_operations VALUES(?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET data=excluded.data`,
      )
      .run(
        op.id,
        op.actor.tenantId,
        op.actor.id,
        op.kind,
        op.request,
        JSON.stringify(op),
      );
  }
  private find(
    actor: Actor,
    kind: string,
    request: string,
  ): Operation | undefined {
    const row = this.provider.store.db
      .prepare(
        "SELECT data FROM ai_operations WHERE tenant=? AND actor=? AND kind=? AND request=?",
      )
      .get(actor.tenantId, actor.id, kind, request) as
      { data: string } | undefined;
    return row && JSON.parse(row.data);
  }
  private owned(actor: Actor, id: string): Operation {
    this.authorize(actor);
    const row = this.provider.store.db
      .prepare("SELECT data FROM ai_operations WHERE id=? AND tenant=?")
      .get(id, actor.tenantId) as { data: string } | undefined;
    const op: Operation | undefined = row && JSON.parse(row.data);
    requireValue(
      op &&
        op.kind === "analysis" &&
        (op.actor.id === actor.id ||
          (op.actor.id === "scheduler" && actor.role !== "viewer")),
      "分析任务不存在",
      404,
    );
    return op;
  }
  private operations(actor: Actor): Operation[] {
    this.authorize(actor);
    return (
      this.provider.store.db
        .prepare(
          "SELECT data FROM ai_operations WHERE tenant=? AND kind='analysis' ORDER BY rowid DESC",
        )
        .all(actor.tenantId) as { data: string }[]
    )
      .map((r) => JSON.parse(r.data))
      .filter(
        (op: Operation) =>
          op.actor.id === actor.id ||
          (op.actor.id === "scheduler" && actor.role !== "viewer"),
      );
  }
  listTasks(actor: Actor): AnalysisTask[] {
    return this.operations(actor)
      .filter((op) => op.task.status !== "completed")
      .slice(0, 20)
      .map((op) => op.task);
  }
  async capabilities(actor: Actor) {
    this.authorize(actor);
    await this.provider.client.initialize();
    const tools = this.provider.client.tools;
    return {
      chat: tools.has("chat"),
      analysis: tools.has("create_analysis") && tools.has("get_analysis"),
      channel: "mcp" as const,
    };
  }
  async generate(
    actor: Actor,
    data: Record<string, unknown>,
    runKey: string = randomUUID(),
    planId?: string,
  ): Promise<AnalysisTask> {
    this.authorize(actor);
    requireValue(actor.role !== "viewer", "只读账号不能生成报告", 403);
    requireValue(
      validDate(data.start) &&
        validDate(data.end) &&
        data.start <= data.end &&
        data.end <= businessDate(),
      "分析日期范围无效",
    );
    requireValue(
      (Date.parse(data.end) - Date.parse(data.start)) / 86400000 <= 3660,
      "分析范围最多 3661 天",
    );
    const input = {
        start_date: data.start,
        end_date: data.end,
        timezone: "Asia/Shanghai",
        scope: "all",
        report_name: string(data.name, 60) || "自定义运营分析",
      },
      fingerprint = digest(input);
    let op = this.find(actor, "analysis", runKey);
    if (op)
      requireValue(
        op.fingerprint === fingerprint,
        "请求标识已用于其他分析参数",
        409,
      );
    else {
      requireValue(
        (await this.capabilities(actor)).analysis,
        "MCP 尚未提供完整的 AI 分析工具",
        503,
      );
      // Discovery yields; another request may have persisted this same operation.
      if (this.find(actor, "analysis", runKey))
        return this.generate(actor, data, runKey, planId);
      const id = randomUUID();
      op = {
        id,
        actor,
        kind: "analysis",
        request: runKey,
        input,
        fingerprint,
        nextPoll: 0,
        planId,
        runKey,
        task: {
          id,
          name: input.report_name,
          status: "queued",
          stage: "等待提交",
          retryAfterSeconds: 5,
        },
      };
      // Persist before network I/O; retries use this same opaque remote idempotency key.
      this.save(op);
    }
    return this.advance(op);
  }
  async getTask(actor: Actor, id: string) {
    return this.advance(this.owned(actor, id));
  }
  private advance(op: Operation): Promise<AnalysisTask> {
    if (
      ["completed", "failed"].includes(op.task.status) ||
      op.nextPoll > Date.now()
    )
      return Promise.resolve(op.task);
    const running = this.active.get(op.id);
    if (running) return running;
    const promise = this.poll(op).finally(() => this.active.delete(op.id));
    this.active.set(op.id, promise);
    return promise;
  }
  private async poll(op: Operation): Promise<AnalysisTask> {
    try {
      const result = op.remoteId
        ? await this.provider.client.call("get_analysis", {
            task_id: op.remoteId,
          })
        : await this.provider.client.call("create_analysis", {
            ...op.input,
            request_id: `qf:${op.id}`,
          });
      requireValue(
        object(result) &&
          typeof result.task_id === "string" &&
          (!op.remoteId || op.remoteId === result.task_id) &&
          ["queued", "running", "completed", "failed"].includes(result.status),
        "AI 分析返回格式不符合接口约定",
        502,
      );
      op.remoteId = result.task_id;
      const delay =
        typeof result.retry_after_seconds === "number" &&
        Number.isFinite(result.retry_after_seconds)
          ? Math.max(2, Math.min(60, result.retry_after_seconds))
          : 5;
      op.task = {
        ...op.task,
        status: result.status,
        stage:
          string(result.stage, 120) ||
          (
            {
              queued: "等待分析",
              running: "正在分析",
              completed: "已完成",
              failed: "分析失败",
            } as Record<string, string>
          )[result.status],
        retryAfterSeconds: delay,
      };
      delete op.task.error;
      if (result.status === "completed") {
        // A completed submission may only return report_id; fetch the full report on the next poll.
        if (!object(result.report)) {
          op.task.status = "running";
          op.task.stage = "正在读取报告";
        } else {
          const report = this.report(op, result.report);
          op.remoteReportId = result.report.report_id;
          const w = this.provider.readDashboard(op.actor);
          if (!w.reports.some((r) => r.id === report.id)) {
            w.reports.unshift(report);
            w.reports = w.reports.slice(0, 300);
            w.audit.unshift({
              id: randomUUID(),
              at: new Date().toISOString(),
              actor: op.actor.name,
              action: "report.generate",
              target: report.id,
              detail: `${report.name}：${report.start} — ${report.end}`,
            });
            this.provider.saveDashboard(op.actor, w);
          }
          op.task.reportId = report.id;
        }
      }
      if (result.status === "failed")
        op.task.error = "远端 AI 分析失败，请核对模型服务后重新发起分析。";
      op.nextPoll = Date.now() + delay * 1000;
    } catch (error) {
      // Preserve the task on transport failure, so a retry never creates a second analysis.
      const invalid =
        error instanceof AppError &&
        ["INVALID_INPUT", "MCP_SCHEMA"].includes(error.code);
      op.task.status = invalid ? "failed" : op.remoteId ? "running" : "queued";
      op.task.stage = invalid ? "报告校验失败" : "连接暂时中断，稍后继续查询";
      op.task.error =
        error instanceof AppError ? error.message : "分析服务暂时不可用";
      op.nextPoll = Date.now() + 30000;
      op.task.retryAfterSeconds = 30;
    }
    this.save(op);
    return op.task;
  }
  private report(op: Operation, raw: Record<string, any>): Report {
    requireValue(
      typeof raw.report_id === "string" &&
        typeof raw.summary === "string" &&
        raw.start_date === op.input.start_date &&
        raw.end_date === op.input.end_date &&
        Array.isArray(raw.metrics),
      "AI 报告范围或结构不符合接口约定",
      502,
    );
    const id = op.id,
      coverage = raw.data_coverage;
    const generated = new Date(raw.generated_at);
    requireValue(Number.isFinite(generated.getTime()), "AI 报告时间无效", 502);
    return {
      id,
      source: "mcp",
      runKey: op.runKey!,
      planId: op.planId,
      name: string(raw.report_name, 60) || op.task.name,
      start: String(op.input.start_date),
      end: String(op.input.end_date),
      generatedAt: generated.toISOString(),
      mode:
        raw.ai_narrative === true && raw.fact_only !== true ? "model" : "rules",
      summary: string(raw.summary),
      dataMetrics: list(raw.metrics).map((m) => ({
        name: string(m.name, 120),
        value:
          typeof m.value === "number" && Number.isFinite(m.value)
            ? m.value
            : null,
        unit: string(m.unit, 30),
        basis: string(m.basis, 1000),
      })),
      findings: list(raw.findings).map((f) => ({
        title: string(f.title, 200),
        detail: string(f.detail),
        basis: string(f.basis, 4000),
      })),
      advice: list(raw.recommendations).map((r, i) => ({
        id: `mcp:${id}:${i}`,
        title: string(r.content, 200),
        evidence: [string(r.basis, 4000), string(r.reason, 4000)]
          .filter(Boolean)
          .join("；"),
        action: string(r.content),
        priority: ["high", "medium", "low"].includes(r.priority)
          ? r.priority
          : undefined,
        status: "new",
      })),
      coverage: object(coverage)
        ? [
            `${string(coverage.start_date)} — ${string(coverage.end_date)} · ${string(coverage.timezone)}`,
            typeof coverage.total_tickets_scanned === "number"
              ? `扫描 ${coverage.total_tickets_scanned} 条记录`
              : "",
            string(coverage.note),
            ...(Array.isArray(coverage.limitations)
              ? coverage.limitations.map((x: unknown) => string(x, 1000))
              : []),
          ]
            .filter(Boolean)
            .join("；")
        : string(coverage) || "远端未说明数据覆盖范围",
    };
  }
  async chat(
    actor: Actor,
    data: Record<string, unknown>,
  ): Promise<Conversation> {
    this.authorize(actor);
    const message = text(data.question, "问题", 2000),
      request = text(data.requestId, "请求标识", 100);
    const w = this.provider.readDashboard(actor),
      localId =
        typeof data.conversationId === "string" ? data.conversationId : "";
    const stored = (w.conversations[actor.id] || []).find(
      (c) => c.id === localId,
    );
    requireValue(!localId || stored, "对话不存在", 404);
    const context = object(data.context) ? data.context : {};
    const inputContext: Record<string, unknown> = {
      page: string(context.page, 40),
    };
    if (context.ticketId !== undefined) {
      requireValue(
        typeof context.ticketId === "string" &&
          !!(await this.provider.getTicket(actor, context.ticketId)),
        "上下文工单不存在",
        404,
      );
      inputContext.ticket_id = context.ticketId;
    }
    if (context.reportId !== undefined) {
      requireValue(
        typeof context.reportId === "string" &&
          w.reports.some((r) => r.id === context.reportId),
        "上下文报告不存在",
        404,
      );
      const row = this.provider.store.db
        .prepare(
          "SELECT data FROM ai_operations WHERE id=? AND tenant=? AND kind='analysis'",
        )
        .get(context.reportId, actor.tenantId) as { data: string } | undefined;
      const reportOp: Operation | undefined = row && JSON.parse(row.data);
      requireValue(
        reportOp?.task.status === "completed" && reportOp.remoteReportId,
        "此报告未在 MCP 生成，请选择新的 AI 报告",
        400,
      );
      inputContext.report_id = reportOp.remoteReportId;
    }
    const input = { message, conversationId: localId, context: inputContext },
      fingerprint = digest(input);
    let op = this.find(actor, "chat", request);
    if (op) {
      requireValue(
        op.fingerprint === fingerprint,
        "请求标识已用于其他问题",
        409,
      );
      if (op.conversation) return op.conversation;
    }
    const lock = `${actor.tenantId}:${actor.id}:${localId || request}`;
    requireValue(!this.chatting.has(lock), "该对话正在回复，请稍后再试", 409);
    this.chatting.add(lock);
    try {
      if (!op) {
        const id = randomUUID();
        op = {
          id,
          actor,
          kind: "chat",
          request,
          input,
          fingerprint,
          nextPoll: 0,
          task: {
            id,
            name: message.slice(0, 24),
            status: "queued",
            stage: "正在回复",
            retryAfterSeconds: 5,
          },
        };
        this.save(op);
      }
      const remote = localId
        ? (this.provider.store.db
            .prepare(
              "SELECT remote_id FROM ai_conversations WHERE tenant=? AND actor=? AND local_id=?",
            )
            .get(actor.tenantId, actor.id, localId) as
            { remote_id: string } | undefined)
        : undefined;
      const result = await this.provider.client.call(
        "chat",
        {
          request_id: `qf:${op.id}`,
          message,
          user_id: digest([actor.tenantId, actor.id]),
          ...(remote ? { conversation_id: remote.remote_id } : {}),
          context: inputContext,
        },
        90000,
      );
      requireValue(
        object(result) &&
          typeof result.conversation_id === "string" &&
          typeof result.message_id === "string" &&
          typeof result.answer === "string" &&
          (!remote || remote.remote_id === result.conversation_id),
        "AI助手返回格式不符合接口约定",
        502,
      );
      const now = new Date().toISOString();
      const latest = (
        this.provider.readDashboard(actor).conversations[actor.id] || []
      ).find((c) => c.id === localId);
      const conversation: Conversation = latest
        ? structuredClone(latest)
        : {
            id: op.id,
            title: message.slice(0, 24),
            messages: [],
            updatedAt: now,
          };
      conversation.messages.push(
        {
          id: `${op.id}:user`,
          role: "user",
          text: message,
          at: now,
          context: {
            page: string(context.page, 40),
            label: string(
              context.ticketId || context.reportId || context.page,
              80,
            ),
            ...(typeof context.ticketId === "string"
              ? { ticketId: context.ticketId }
              : {}),
            ...(typeof context.reportId === "string"
              ? { reportId: context.reportId }
              : {}),
          },
        },
        {
          id: `${op.id}:assistant`,
          role: "assistant",
          text: string(result.answer),
          at: now,
          mode: "MCP · AI 回答",
          coverage: string(result.data_coverage, 2000),
          references: list(result.references)
            .map((r) =>
              [string(r.type, 40), string(r.id, 120), string(r.title, 200)]
                .filter(Boolean)
                .join(" · "),
            )
            .filter(Boolean),
        },
      );
      conversation.messages = conversation.messages.slice(-100);
      conversation.updatedAt = now;
      this.provider.store.db.exec("BEGIN IMMEDIATE");
      try {
        this.provider.store.db
          .prepare(
            "INSERT INTO ai_conversations VALUES(?,?,?,?) ON CONFLICT(tenant,actor,local_id) DO UPDATE SET remote_id=excluded.remote_id",
          )
          .run(
            actor.tenantId,
            actor.id,
            conversation.id,
            result.conversation_id,
          );
        this.provider.saveConversation(actor, conversation);
        op.conversation = conversation;
        op.task.status = "completed";
        this.save(op);
        this.provider.store.db.exec("COMMIT");
      } catch (error) {
        this.provider.store.db.exec("ROLLBACK");
        throw error;
      }
      return conversation;
    } finally {
      this.chatting.delete(lock);
    }
  }
  async tick() {
    for (const tenantId of this.provider.analysisTenantIds()) {
      const actor: Actor = {
        id: "scheduler",
        name: "分析计划",
        role: "admin",
        tenantId,
      };
      // Poll a bounded batch of all users' pending analyses; metadata remains private to its owner.
      const rows = this.provider.store.db
        .prepare(
          "SELECT data FROM ai_operations WHERE tenant=? AND kind='analysis'",
        )
        .all(tenantId) as { data: string }[];
      const pending: Operation[] = rows
        .map((r) => JSON.parse(r.data))
        .filter(
          (op) =>
            !["completed", "failed"].includes(op.task.status) &&
            op.nextPoll <= Date.now(),
        )
        .sort((a, b) => a.nextPoll - b.nextPoll);
      await Promise.allSettled(
        pending.slice(0, 4).map((op) => this.advance(op)),
      );
      for (const plan of this.provider.readDashboard(actor).plans) {
        if (!plan.enabled || Date.parse(plan.nextRun) > Date.now()) continue;
        const runKey = `${plan.id}:${plan.nextRun}`;
        try {
          const existing = this.find(actor, "analysis", runKey);
          const task = existing
            ? await this.advance(existing)
            : await this.generate(
                actor,
                { ...planRange(plan, new Date(plan.nextRun)), name: plan.name },
                runKey,
                plan.id,
              );
          if (task.status !== "completed" && task.status !== "failed") continue;
          const w = this.provider.readDashboard(actor),
            p = w.plans.find((p) => p.id === plan.id);
          if (p && p.nextRun === plan.nextRun) {
            p.nextRun = nextRun(p);
            this.provider.saveDashboard(actor, w);
          }
        } catch {
          /* Keep the same run key for a later retry. */
        }
      }
    }
  }
}
