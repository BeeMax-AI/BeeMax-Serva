import type { Workspace, Plan, TicketStatus } from "../../shared/domain.ts";
import { businessDate, addDays, nextRun } from "./dates.ts";
export function seed(tenantId: string): Workspace {
  const today = businessDate(),
    at = (days: number, time: string) =>
      new Date(addDays(today, -days) + "T" + time + ":00+08:00").toISOString();
  const groups = [
    { id: "repair", name: "房修组" },
    { id: "service", name: "客房组" },
    { id: "support", name: "客服组" },
  ];
  const people = [
    ["p1", "王师傅", "repair"],
    ["p2", "张师傅", "repair"],
    ["p3", "陈阿姨", "service"],
    ["p4", "刘阿姨", "service"],
    ["p5", "李敏", "support"],
    ["p6", "赵悦", "support"],
  ].map(([id, name, groupId], i) => ({
    id,
    name,
    groupId,
    tier: (i % 2) + 1,
    active: true,
  }));
  const rows = [
    [
      "E174",
      "A-1208",
      "空调不制冷，需要上门检修",
      "报修",
      "repair",
      "",
      "NO_ACCEPT",
    ],
    [
      "E169",
      "B-0603",
      "浴室水龙头持续漏水",
      "报修",
      "repair",
      "p1",
      "ESCALATED_L2",
    ],
    ["E163", "A-0916", "网络频繁掉线", "IT网络", "support", "p5", "ON_HOLD"],
    [
      "E173",
      "B-1105",
      "补充浴巾与洗漱用品",
      "清洁",
      "service",
      "p3",
      "IN_PROGRESS",
    ],
    ["E172", "A-0802", "咨询续租流程", "咨询", "support", "p5", "CLOSED"],
    ["E171", "C-0302", "更换门锁电池", "报修", "repair", "p2", "IN_PROGRESS"],
    ["E170", "B-0716", "预约房间清洁", "清洁", "service", "p4", "ACCEPTED"],
    ["E168", "C-0608", "配送饮用水", "送水", "service", "p3", "CLOSED"],
    ["E167", "A-0511", "照明灯闪烁", "报修", "repair", "", "DISPATCHED"],
    ["E166", "B-0218", "押金进度查询", "咨询", "support", "p6", "CLOSED"],
    ["E165", "C-1006", "更换床单", "清洁", "service", "p4", "IN_PROGRESS"],
    ["E164", "A-1103", "花洒支架松动", "报修", "repair", "p2", "CLOSED"],
  ];
  const tickets = rows.map(
    ([id, reference, subject, type, groupId, assigneeId, status], i) => ({
      id,
      reference,
      subject,
      type,
      groupId,
      assigneeId: assigneeId || null,
      status: status as TicketStatus,
      priority: i < 2 ? "优先" : "普通",
      createdAt: at(i < 7 ? 0 : i - 6, "08:00"),
      acceptedAt: assigneeId ? at(i < 7 ? 0 : i - 6, "08:10") : null,
      closedAt: status === "CLOSED" ? at(i < 7 ? 0 : i - 6, "09:00") : null,
      version: 1,
      events: [
        {
          at: at(i < 7 ? 0 : i - 6, "08:00"),
          name: "创建工单",
          detail: subject,
          by: "本地样例",
        },
        {
          at: at(i < 7 ? 0 : i - 6, "08:10"),
          name: "当前状态快照",
          detail: "导入本地样例；未补造其余历史事件。",
          by: "系统",
        },
      ],
    }),
  );
  const frequencies = [
      "daily",
      "weekly",
      "half",
      "monthly",
      "quarterly",
      "yearly",
    ] as const,
    ranges = [
      "previousDay",
      "previousWeek",
      "previousHalf",
      "previousMonth",
      "previousQuarter",
      "previousYear",
    ] as const,
    names = ["日报", "周报", "半月报", "月报", "季报", "年报"];
  const plans = frequencies.map((frequency, i) => {
    const p: Plan = {
      id: frequency,
      name: names[i],
      enabled: true,
      frequency,
      time: "08:30",
      weekday: 1,
      monthDay: 1,
      yearMonth: 1,
      every: 10,
      unit: "days",
      anchor: today,
      range: ranges[i],
      rangeDays: 30,
      nextRun: "",
    };
    p.nextRun = nextRun(p);
    return p;
  });
  return {
    revision: 1,
    tenant: {
      id: tenantId,
      name: tenantId === "demo" ? "满室 · 演示客户" : "通用服务 · 演示客户",
      referenceLabel: tenantId === "demo" ? "房号" : "服务对象",
      timezone: "Asia/Shanghai",
      modules: ["tickets", "accounts", "analysis"],
    },
    groups,
    people,
    tickets,
    accounts: [
      {
        id: "a1",
        name: "服务机器人",
        company: "主演示空间",
        login: "示例服务号",
        status: "online",
        groups: [
          { id: "demo-repair", name: "房修工作群", addedAt: at(5, "09:00") },
          { id: "demo-service", name: "客房工作群", addedAt: at(5, "09:00") },
        ],
      },
      {
        id: "a2",
        name: "备用服务机器人",
        company: "备用空间",
        login: "待登录",
        status: "offline",
        groups: [],
      },
    ],
    messages: tickets.flatMap((t, i) => [
      {
        id: `m${i}-in`,
        accountId: "a1",
        direction: "in" as const,
        contact: t.reference + " 联系人",
        chatId: "demo-chat-" + i,
        type: "text" as const,
        content: t.subject,
        status: "completed" as const,
        at: t.createdAt,
        ticketId: t.id,
      },
      {
        id: `m${i}-out`,
        accountId: "a1",
        direction: "out" as const,
        contact: groups.find((g) => g.id === t.groupId)!.name,
        chatId: "demo-group-" + t.groupId,
        type: "card" as const,
        content: `已登记 ${t.id}：${t.subject}`,
        status:
          i === 1
            ? ("failed" as const)
            : i === 2
              ? ("pending" as const)
              : ("completed" as const),
        at: t.createdAt,
        ticketId: t.id,
        ...(i === 1 ? { error: "本地样例：连接中断" } : {}),
      },
    ]),
    routes: groups.map((g, i) => ({
      id: "r" + i,
      type: ["报修", "清洁", "咨询"][i],
      keywords: ["空调、漏水、门锁", "布草、清洁、浴巾", "网络、续租、账单"][i],
      groupId: g.id,
      source: "客户配置",
    })),
    parameters: {
      escalationMinutes: 15,
      acceptReminderMinutes: 5,
      holdReminderMinutes: 10,
    },
    learning: { autoApply: false, routingShadow: true },
    plans,
    reports: [],
    adviceState: {},
    audit: [],
    conversations: {},
    coverageStart: addDays(today, -5),
    credentials: { configured: false, accountMask: "", updatedAt: null },
  };
}
