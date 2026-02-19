import type { LLMRecommendation, NextTaskRecommendation } from "@atlas/core";

export type RecommendationContext = {
  projects: Array<{ id: string; name: string; healthScore: number }>;
  tasks: Array<{ id: string; projectId: string; title: string; state: string; blockers: string[] }>;
  heuristic: NextTaskRecommendation | null;
};

export interface LLMProvider {
  recommend(context: RecommendationContext): Promise<LLMRecommendation | null>;
}

export class OpenAIProvider implements LLMProvider {
  readonly name = "openai";

  async recommend(context: RecommendationContext): Promise<LLMRecommendation | null> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return null;
    }

    const projectSummary = context.projects
      .slice(0, 10)
      .map((project) => `${project.name} (health ${project.healthScore})`)
      .join(", ");

    const taskSummary = context.tasks
      .slice(0, 20)
      .map((task) => `${task.title} [${task.state}] blockers:${task.blockers.length}`)
      .join("\n");

    const prompt = [
      "You are a project execution coach.",
      "Given project and task state, provide one concise execution summary and 1-3 task IDs to focus next.",
      "Return strict JSON: {\"summary\": string, \"recommendedTaskIds\": string[]}",
      `Projects: ${projectSummary}`,
      `Tasks:\n${taskSummary}`,
      context.heuristic ? `Heuristic top candidate taskId: ${context.heuristic.taskId}` : "No heuristic recommendation available."
    ].join("\n\n");

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.ATLAS_OPENAI_MODEL ?? "gpt-4o-mini",
        messages: [
          { role: "system", content: "You output valid JSON only." },
          { role: "user", content: prompt }
        ],
        temperature: 0.2,
      }),
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      return null;
    }

    try {
      const parsed = JSON.parse(content) as { summary?: string; recommendedTaskIds?: string[] };
      return {
        summary: parsed.summary ?? "Focus on the highest-impact unblocked task.",
        recommendedTaskIds: Array.isArray(parsed.recommendedTaskIds)
          ? parsed.recommendedTaskIds.filter((id) => typeof id === "string")
          : [],
        provider: this.name,
      };
    } catch {
      return null;
    }
  }
}

export function heuristicFallback(context: RecommendationContext): LLMRecommendation {
  if (context.heuristic) {
    return {
      summary: `Momentum move: ${context.heuristic.reason}`,
      recommendedTaskIds: [context.heuristic.taskId],
      provider: "heuristic",
    };
  }

  return {
    summary: "No active tasks yet. Create a quest and define the first concrete task.",
    recommendedTaskIds: [],
    provider: "heuristic",
  };
}

export async function getRecommendation(context: RecommendationContext): Promise<LLMRecommendation> {
  const providerSetting = (process.env.LLM_PROVIDER ?? "openai").toLowerCase();

  if (providerSetting === "openai") {
    const provider = new OpenAIProvider();
    const llmResult = await provider.recommend(context);
    if (llmResult) {
      return llmResult;
    }
  }

  return heuristicFallback(context);
}
