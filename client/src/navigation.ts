export const navs = [
  ["insights", "spark", "AI智能分析"],
  ["overview", "overview", "运营总览"],
  ["tickets", "ticket", "工单管理"],
  ["staff", "staff", "人员与负载"],
  ["accounts", "staff", "企微账号"],
  ["messages", "chat", "消息日志"],
  ["settings", "settings", "配置管理"],
];

// Retain existing detail/trend links while grouping their navigation entry.
export function modulePage(page: string) {
  return (
    (
      {
        trends: "tickets",
        "staff-roster": "staff",
        agent: "accounts",
      } as Record<string, string>
    )[page] || page
  );
}

export function isKnownPage(page: string) {
  return navs.some(([id]) => id === modulePage(page));
}

export function moduleTabs(page: string) {
  const tickets = modulePage(page) === "tickets";
  const tabs = tickets
    ? [
        ["tickets", "工单明细"],
        ["trends", "工单趋势"],
      ]
    : [
        ["staff", "人员负载"],
        ["staff-roster", "排班人员"],
      ];
  return `<nav class="module-tabs" aria-label="${tickets ? "工单管理" : "人员与负载"}功能切换">${tabs.map(([id, label]) => `<a href="#${id}" ${page === id ? 'class="active" aria-current="page"' : ""}>${label}</a>`).join("")}</nav>`;
}
