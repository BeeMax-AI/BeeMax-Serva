import { state, offsetDate, toast } from "./core.js";
let exporting = false;
export async function exportBrief() {
  if (exporting || !state.boot) return;
  exporting = true;
  const actor = state.boot.actor;
  const isCurrent = () =>
    state.boot?.actor.id === actor.id &&
    state.boot?.actor.tenantId === actor.tenantId;
  const end = state.boot.today;
  const start = offsetDate(
    end,
    state.period === "day" ? 0 : state.period === "month" ? -29 : -6,
  );
  const button = document.querySelector<HTMLButtonElement>(
    '[data-action="export"]',
  );
  if (button) {
    button.disabled = true;
    button.textContent = "正在生成 PDF…";
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90000);
  try {
    const response = await fetch(
      `/api/brief.pdf?${new URLSearchParams({ start, end })}`,
      { signal: controller.signal },
    );
    if (!isCurrent()) return;
    if (!response.ok) {
      if (response.status === 401)
        window.dispatchEvent(new Event("session-expired"));
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error?.message || "简报生成失败，请重试");
    }
    if (!response.headers.get("content-type")?.includes("application/pdf"))
      throw new Error("未收到 PDF 文件，请重试");
    const blob = await response.blob();
    if (!isCurrent()) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `运营简报-${start}-${end}.pdf`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    toast("PDF 简报已生成");
  } catch (error) {
    if (!isCurrent()) return;
    toast(
      error instanceof Error && error.name !== "AbortError"
        ? error.message
        : "生成超时，请稍后重试",
    );
  } finally {
    clearTimeout(timeout);
    exporting = false;
    if (button?.isConnected) {
      button.disabled = false;
      button.textContent = "导出简报";
    }
  }
}
