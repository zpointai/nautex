export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NAUTEX_AGENT_SCHEDULER === "1") {
    const { startAgentScheduler } = await import("./lib/agents/scheduler-worker");
    startAgentScheduler();
  }
}
