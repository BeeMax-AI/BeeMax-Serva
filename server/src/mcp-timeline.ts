import type { Group, Ticket } from "../../shared/domain.ts";

const eventNames: Record<string, string> = {
  created: "创建工单",
  classified: "自动分类",
  dispatched: "派发工单",
  consult_dispatched: "咨询转派",
  accepted: "接单",
  closed: "完成闭环",
  held: "挂起",
  hold: "挂起",
  resumed: "恢复处理",
  resume: "恢复处理",
  reassigned: "转派",
  transferred: "转派",
  urged: "催办",
  escalated: "升级处理",
  accept_reminded: "接单后完成提醒",
  hold_reminded: "挂起跟进提醒",
  hold_remind_set: "设置跟进时间",
  hold_appointment_set: "设置预约时间",
  dispatch_failed: "派发失败",
  no_accept: "无人接单",
  note_added: "添加备注",
};
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function readable(value: unknown): string {
  if (typeof value === "string" || typeof value === "number")
    return String(value);
  if (Array.isArray(value))
    return value.map(readable).filter(Boolean).join("、");
  return "";
}
function chinaTime(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number") return "";
  // Numeric strings are epoch milliseconds; timezone-less dates are China time.
  const input =
    typeof value === "string" && /^\d+$/.test(value)
      ? Number(value)
      : typeof value === "string" &&
          /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(value)
        ? value.replace(" ", "T") + "+08:00"
        : value;
  const date = new Date(input);
  if (!Number.isFinite(date.getTime())) return "";
  return (
    new Date(date.getTime() + 8 * 3600000)
      .toISOString()
      .slice(0, 16)
      .replace("T", " ") + "（北京时间）"
  );
}
export function timelineEvent(
  value: unknown,
  groups: Group[],
  fallbackAt: string,
): Ticket["events"][number] {
  const event = record(value);
  let raw = event.detail;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      /* A plain-text business note remains text. */
    }
  }
  const detail = record(raw),
    fields = record(detail.fields),
    parts: string[] = [];
  const add = (label: string, value: unknown) => {
    const text = readable(value);
    if (text) parts.push(`${label}：${text}`);
  };
  add("服务对象", detail.room || fields.room);
  add("客户原文", fields.raw || fields.question);
  for (const [key, label] of Object.entries({
    type: "问题类型",
    priority: "优先级",
    assignee: "处理人",
    holder: "跟进人",
    reason: "原因",
    note: "备注",
    mention: "通知人员",
    parent: "关联工单",
  }))
    add(label, detail[key]);
  for (const [key, label] of Object.entries({
    groupId: "负责小组",
    group_id: "负责小组",
    target: "目标小组",
    toGroup: "目标小组",
    fromGroup: "原小组",
  })) {
    if (detail[key])
      add(
        label,
        groups.find((g) => g.id === detail[key])?.name || "未识别的小组",
      );
  }
  if (typeof detail.tier === "number") add("处理档位", `${detail.tier} 档`);
  if (typeof detail.hours === "number")
    add("提醒规则", `接单后 ${detail.hours} 小时`);
  if (typeof detail.nudges === "number")
    add("跟进次数", `第 ${detail.nudges} 次`);
  if (typeof detail.lead_min === "number")
    add("提前提醒", `${detail.lead_min} 分钟`);
  for (const [key, label] of Object.entries({
    remind_at: "跟进时间",
    appointment_at: "预约时间",
  }))
    add(label, chinaTime(detail[key]));
  for (const [key, label] of Object.entries({
    selfServe: "自助处理",
    urgent: "紧急工单",
    delivered: "通知送达",
  })) {
    if (typeof detail[key] === "boolean") add(label, detail[key] ? "是" : "否");
  }
  const timestamp =
    typeof event.ts === "number" || typeof event.ts === "string"
      ? new Date(event.ts)
      : null;
  return {
    at:
      timestamp && Number.isFinite(timestamp.getTime())
        ? timestamp.toISOString()
        : fallbackAt,
    name: Object.hasOwn(eventNames, String(event.event))
      ? eventNames[String(event.event)]
      : "业务记录",
    detail:
      typeof raw === "string"
        ? raw
        : parts.join("；") || "此节点暂无可展示的业务说明。",
    by: readable(event.by || detail.by) || "系统",
  };
}
