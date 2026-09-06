export const DEFAULT_SYNC_MINUTES = 5;
export function validSyncMinutes(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 1440
  );
}
export function readSyncMinutes(value: string | null): number {
  const minutes = Number(value);
  return validSyncMinutes(minutes) ? minutes : DEFAULT_SYNC_MINUTES;
}
export type SyncOutcome = "synced" | "failed" | "deferred";
export class SyncSchedule {
  private running = false;
  nextAt: number;
  constructor(
    public minutes = DEFAULT_SYNC_MINUTES,
    now = Date.now(),
  ) {
    this.nextAt = now + minutes * 60000;
  }
  configure(minutes: number, now = Date.now()) {
    if (!validSyncMinutes(minutes))
      throw new Error("同步间隔须为 1–1440 的整数分钟");
    this.minutes = minutes;
    this.reset(now);
  }
  reset(now = Date.now()) {
    this.nextAt = now + this.minutes * 60000;
  }
  async tick(
    task: () => Promise<SyncOutcome>,
    blocked: () => boolean,
    now = Date.now(),
  ) {
    if (this.running || now < this.nextAt || blocked()) return;
    this.running = true;
    try {
      const outcome = await task();
      if (outcome !== "deferred") this.reset();
    } catch {
      this.reset();
    } finally {
      this.running = false;
    }
  }
}
