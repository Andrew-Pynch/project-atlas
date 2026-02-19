import { getAtlasDb } from "@atlas/db";
import { getRecommendation } from "@atlas/llm";

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
};

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

const db = getAtlasDb();

function toTaskState(value: unknown): "todo" | "doing" | "review" | "done" | "blocked" | undefined {
  if (typeof value !== "string") return undefined;
  if (["todo", "doing", "review", "done", "blocked"].includes(value)) {
    return value as "todo" | "doing" | "review" | "done" | "blocked";
  }
  return undefined;
}

const tools = [
  {
    name: "list_projects",
    description: "List all tracked projects.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_project_pulse",
    description: "Get pulse metrics for a project by id/slug/path.",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string" },
      },
      required: ["project_id"],
    },
  },
  {
    name: "list_tasks",
    description: "List tasks filtered by project and/or state.",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string" },
        state: { type: "string" },
      },
    },
  },
  {
    name: "create_task",
    description: "Create a task in an existing quest or project backlog.",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string" },
        quest_id: { type: "string" },
        title: { type: "string" },
        details: { type: "string" },
        estimate_points: { type: "number" },
      },
      required: ["title"],
    },
  },
  {
    name: "update_task",
    description: "Update fields on a task.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string" },
        title: { type: "string" },
        details: { type: "string" },
        state: { type: "string" },
        blockers: { type: "array", items: { type: "string" } },
        notes: { type: "string" },
        estimate_points: { type: "number" },
      },
      required: ["task_id"],
    },
  },
  {
    name: "complete_task",
    description: "Mark a task complete and award XP points.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string" },
      },
      required: ["task_id"],
    },
  },
  {
    name: "get_next_task",
    description: "Get next task recommendation and optional LLM summary.",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string" },
      },
    },
  },
  {
    name: "log_session_event",
    description: "Log a codex/claude session event.",
    inputSchema: {
      type: "object",
      properties: {
        agent: { type: "string" },
        cwd: { type: "string" },
        command: { type: "string" },
        started_at: { type: "string" },
        ended_at: { type: "string" },
      },
      required: ["cwd", "command"],
    },
  },
];

function writeMessage(payload: unknown): void {
  const json = JSON.stringify(payload);
  const content = Buffer.from(json, "utf8");
  const header = Buffer.from(`Content-Length: ${content.length}\r\n\r\n`, "utf8");
  process.stdout.write(Buffer.concat([header, content]));
}

function ok(id: string | number, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function fail(id: string | number, message: string, data?: unknown): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code: -32000,
      message,
      data,
    },
  };
}

async function ensureQuest(projectId?: string, questId?: string): Promise<string> {
  if (questId) return questId;
  if (!projectId) {
    throw new Error("project_id or quest_id is required");
  }
  const quests = db.listQuests(projectId);
  const existing = quests.find((quest) => quest.title.toLowerCase() === "general backlog");
  if (existing) return existing.id;
  return db.createQuest({
    projectId,
    title: "General Backlog",
    description: "Auto-created quest for MCP-created tasks.",
    state: "active",
    priority: 2,
    xpReward: 30,
  }).id;
}

