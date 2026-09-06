export type Role = "owner" | "admin" | "viewer";
export interface Actor {
  id: string;
  name: string;
  role: Role;
  tenantId: string;
}
export interface Group {
  id: string;
  name: string;
}
export interface Person {
  id: string;
  name: string;
  groupId: string;
  tier: number;
  active: boolean;
  scheduleLabel?: string;
}
export const statuses = {
  DISPATCHED: "待接单",
  ACCEPTED: "已接单",
  IN_PROGRESS: "处理中",
  ON_HOLD: "挂起中",
  NO_ACCEPT: "无人接单",
  ESCALATED_L2: "已升级 L2",
  CLOSED: "已闭环",
} as const;
export type TicketStatus = keyof typeof statuses;
export interface Ticket {
  id: string;
  subject: string;
  reference: string;
  type: string;
  groupId: string;
  assigneeId: string | null;
  status: TicketStatus;
  priority: string;
  createdAt: string;
  acceptedAt: string | null;
  closedAt: string | null;
  holdReason?: string;
  remindAt?: string;
  version: number;
  events: { at: string; name: string; detail: string; by: string }[];
}
export interface Account {
  id: string;
  name: string;
  company: string;
  login: string;
  status: "online" | "offline";
  groups: { id: string; name: string; addedAt: string }[];
}
export interface Message {
  id: string;
  accountId: string;
  direction: "in" | "out";
  contact: string;
  chatId: string;
  type: "text" | "card" | "image";
  content: string;
  status: "completed" | "pending" | "failed";
  at: string;
  ticketId?: string;
  error?: string;
}
export interface Route {
  id: string;
  type: string;
  keywords: string;
  groupId: string;
  source: string;
}
export type Frequency =
  "daily" | "weekly" | "half" | "monthly" | "quarterly" | "yearly" | "interval";
export type RangeKind =
  | "previousDay"
  | "previousWeek"
  | "previousHalf"
  | "previousMonth"
  | "previousQuarter"
  | "previousYear"
  | "rolling";
export interface Plan {
  id: string;
  name: string;
  enabled: boolean;
  frequency: Frequency;
  time: string;
  weekday: number;
  monthDay: number;
  yearMonth: number;
  every: number;
  unit: "days" | "weeks" | "months" | "years";
  anchor: string;
  range: RangeKind;
  rangeDays: number;
  nextRun: string;
}
export interface Advice {
  id: string;
  title: string;
  evidence: string;
  action: string;
  status: "new" | "following" | "done";
  ownerId?: string;
  reviewAt?: string;
}
export interface Report {
  id: string;
  planId?: string;
  runKey: string;
  name: string;
  start: string;
  end: string;
  generatedAt: string;
  mode: "rules" | "model";
  summary: string;
  metrics: Metrics;
  advice: Advice[];
  coverage: string;
}
export interface Metrics {
  total: number;
  open: number;
  created: number;
  closed: number;
  waiting: number;
  held: number;
  escalated: number;
  avgResponse: number | null;
  avgResolution: number | null;
  byType: { name: string; value: number }[];
  byGroup: { name: string; value: number }[];
  trend: { date: string; created: number; closed: number }[];
}
export interface Audit {
  id: string;
  at: string;
  actor: string;
  action: string;
  target: string;
  detail: string;
}
export interface Conversation {
  id: string;
  title: string;
  updatedAt: string;
  messages: {
    id: string;
    role: "user" | "assistant";
    text: string;
    at: string;
    mode?: string;
    ticketIds?: string[];
    context?: {
      page: string;
      label: string;
      ticketId?: string;
      reportId?: string;
    };
  }[];
}
export interface Workspace {
  integration?: {
    notices: string[];
    commands: string[];
    loaded: number;
    total: number;
    complete: boolean;
    checkedAt: string;
    rosterNote: string;
  };
  revision: number;
  tenant: {
    id: string;
    name: string;
    referenceLabel: string;
    timezone: string;
    modules: string[];
  };
  groups: Group[];
  people: Person[];
  tickets: Ticket[];
  accounts: Account[];
  messages: Message[];
  routes: Route[];
  parameters: {
    escalationMinutes: number;
    acceptReminderMinutes: number;
    holdReminderMinutes: number;
  };
  learning: { autoApply: boolean; routingShadow: boolean };
  plans: Plan[];
  reports: Report[];
  adviceState: Record<
    string,
    { status: Advice["status"]; ownerId?: string; reviewAt?: string }
  >;
  audit: Audit[];
  conversations: Record<string, Conversation[]>;
  coverageStart: string;
  credentials: {
    configured: boolean;
    accountMask: string;
    updatedAt: string | null;
  };
}
export interface Bootstrap {
  actor: Actor;
  mode: "local" | "mcp";
  aiConfigured: boolean;
  workspace: Omit<Workspace, "conversations">;
  conversations: Conversation[];
  today: string;
  metrics: Metrics;
}
export interface Command {
  type: string;
  data: Record<string, unknown>;
  expectedRevision: number;
  requestId: string;
}
