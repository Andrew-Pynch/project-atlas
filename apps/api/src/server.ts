import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getAtlasDb } from "@atlas/db";
import { getRecommendation } from "@atlas/llm";
import type { QuestState, TaskState } from "@atlas/core";

const db = getAtlasDb();
const port = Number(process.env.ATLAS_API_PORT ?? 3341);
const here = fileURLToPath(new URL(".", import.meta.url));
const defaultIndexPath = resolve(here, "../../../../PROJECT_INDEX.json");

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}

function noContent(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}

async function body(request: Request): Promise<Record<string, unknown>> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function toTaskState(value: unknown): TaskState | undefined {
  if (typeof value !== "string") return undefined;
  if (["todo", "doing", "review", "done", "blocked"].includes(value)) return value as TaskState;
  return undefined;
}

function toQuestState(value: unknown): QuestState | undefined {
  if (typeof value !== "string") return undefined;
  if (["todo", "active", "done", "blocked"].includes(value)) return value as QuestState;
  return undefined;
}

function maybeProjectIdFromCwd(cwd: string): string | undefined {
  const projects = db.listProjects();
  const match = projects
    .filter((project) => cwd.includes(project.path))
    .sort((a, b) => b.path.length - a.path.length)[0];
  return match?.id;
}

async function ensureQuest(projectId: string, questId?: string): Promise<string> {
  if (questId) return questId;
  const quests = db.listQuests(projectId);
  const existing = quests.find((quest) => quest.title.toLowerCase() === "general backlog");
  if (existing) return existing.id;
  const created = db.createQuest({
    projectId,
    title: "General Backlog",
    description: "Auto-created quest for uncategorized tasks.",
    state: "active",
    priority: 2,
    xpReward: 30,
  });
  return created.id;
}

