export function assembleLegacyNetlifyState(entries) {
  const state = {
    users: {},
    sessions: {},
    weeks: {},
    tasks: {},
    reports: {},
    goals: null,
    goalsByDepartment: {},
    aiUsage: {},
  };
  let ignoredSessions = 0;

  for (const [key, value] of entries) {
    if (key.startsWith("users/")) state.users[key.slice("users/".length)] = value;
    else if (key.startsWith("weeks/")) state.weeks[key.slice("weeks/".length)] = value;
    else if (key.startsWith("tasks/")) state.tasks[key.slice("tasks/".length)] = value;
    else if (key.startsWith("reports/")) state.reports[key.slice("reports/".length)] = value;
    else if (key === "department-goals/current") state.goals = value;
    else if (key.startsWith("sessions/")) ignoredSessions += 1;
  }

  return { state, ignoredSessions };
}
