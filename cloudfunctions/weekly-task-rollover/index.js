function createWeeklyRolloverHandler({ env = process.env, fetchImpl = fetch, now = Date.now } = {}) {
  return async function weeklyTaskRollover(event = {}) {
    const workbenchUrl = String(env.WORKBENCH_URL || "").replace(/\/$/, "");
    const secret = String(env.WEEKLY_ROLLOVER_SECRET || "");
    if (!workbenchUrl || !secret) throw new Error("Weekly rollover function is not configured");
    const eventTime = Date.parse(String(event.Time || ""));
    const triggeredAt = Number.isNaN(eventTime) ? now() : eventTime;
    const response = await fetchImpl(`${workbenchUrl}/api/internal/weekly-rollover`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-weekly-rollover-secret": secret,
      },
      body: JSON.stringify({ triggeredAt: new Date(triggeredAt).toISOString() }),
    });
    if (!response.ok) {
      const detail = typeof response.text === "function" ? await response.text() : "";
      throw new Error(`Weekly rollover endpoint failed with ${response.status}: ${detail.slice(0, 200)}`);
    }
    return response.json();
  };
}

exports.createWeeklyRolloverHandler = createWeeklyRolloverHandler;
exports.main = createWeeklyRolloverHandler();