Bun.serve({
  port,
  async fetch(request) {
    if (request.method === "OPTIONS") return noContent();

    const url = new URL(request.url);
    const { pathname, searchParams } = url;

    if (pathname === "/health") {
      return json({ ok: true, service: "atlas-api", port });
    }

    if (pathname === "/api/projects" && request.method === "GET") {
      return json({ projects: db.listProjects() });
    }

    if (pathname === "/api/projects/import-index" && request.method === "POST") {
      const payload = await body(request);
      const fromPath = typeof payload.path === "string" ? payload.path : process.env.ATLAS_PROJECT_INDEX ?? defaultIndexPath;
      const result = db.importProjectsFromIndex(fromPath);
      return json({ ok: true, ...result, path: fromPath });
    }

    if (pathname.startsWith("/api/projects/") && pathname.endsWith("/pulse") && request.method === "GET") {
      const projectId = pathname.replace("/api/projects/", "").replace("/pulse", "");
      const project = db.getProject(projectId);
      if (!project) {
        return json({ error: "Project not found" }, 404);
      }
      return json({ pulse: db.getProjectPulse(project.id) });
    }

    if (pathname === "/api/quests" && request.method === "GET") {
      const projectId = searchParams.get("projectId") ?? undefined;
      return json({ quests: db.listQuests(projectId) });
    }

    if (pathname === "/api/quests" && request.method === "POST") {
      const payload = await body(request);
      if (typeof payload.projectId !== "string" || typeof payload.title !== "string") {
        return json({ error: "projectId and title are required" }, 400);
      }
      const quest = db.createQuest({
        projectId: payload.projectId,
        title: payload.title,
        description: typeof payload.description === "string" ? payload.description : "",
        state: toQuestState(payload.state) ?? "todo",
        xpReward: typeof payload.xpReward === "number" ? payload.xpReward : 50,
        dueAt: typeof payload.dueAt === "string" ? payload.dueAt : null,
        priority: typeof payload.priority === "number" ? payload.priority : 2,
      });
      return json({ quest }, 201);
    }

    if (pathname.startsWith("/api/quests/") && request.method === "PATCH") {
      const questId = pathname.replace("/api/quests/", "");
      const payload = await body(request);
      const quest = db.updateQuest(questId, {
        title: typeof payload.title === "string" ? payload.title : undefined,
        description: typeof payload.description === "string" ? payload.description : undefined,
        state: toQuestState(payload.state),
        dueAt: typeof payload.dueAt === "string" ? payload.dueAt : undefined,
        priority: typeof payload.priority === "number" ? payload.priority : undefined,
        xpReward: typeof payload.xpReward === "number" ? payload.xpReward : undefined,
      });
      if (!quest) {
        return json({ error: "Quest not found" }, 404);
      }
      return json({ quest });
    }

    if (pathname === "/api/tasks" && request.method === "GET") {
      const projectId = searchParams.get("projectId") ?? undefined;
      const state = toTaskState(searchParams.get("state"));
      return json({ tasks: db.listTasks({ projectId, state }) });
    }

    if (pathname === "/api/tasks" && request.method === "POST") {
      const payload = await body(request);

      const questIdFromBody = typeof payload.questId === "string" ? payload.questId : undefined;
      const projectIdFromBody = typeof payload.projectId === "string" ? payload.projectId : undefined;
      if (!projectIdFromBody && !questIdFromBody) {
        return json({ error: "projectId or questId is required" }, 400);
      }
      if (typeof payload.title !== "string") {
        return json({ error: "title is required" }, 400);
      }

      let questId = questIdFromBody;
      if (!questId && projectIdFromBody) {
        questId = await ensureQuest(projectIdFromBody);
      }
      if (!questId) {
        return json({ error: "failed to resolve questId" }, 500);
      }

      const task = db.createTask({
        questId,
        title: payload.title,
        details: typeof payload.details === "string" ? payload.details : "",
        state: toTaskState(payload.state) ?? "todo",
        estimatePoints: typeof payload.estimatePoints === "number" ? payload.estimatePoints : 10,
        blockers: Array.isArray(payload.blockers) ? payload.blockers.filter((v): v is string => typeof v === "string") : [],
        notes: typeof payload.notes === "string" ? payload.notes : "",
      });

      return json({ task }, 201);
    }

    if (pathname.startsWith("/api/tasks/") && pathname.endsWith("/complete") && request.method === "POST") {
      const taskId = pathname.replace("/api/tasks/", "").replace("/complete", "");
      const task = db.completeTask(taskId);
      if (!task) {
        return json({ error: "Task not found" }, 404);
      }
      return json({ task });
    }

    if (pathname.startsWith("/api/tasks/") && request.method === "PATCH") {
      const taskId = pathname.replace("/api/tasks/", "");
      const payload = await body(request);
      const task = db.updateTask(taskId, {
        title: typeof payload.title === "string" ? payload.title : undefined,
        details: typeof payload.details === "string" ? payload.details : undefined,
        state: toTaskState(payload.state),
        estimatePoints: typeof payload.estimatePoints === "number" ? payload.estimatePoints : undefined,
        actualPoints: typeof payload.actualPoints === "number" ? payload.actualPoints : undefined,
        blockers: Array.isArray(payload.blockers) ? payload.blockers.filter((v): v is string => typeof v === "string") : undefined,
        notes: typeof payload.notes === "string" ? payload.notes : undefined,
      });
      if (!task) {
        return json({ error: "Task not found" }, 404);
      }
      return json({ task });
    }

    if (pathname === "/api/session-events" && request.method === "POST") {
      const payload = await body(request);
      if (typeof payload.cwd !== "string" || typeof payload.command !== "string") {
        return json({ error: "cwd and command are required" }, 400);
      }
      const event = db.logSessionEvent({
        agent: payload.agent === "codex" || payload.agent === "claude" ? payload.agent : "unknown",
        cwd: payload.cwd,
        command: payload.command,
        startedAt: typeof payload.startedAt === "string" ? payload.startedAt : new Date().toISOString(),
        endedAt: typeof payload.endedAt === "string" ? payload.endedAt : null,
        suggestedTaskIds: Array.isArray(payload.suggestedTaskIds)
          ? payload.suggestedTaskIds.filter((value): value is string => typeof value === "string")
          : [],
        metadata:
          payload.metadata && typeof payload.metadata === "object"
            ? Object.fromEntries(Object.entries(payload.metadata).map(([key, value]) => [key, String(value)]))
            : {},
      });
      return json({ event }, 201);
    }

    if (pathname === "/api/recommendations/next" && request.method === "GET") {
      const cwd = searchParams.get("cwd") ?? "";
      const projectIdParam = searchParams.get("projectId") ?? undefined;
      const projectId = projectIdParam ?? (cwd ? maybeProjectIdFromCwd(cwd) : undefined);

      const heuristic = db.getNextTaskRecommendation(projectId);
      const projects = db.listProjects().map((project) => ({
        id: project.id,
        name: project.name,
        healthScore: project.healthScore,
      }));
      const tasks = db.listTaskContexts(projectId);

      const llm = await getRecommendation({ projects, tasks, heuristic });

      return json({
        recommendation: heuristic,
        summary: llm.summary,
        recommendedTaskIds: llm.recommendedTaskIds,
        provider: llm.provider,
      });
    }

    return json({ error: "Not found" }, 404);
  },
});

console.log(`project-atlas API listening on http://localhost:${port}`);
