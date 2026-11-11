/** Optional in-process scheduler. Enable with SCHEDULER_ENABLED=true. The job lock prevents overlapping runs. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.SCHEDULER_ENABLED !== "true") return;
  const minutes = Math.max(5, Number(process.env.SCHEDULE_INTERVAL_MINUTES || 360));
  const { startRun } = await import("@/lib/services/crawl");
  const tick = async () => {
    const r = await startRun({ trigger: "SCHEDULED", scope: "LIVE", dueOnly: true });
    console.log(r.ok ? `[scheduler] started run ${r.runId}` : `[scheduler] skipped: ${r.error}`);
  };
  console.log(`[scheduler] enabled, every ${minutes} min`);
  setTimeout(tick, 30_000);
  setInterval(tick, minutes * 60_000);
}
