import { w, title, button, canWrite } from "./core.js";
import { moduleTabs } from "./navigation.js";

export function dispatchParameters() {
  const data = w();
  return (
    title("人员与负载", "查看人员负载，管理排班与逐级通知。") +
    moduleTabs("staff-parameters") +
    `<section class="panel"><div class="config-title"><div><h2>派单与提醒</h2><p>分钟为单位，保存前核对变更。${data.integration ? "每次只修改一项；接单后完成提醒须为 60 分钟的倍数。" : ""}</p></div>${button("编辑参数", "parameters", false, !canWrite("parameters.save"))}</div>${[
      ["升级间隔", data.parameters.escalationMinutes],
      [
        data.integration ? "接单后完成提醒" : "接单提醒",
        data.parameters.acceptReminderMinutes,
      ],
      ["挂起提前提醒", data.parameters.holdReminderMinutes],
    ]
      .map(
        ([n, v]) =>
          `<div class="config-row"><h3>${n}</h3><strong>${v} 分钟</strong></div>`,
      )
      .join("")}</section>`
  );
}
