import { runDueSchedules } from "./schedules";
const state = globalThis as typeof globalThis & { nautexSchedulerTimer?: ReturnType<typeof setInterval> };
export function startAgentScheduler() {
  if (state.nautexSchedulerTimer) return;
  let busy = false;
  state.nautexSchedulerTimer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try { await runDueSchedules(); }
    catch { console.error("Nautex scheduler tick failed; persisted schedules remain available for review."); }
    finally { busy = false; }
  }, 15000);
  state.nautexSchedulerTimer.unref();
}
