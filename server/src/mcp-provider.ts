import { timelineEvent } from "./mcp-timeline.ts";
import { createHash, randomUUID } from "node:crypto";
import type {
  Actor,
  Command,
  Workspace,
  Ticket,
  Person,
  TicketStatus,
  Group,
} from "../../shared/domain.ts";
import { statuses } from "../../shared/domain.ts";
import { LocalProvider } from "./provider.ts";
import { Store } from "./store.ts";
import { McpClient, type McpConfig } from "./mcp-client.ts";
import { AppError, requireValue, text, number } from "./errors.ts";
import { businessDate } from "./dates.ts";
const hash = (value: unknown) =>
  parseInt(
    createHash("sha256")
      .update(JSON.stringify(value))
      .digest("hex")
      .slice(0, 12),
    16,
  ) || 1;
const iso = (value: any): string | null =>
  value && Number.isFinite(new Date(value).getTime())
    ? new Date(value).toISOString()
    : null;
const object = (value: any) =>
  value && typeof value === "object" && !Array.isArray(value);
function blank(config: McpConfig): Workspace {
  return {
    revision: 1,
    tenant: {
      id: "mcp:" + config.tenantId,
      name: config.tenantName,
      referenceLabel: config.referenceLabel || "服务对象",
      timezone: "Asia/Shanghai",
      modules: ["tickets", "insights"],
    },
    groups: [],
    people: [],
    tickets: [],
    accounts: [],
    messages: [],
    routes: [],
    parameters: {
      escalationMinutes: 0,
      acceptReminderMinutes: 0,
      holdReminderMinutes: 0,
    },
    learning: { autoApply: false, routingShadow: false },
    plans: [],
    reports: [],
    adviceState: {},
    audit: [],
    conversations: {},
    coverageStart: businessDate(),
    credentials: { configured: false, accountMask: "", updatedAt: null },
  };
}
export class McpProvider extends LocalProvider {
  override mode = "mcp" as const;
  readonly client: McpClient;
  private cache?: { until: number; workspace: Workspace };
  private loading?: Promise<Workspace>;
  private writing = false;
  constructor(
    store: Store,
    private config: McpConfig,
  ) {
    super(store);
    this.client = new McpClient(config);
    if (
      !store.db
        .prepare("SELECT tenant FROM workspaces WHERE tenant=?")
        .get("mcp:" + config.tenantId)
    )
      store.save(blank(config));
  }
  private authorize(actor: Actor) {
    requireValue(
      actor.tenantId === this.config.tenantId,
      "当前账号所属客户尚未配置 MCP 数据源",
      403,
    );
  }
  override analysisTenantIds() {
    return [this.config.tenantId];
  }
  override readDashboard(actor: Actor) {
    this.authorize(actor);
    return this.store.read("mcp:" + actor.tenantId);
  }
  override saveDashboard(actor: Actor, w: Workspace) {
    this.authorize(actor);
    const metadata = blank(this.config);
    for (const key of [
      "plans",
      "reports",
      "adviceState",
      "audit",
      "conversations",
    ] as const)
      (metadata as any)[key] = w[key];
    metadata.revision = this.readDashboard(actor).revision + 1;
    this.store.save(metadata);
  }
  override async read(actor: Actor): Promise<Workspace> {
    this.authorize(actor);
    if (!this.cache || this.cache.until < Date.now()) {
      if (!this.loading)
        this.loading = this.fetchWorkspace()
          .then((workspace) => {
            this.cache = { workspace, until: Date.now() + 10000 };
            return workspace;
          })
          .finally(() => {
            this.loading = undefined;
          });
      await this.loading;
    }
    const base = structuredClone(this.cache!.workspace),
      metadata = this.readDashboard(actor);
    for (const key of [
      "plans",
      "reports",
      "adviceState",
      "conversations",
    ] as const)
      (base as any)[key] = metadata[key];
    base.audit = [...metadata.audit, ...base.audit].sort((a, b) =>
      b.at.localeCompare(a.at),
    );
    base.revision = hash([base.revision, metadata.revision]);
    return base;
  }
  private async fetchWorkspace(): Promise<Workspace> {
    await this.client.initialize();
    const results = await Promise.allSettled([
      this.client.call("list_tickets", { limit: 1000 }),
      this.client.call("ticket_stats"),
      this.client.call("get_roster"),
      this.client.call("get_routing_rules"),
      this.client.call("get_config", { path: "groups" }),
      this.client.call("get_config", { path: "escalation" }),
      this.client.call("get_config", { path: "transferLearning.autoApply" }),
      this.client.call("get_config", { path: "routingShadow.enabled" }),
    ]);
    const failed = results.find((r) => r.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
    const [
      rows,
      stats,
      roster,
      routing,
      groups,
      escalation,
      autoApply,
      routingShadow,
    ] = results.map((r) => (r as PromiseFulfilledResult<any>).value);
    requireValue(
      Array.isArray(rows) &&
        object(stats) &&
        typeof stats.total === "number" &&
        object(roster?.default) &&
        object(routing?.effective) &&
        object(groups) &&
        object(escalation),
      "MCP 数据结构已变化，请检查映射",
      502,
    );
    const w = blank(this.config);
    w.tenant.id = this.config.tenantId;
    w.groups = Object.entries(groups)
      .filter(
        ([id, g]: [string, any]) =>
          !id.startsWith("_") && typeof g.name === "string",
      )
      .map(([id, g]: [string, any]) => ({ id, name: g.name }));
    const today = businessDate();
    for (const group of w.groups) {
      const tiers = {
        ...roster.default[group.id],
        ...roster.byDate?.[today]?.[group.id],
      };
      for (const [tier, people] of Object.entries(tiers))
        if (/^l[1-4]$/.test(tier) && Array.isArray(people))
          for (const p of people) {
            if (!p.name || !p.userid) continue;
            const id = group.id + ":" + p.userid;
            if (!w.people.some((x) => x.id === id))
              w.people.push({
                id,
                name: p.name,
                groupId: group.id,
                tier: Number(tier.slice(1)),
                active: false,
                scheduleLabel: roster.byDate?.[today]?.[group.id]
                  ? "日期排班 · 非实时在岗"
                  : "默认排班 · 非实时在岗",
              });
          }
    }
    w.tickets = rows.map((t) => this.normalize(t, w.people, w.groups));
    w.routes = Object.entries(routing.effective)
      .filter(([k, v]) => !k.startsWith("_") && typeof v === "string")
      .map(([type, groupId]) => ({
        id: "type:" + type,
        type,
        groupId: String(groupId),
        keywords: "—",
        source: routing.learned?.overrides?.[type] ? "学习覆盖" : "生效配置",
      }));
    for (const [i, r] of (routing.learned?.subjectRules || []).entries())
      w.routes.push({
        id: "subject:" + i,
        type: "关键词规则",
        keywords: String(r.kw),
        groupId: String(r.toGroup),
        source: "学习规则",
      });
    const params = [
      escalation.intervalMinutes,
      escalation.acceptedReminder?.hours,
      escalation.holdReminderLeadMinutes,
    ];
    requireValue(
      params.every((x) => typeof x === "number" && Number.isFinite(x)),
      "MCP 提醒配置缺少必要字段",
      502,
    );
    w.parameters = {
      escalationMinutes: params[0],
      acceptReminderMinutes: params[1] * 60,
      holdReminderMinutes: params[2],
    };
    w.learning = {
      autoApply: autoApply === true,
      routingShadow: routingShadow === true,
    };
    w.coverageStart =
      w.tickets.map((t) => businessDate(new Date(t.createdAt))).sort()[0] ||
      today;
    const open = w.tickets.filter((t) => t.status !== "CLOSED").length;
    const complete =
      rows.length === stats.total &&
      new Set(w.tickets.map((t) => t.id)).size === stats.total;
    const notices = [
      `MCP 已读取 ${rows.length} / ${stats.total} 条工单；列表接口不含正文，点击工单查看详情。`,
      "分析仅覆盖接口返回的记录，未记录日期不代表业务量为零。",
    ];
    if (!complete)
      notices.push("数据未完整返回，汇总为已加载记录统计，不能视作全库统计。");
    if (complete && typeof stats.open === "number" && stats.open !== open)
      notices.push(
        `待闭环按全部非 CLOSED 状态统计 ${open} 单；接口 open 字段为 ${stats.open}，两者口径不同。`,
      );
    w.integration = {
      notices,
      commands: [
        "plan.save",
        "plan.delete",
        "advice.update",
        ...(this.client.tools.has("set_config")
          ? ["parameters.save", "learning.save"]
          : []),
        ...["urge", "hold", "resume", "reassign", "complete"]
          .filter((k) => this.client.tools.has(k + "_ticket"))
          .map((k) => "ticket." + k),
      ],
      loaded: rows.length,
      total: stats.total,
      complete,
      checkedAt: new Date().toISOString(),
      rosterNote:
        "展示默认及当日覆盖排班；楼栋、时间段、专员及 @所有人 规则由远端派单服务执行，此处不据默认名单推断实时在岗。",
    };
    w.revision = hash([
      rows,
      groups,
      roster,
      routing,
      escalation,
      autoApply,
      routingShadow,
    ]);
    return w;
  }
  private normalize(t: any, people: Person[], groups: Group[]): Ticket {
    requireValue(
      object(t) &&
        typeof t.id === "string" &&
        typeof t.group_id === "string" &&
        iso(t.created_at),
      "MCP 工单字段不完整",
      502,
    );
    requireValue(
      Object.hasOwn(statuses, t.status),
      "MCP 出现未映射的工单状态，请更新状态映射",
      502,
    );
    let person = t.assignee
      ? people.find((p) => p.groupId === t.group_id && p.name === t.assignee)
      : undefined;
    if (t.assignee && !person) {
      person = {
        id: t.group_id + ":history:" + t.assignee,
        name: String(t.assignee),
        groupId: t.group_id,
        tier: 1,
        active: false,
        scheduleLabel: "历史处理人",
      };
      people.push(person);
    }
    return {
      id: t.id,
      subject: String(
        t.content ||
          `${t.type || "服务请求"} · ${t.room || t.fields?.room || "未指定服务对象"}`,
      ),
      reference: String(t.room || t.fields?.room || ""),
      type: String(t.type || "其他"),
      groupId: t.group_id,
      assigneeId: person?.id || null,
      status: t.status as TicketStatus,
      priority: String(t.priority || "—"),
      createdAt: iso(t.created_at)!,
      acceptedAt: iso(t.accepted_at),
      closedAt: iso(t.closed_at),
      holdReason: t.hold_reason || t.hold?.reason,
      remindAt: iso(t.remind_at || t.hold?.remind_at) || undefined,
      version: hash(t),
      events: Array.isArray(t.events)
        ? t.events.map((e: unknown) =>
            timelineEvent(e, groups, iso(t.created_at)!),
          )
        : [],
    };
  }
  override async getTicket(actor: Actor, id: string) {
    const w = await this.read(actor);
    if (!w.tickets.some((t) => t.id === id)) return undefined;
    const raw = await this.client.call("get_ticket", { id });
    requireValue(raw?.id === id, "MCP 返回的工单标识不匹配", 502);
    return this.normalize(raw, w.people, w.groups);
  }
  override async command(
    actor: Actor,
    c: Command,
  ): Promise<{ revision: number }> {
    this.authorize(actor);
    requireValue(actor.role !== "viewer", "当前账号只有查看权限", 403);
    requireValue(
      c && typeof c.type === "string" && object(c.data),
      "请求格式无效",
    );
    text(c.requestId, "请求标识", 100);
    number(c.expectedRevision, "数据版本", 1, Number.MAX_SAFE_INTEGER);
    const namespace = "mcp:" + actor.tenantId,
      fingerprint = createHash("sha256")
        .update(JSON.stringify(c))
        .digest("hex"),
      db = this.store.db;
    const prior = db
      .prepare(
        "SELECT fingerprint,result FROM requests WHERE tenant=? AND actor=? AND id=?",
      )
      .get(namespace, actor.id, c.requestId) as
      { fingerprint: string; result: string } | undefined;
    if (prior) {
      requireValue(
        prior.fingerprint === fingerprint,
        "请求标识已用于其他操作",
        409,
      );
      const result = JSON.parse(prior.result);
      if (result.pending)
        throw new AppError(
          409,
          "MCP_RESULT_UNKNOWN",
          "此操作已提交但结果待核对，请先检查远端记录，勿重复提交。",
        );
      return result;
    }
    requireValue(!this.writing, "另一个操作正在执行，请稍后刷新", 409);
    this.writing = true;
    try {
      // Compare the latest remote snapshot. Upstream does not provide atomic CAS.
      if (this.loading) await this.loading;
      this.cache = undefined;
      const w = await this.read(actor);
      if (w.revision !== c.expectedRevision)
        throw new AppError(
          409,
          "REVISION_CONFLICT",
          "数据已更新，请刷新后核对并重试。",
        );
      const capability =
        c.type === "ticket.action" ? "ticket." + c.data.action : c.type;
      requireValue(
        w.integration!.commands.includes(capability),
        "当前 MCP 尚未提供此操作，未写入本地样例",
        503,
      );
      let tool = "",
        args: Record<string, unknown> = {},
        local = false;
      if (["plan.save", "plan.delete", "advice.update"].includes(c.type)) {
        this.apply(w, actor, c);
        local = true;
      } else if (c.type === "ticket.action") {
        const ticket = w.tickets.find((t) => t.id === c.data.id);
        requireValue(ticket, "工单不存在", 404);
        requireValue(ticket.status !== "CLOSED", "工单已闭环");
        const short = ticket.id.match(/^T\d{6}-([A-Z]\d+)$/)?.[1];
        requireValue(
          w.integration!.complete &&
            short &&
            w.tickets.filter((t) => t.id.endsWith("-" + short)).length === 1,
          "远端操作使用短码，当前无法确认其唯一性；请在源系统操作",
          409,
        );
        tool = String(c.data.action) + "_ticket";
        args = { short, by: actor.name + " (" + actor.id + ")" };
        if (c.data.action === "reassign") {
          const group = w.groups.find((g) => g.id === c.data.groupId);
          requireValue(group, "目标小组不存在");
          requireValue(
            !c.data.assigneeId,
            "远端按小组自动选择处理人，不支持指定个人",
          );
          args.target = group.name.replace(/沟通群$/, "");
        }
        if (c.data.action === "resume")
          requireValue(ticket.status === "ON_HOLD", "只有挂起工单可以恢复");
        if (c.data.action === "hold") {
          args.reason = text(c.data.reason, "挂起原因", 500);
          const at = iso(c.data.remindAt);
          requireValue(
            at && Date.parse(at) > Date.now(),
            "请设置未来的跟进时间",
          );
          args.remind_at = new Date(Date.parse(at) + 8 * 3600000)
            .toISOString()
            .slice(0, 16)
            .replace("T", " ");
        }
      } else {
        tool = "set_config";
        if (c.type === "parameters.save") {
          const fields = [
            "escalationMinutes",
            "acceptReminderMinutes",
            "holdReminderMinutes",
          ] as const;
          const changed = fields.filter((k) => c.data[k] !== w.parameters[k]);
          requireValue(
            changed.length === 1,
            "每次请只修改一个参数，以便确认远端保存结果",
          );
          const field = changed[0],
            v = number(c.data[field], "提醒分钟数", 1, 10080);
          requireValue(
            field !== "acceptReminderMinutes" || v % 60 === 0,
            "接单后完成提醒请填写整小时（60 分钟的倍数）",
          );
          args = {
            path: {
              escalationMinutes: "escalation.intervalMinutes",
              acceptReminderMinutes: "escalation.acceptedReminder.hours",
              holdReminderMinutes: "escalation.holdReminderLeadMinutes",
            }[field],
            value: field === "acceptReminderMinutes" ? v / 60 : v,
          };
        } else {
          const fields = ["autoApply", "routingShadow"] as const,
            changed = fields.filter(
              (k) => c.data[k] !== undefined && c.data[k] !== w.learning[k],
            );
          requireValue(changed.length === 1, "每次请只修改一个学习开关");
          const k = changed[0];
          requireValue(typeof c.data[k] === "boolean", "开关值无效");
          args = {
            path:
              k === "autoApply"
                ? "transferLearning.autoApply"
                : "routingShadow.enabled",
            value: c.data[k],
          };
        }
        args.by = actor.name + " (" + actor.id + ")";
      }
      db.prepare("INSERT INTO requests VALUES(?,?,?,?,?)").run(
        namespace,
        actor.id,
        c.requestId,
        fingerprint,
        JSON.stringify({ pending: true }),
      );
      if (!local) {
        try {
          const result = await this.client.call(tool, args);
          if (
            !object(result) ||
            (result.ok !== true && result.success !== true) ||
            result?.error
          )
            throw new Error("rejected");
        } catch {
          throw new AppError(
            502,
            "MCP_RESULT_UNKNOWN",
            "远端操作结果尚未确认，请先核对源系统记录；本请求不会自动重试。",
          );
        }
      }
      // Refresh metadata after network I/O so concurrent reports/chats are retained.
      const metadata = this.readDashboard(actor);
      if (local)
        for (const key of ["plans", "reports", "adviceState"] as const)
          (metadata as any)[key] = w[key];
      metadata.audit.unshift({
        id: randomUUID(),
        at: new Date().toISOString(),
        actor: actor.name,
        action: c.type,
        target: String(c.data.id || ""),
        detail: local
          ? "工作台记录已保存"
          : `MCP ${tool} 已返回；请刷新核对业务状态`,
      });
      this.saveDashboard(actor, metadata);
      this.cache = undefined;
      const result = { revision: w.revision };
      db.prepare(
        "UPDATE requests SET result=? WHERE tenant=? AND actor=? AND id=?",
      ).run(JSON.stringify(result), namespace, actor.id, c.requestId);
      return result;
    } finally {
      this.writing = false;
    }
  }
}
