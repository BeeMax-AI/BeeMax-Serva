# MCP 接入契约与边界

浏览器 → 本应用 `/api/*` → `DataProvider` → MCP Server → 既有数据库及业务引擎。

MCP 凭据只放后端，浏览器不获取 MCP Token。所有业务读取、写入经适配器，不由界面访问数据库。`shared/domain.ts` 定义前端消费的归一化结构；真实字段变化在后端映射，页面不按客户名或小组名判断业务。

## 适配入口

`server/src/provider.ts` 的 `DataProvider`：

- `read(actor)`：返回该租户可见的 Workspace。
- `command(actor, command)`：按动作执行远程工具，并返回版本。

目前 `LocalProvider` 完整实现本地开发流程；`PendingMcpProvider` 明确返回 `MCP_NOT_CONFIGURED`。不要将 unknown tools/call 当作成功，不要在远程失败时回退写本地数据。

`read` 是当前小规模联调的聚合边界，正式数据量增大时，使用 `/api/tickets`、`/api/messages` 的分页契约，将聚合加载拆成对应资源读取，并保留前端的过滤查询结构。当前主界面使用 bootstrap 的本地记录集合进行筛选，不宣称已完成大数据量服务端分页界面。

## 已有业务动作与预期工具映射

以下名称来自用户早期规格，仅是待核实映射清单，尚未进行网络调用。

| 应用动作 | MCP 工具/待补能力 |
|---|---|
| 配置读取 | get_config |
| 配置历史 | list_config_changes |
| 工单列表 / 详情 | list_tickets / get_ticket |
| 总量与状态计数 | ticket_stats |
| 排班 / 在岗查询 | get_roster / query_on_duty |
| 路由读取 | get_routing_rules |
| 催办 / 转派 | urge_ticket / reassign_ticket |
| 挂起 / 恢复 / 完成 | hold_ticket / resume_ticket / complete_ticket |
| 配置覆写 / 恢复默认 | set_config / clear_config |
| 路由与排班写 | 确认 set_routing_rule、clear_routing_rule 及 roster 写工具实际参数 |
| 企微账号、连接状态、消息、白名单、凭据 | 等待本次交付接口 |
| 分析计划、历史报告、建议跟进、对话 | 确认由底座保存的工具与范围 |

不要用 `set_config` 任意路径绕过 owner 红线。路径与动作须在后端显式映射和允许列表内；本地 `role`、`tenantId` 和 `by` 不接受浏览器覆盖。

## 收到接口后需要确认

1. Streamable HTTP 或其他传输、端点、初始化协议版本、session header、JSON/SSE 响应与超时约定。
2. 鉴权方式与凭据交付；按客户鉴权还是单令牌携带租户范围；工具执行时如何强制隔离租户。
3. tools/list 及每个工具的 JSON Schema；成功/错误样例；`content[].text`、`structuredContent` 的实际形态。
4. 配置、人员、小组、实例、工单、消息的稳定 ID；状态枚举；缺失字段及时间戳单位；分页上限。
5. 写操作的权限、审计、幂等键和乐观并发支持；状态变更是否同步、是否会向外发消息。
6. 哪些功能暂不可用。缺少写工具时应显示只读状态与原因，不另造生产写入路径。

## HTTP 层

- `POST /api/login`、`POST /api/logout`
- `GET /api/bootstrap`：身份、当前客户基础数据、配置、报告、本人对话、当前统计。
- `GET /api/metrics?start=YYYY-MM-DD&end=YYYY-MM-DD`
- `GET /api/tickets?q=&status=&group=&page=1&size=20`
- `GET /api/tickets/:id`
- `GET /api/messages?q=&status=&account=&page=1&size=20`
- `POST /api/commands`：`{type,data,expectedRevision,requestId}`。
- `POST /api/reports`：`{start,end,name?,requestId}`。
- `POST /api/chat`：`{question,conversationId?,context?}`。

错误统一 `{error:{code,message}}`。401 重新登录，403 无权限，409 数据冲突/重复对象，503 MCP 未就绪。MCP 接入时将 transport、tool-level error 和权限错误映射到该结构，并确保响应不包含密钥。
