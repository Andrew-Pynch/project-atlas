const apiBase = process.env.ATLAS_API_BASE ?? "http://localhost:3341";
const cwd = process.argv[2] ?? process.cwd();
const agent = process.argv[3] ?? "unknown";

async function run(): Promise<void> {
  const recommendation = await fetch(`${apiBase}/api/recommendations/next?cwd=${encodeURIComponent(cwd)}`)
    .then((response) => (response.ok ? response.json() : null))
    .catch(() => null) as {
      recommendation?: { reason?: string; taskId?: string; projectId?: string; score?: number };
      summary?: string;
      provider?: string;
    } | null;

  if (!recommendation) {
    return;
  }

  const rec = recommendation.recommendation;
  if (rec?.taskId) {
    console.log(`[atlas] ${recommendation.summary ?? rec.reason ?? "Next task available."}`);
    console.log(`[atlas] task=${rec.taskId} project=${rec.projectId ?? "n/a"} score=${rec.score ?? 0} provider=${recommendation.provider ?? "heuristic"}`);
  } else if (recommendation.summary) {
    console.log(`[atlas] ${recommendation.summary}`);
  }

  await fetch(`${apiBase}/api/session-events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      agent,
      cwd,
      command: process.argv.slice(4).join(" "),
      startedAt: new Date().toISOString(),
      suggestedTaskIds: rec?.taskId ? [rec.taskId] : [],
      metadata: { source: "startup-brief" },
    }),
  }).catch(() => null);
}

void run();