async function callTool(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
  switch (name) {
    case "list_projects": {
      return { projects: db.listProjects() };
    }
    case "get_project_pulse": {
      if (typeof args.project_id !== "string") {
        throw new Error("project_id is required");
      }
      const project = db.getProject(args.project_id);
      if (!project) {
        throw new Error("project not found");
      }
      return { project, pulse: db.getProjectPulse(project.id) };
    }
    case "list_tasks": {
      const projectId = typeof args.project_id === "string" ? args.project_id : undefined;
      const state = toTaskState(args.state);
      return { tasks: db.listTasks({ projectId, state }) };
    }
    case "create_task": {
      if (typeof args.title !== "string") {
        throw new Error("title is required");
      }
      const questId = await ensureQuest(
        typeof args.project_id === "string" ? args.project_id : undefined,
        typeof args.quest_id === "string" ? args.quest_id : undefined
      );
      const task = db.createTask({
        questId,
        title: args.title,
        details: typeof args.details === "string" ? args.details : "",
        estimatePoints: typeof args.estimate_points === "number" ? args.estimate_points : 10,
      });
      return { task };
    }
    case "update_task": {
      if (typeof args.task_id !== "string") {
        throw new Error("task_id is required");
      }
      const task = db.updateTask(args.task_id, {
        title: typeof args.title === "string" ? args.title : undefined,
        details: typeof args.details === "string" ? args.details : undefined,
        state: toTaskState(args.state),
        blockers: Array.isArray(args.blockers) ? args.blockers.filter((entry): entry is string => typeof entry === "string") : undefined,
        notes: typeof args.notes === "string" ? args.notes : undefined,
        estimatePoints: typeof args.estimate_points === "number" ? args.estimate_points : undefined,
      });
      if (!task) {
        throw new Error("task not found");
      }
      return { task };
    }
    case "complete_task": {
      if (typeof args.task_id !== "string") {
        throw new Error("task_id is required");
      }
      const task = db.completeTask(args.task_id);
      if (!task) {
        throw new Error("task not found");
      }
      return { task };
    }
    case "get_next_task": {
      const projectId = typeof args.project_id === "string" ? args.project_id : undefined;
      const heuristic = db.getNextTaskRecommendation(projectId);
      const projects = db.listProjects().map((project) => ({ id: project.id, name: project.name, healthScore: project.healthScore }));
      const tasks = db.listTaskContexts(projectId);
      const llm = await getRecommendation({ projects, tasks, heuristic });
      return { recommendation: heuristic, summary: llm.summary, provider: llm.provider, recommendedTaskIds: llm.recommendedTaskIds };
    }
    case "log_session_event": {
      if (typeof args.cwd !== "string" || typeof args.command !== "string") {
        throw new Error("cwd and command are required");
      }
      const event = db.logSessionEvent({
        agent: args.agent === "codex" || args.agent === "claude" ? args.agent : "unknown",
        cwd: args.cwd,
        command: args.command,
        startedAt: typeof args.started_at === "string" ? args.started_at : new Date().toISOString(),
        endedAt: typeof args.ended_at === "string" ? args.ended_at : null,
        suggestedTaskIds: Array.isArray(args.suggested_task_ids)
          ? args.suggested_task_ids.filter((entry): entry is string => typeof entry === "string")
          : [],
        metadata: {},
      });
      return { event };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function handle(message: JsonRpcRequest): Promise<void> {
  if (message.method === "notifications/initialized") {
    return;
  }

  if (message.id === undefined || message.id === null) {
    return;
  }

  try {
    switch (message.method) {
      case "initialize": {
        writeMessage(ok(message.id, {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: {
            name: "project-atlas-mcp",
            version: "0.1.0",
          },
        }));
        return;
      }
      case "tools/list": {
        writeMessage(ok(message.id, { tools }));
        return;
      }
      case "tools/call": {
        const name = typeof message.params?.name === "string" ? message.params.name : "";
        const args = (message.params?.arguments as Record<string, unknown> | undefined) ?? {};
        const result = await callTool(name, args);
        writeMessage(ok(message.id, {
          content: [
            {
              type: "text",
              text: JSON.stringify(result),
            },
          ],
          structuredContent: result,
        }));
        return;
      }
      case "ping": {
        writeMessage(ok(message.id, { pong: true }));
        return;
      }
      default:
        writeMessage(fail(message.id, `Unknown method: ${message.method}`));
    }
  } catch (error) {
    writeMessage(
      fail(
        message.id,
        error instanceof Error ? error.message : "Unexpected error",
        error instanceof Error ? { stack: error.stack } : undefined
      )
    );
  }
}

let buffer = Buffer.alloc(0);

process.stdin.on("data", (chunk: Buffer) => {
  buffer = Buffer.concat([buffer, chunk]);

  while (true) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) {
      break;
    }

    const header = buffer.subarray(0, headerEnd).toString("utf8");
    const lengthLine = header
      .split("\r\n")
      .find((line) => line.toLowerCase().startsWith("content-length:"));
    if (!lengthLine) {
      buffer = buffer.subarray(headerEnd + 4);
      continue;
    }

    const length = Number(lengthLine.split(":")[1]?.trim() ?? 0);
    const messageStart = headerEnd + 4;
    const messageEnd = messageStart + length;
    if (buffer.length < messageEnd) {
      break;
    }

    const payload = buffer.subarray(messageStart, messageEnd).toString("utf8");
    buffer = buffer.subarray(messageEnd);

    try {
      const json = JSON.parse(payload) as JsonRpcRequest;
      void handle(json);
    } catch {
      // Ignore malformed messages.
    }
  }
});

process.stdin.resume();
