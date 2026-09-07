import type { Advice } from "./domain.js";

export function reviewDue(advice: Advice, today: string) {
  const date = advice.reviewAt;
  return (
    advice.status === "following" &&
    !!date &&
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(Date.parse(date)) &&
    new Date(date).toISOString().slice(0, 10) === date &&
    date <= today
  );
}

export function adviceFollowup(advice: Advice[], today: string) {
  // Match the existing action handlers, which resolve the first matching id.
  const seen = new Set<string>();
  const rows = advice.filter((a) => {
    if (seen.has(a.id)) return false;
    seen.add(a.id);
    return true;
  });
  const priority = { high: 0, medium: 1, low: 2 };
  rows.sort(
    (a, b) =>
      Number(reviewDue(b, today)) - Number(reviewDue(a, today)) ||
      Number(a.status === "done") - Number(b.status === "done") ||
      priority[a.priority ?? "low"] - priority[b.priority ?? "low"],
  );
  return {
    rows,
    pending: rows.filter((a) => a.status === "new").length,
    following: rows.filter((a) => a.status === "following").length,
    done: rows.filter((a) => a.status === "done").length,
    due: rows.filter((a) => reviewDue(a, today)).length,
  };
}
