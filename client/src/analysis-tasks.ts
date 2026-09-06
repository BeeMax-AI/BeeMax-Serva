import type { AnalysisTask, Report } from "../../shared/domain.js";
import { api, state, toast } from "./core.js";
let polling = false;
const due = new Map<string, number>();
export async function pollAnalysisTasks(): Promise<boolean> {
  const boot = state.boot;
  if (polling || !boot || document.hidden) return false;
  const tasks = (boot.analysisTasks || []).filter((t) =>
    ["queued", "running"].includes(t.status),
  );
  let completed = (boot.analysisTasks || []).some(
    (t) => t.status === "completed",
  );
  if (!tasks.length && !completed) return false;
  polling = true;
  let changed = false;
  try {
    for (const task of tasks
      .filter((t) => (due.get(t.id) || 0) <= Date.now())
      .sort((a, b) => (due.get(a.id) || 0) - (due.get(b.id) || 0))
      .slice(0, 4)) {
      due.set(task.id, Date.now() + 30000);
      const result = await api<AnalysisTask>(
        `/analysis-tasks/${encodeURIComponent(task.id)}`,
      );
      if (state.boot !== boot) return false;
      due.set(task.id, Date.now() + result.retryAfterSeconds * 1000);
      changed ||= JSON.stringify(result) !== JSON.stringify(task);
      Object.assign(task, result);
      completed ||= result.status === "completed";
    }
    if (completed) {
      const result = await api<{ tasks: AnalysisTask[]; reports: Report[] }>(
        "/analysis-tasks",
      );
      if (state.boot !== boot) return false;
      boot.analysisTasks = result.tasks;
      boot.workspace.reports = result.reports;
      toast("AI 分析已完成，报告已保存");
      changed = true;
    }
  } catch {
    /* Keep tasks visible and retry later; the backend continues independently. */
  } finally {
    polling = false;
  }
  return changed;
}
