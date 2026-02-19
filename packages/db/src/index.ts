import { Database } from "bun:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  clamp,
  nowIso,
  slugify,
  type NextTaskRecommendation,
  type Project,
  type ProjectPulse,
  type Quest,
  type QuestState,
  type SessionEvent,
  type Task,
  type TaskState,
} from "@atlas/core";

type ProjectIndexRecord = {
  path: string;
  project_type?: string;
  languages?: string[];
  has_git?: boolean;
  summary?: string;
  confidence?: string;
  notable_dirs?: string[];
  manifests?: string[];
};

type TaskFilter = {
  projectId?: string;
  state?: TaskState;
};

type QuestPatch = Partial<Pick<Quest, "title" | "description" | "state" | "dueAt" | "priority" | "xpReward">>;
type TaskPatch = Partial<Pick<Task, "title" | "details" | "state" | "estimatePoints" | "actualPoints" | "blockers" | "notes">>;

function parseJsonArray(value: unknown): string[] {
  if (typeof value !== "string") {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === "string");
    }
    return [];
  } catch {
    return [];
  }
}

function parseJsonRecord(value: unknown): Record<string, string> {
  if (typeof value !== "string") {
    return {};
  }
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object") {
      const out: Record<string, string> = {};
      for (const [key, item] of Object.entries(parsed)) {
        out[key] = String(item);
      }
      return out;
    }
    return {};
  } catch {
    return {};
  }
}

function toProject(row: Record<string, unknown>): Project {
  return {
    id: String(row.id),
    slug: String(row.slug),
    name: String(row.name),
    path: String(row.path),
    status: String(row.status) as Project["status"],
    tags: parseJsonArray(row.tags),
    healthScore: Number(row.health_score ?? 50),
    visualSeed: String(row.visual_seed),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function toQuest(row: Record<string, unknown>): Quest {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    title: String(row.title),
    description: String(row.description ?? ""),
    state: String(row.state) as QuestState,
    xpReward: Number(row.xp_reward ?? 50),
    dueAt: row.due_at ? String(row.due_at) : null,
    priority: Number(row.priority ?? 2),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function toTask(row: Record<string, unknown>): Task {
  return {
    id: String(row.id),
    questId: String(row.quest_id),
    title: String(row.title),
    details: String(row.details ?? ""),
    state: String(row.state) as TaskState,
    estimatePoints: Number(row.estimate_points ?? 10),
    actualPoints: row.actual_points === null || row.actual_points === undefined ? null : Number(row.actual_points),
    blockers: parseJsonArray(row.blockers),
    notes: String(row.notes ?? ""),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    completedAt: row.completed_at ? String(row.completed_at) : null,
  };
}

function toSessionEvent(row: Record<string, unknown>): SessionEvent {
  return {
    id: String(row.id),
    agent: String(row.agent) as SessionEvent["agent"],
    cwd: String(row.cwd),
    command: String(row.command),
    startedAt: String(row.started_at),
    endedAt: row.ended_at ? String(row.ended_at) : null,
    suggestedTaskIds: parseJsonArray(row.suggested_task_ids),
    metadata: parseJsonRecord(row.metadata),
  };
}

function uid(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}

const schema = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active',
  tags TEXT NOT NULL DEFAULT '[]',
  health_score INTEGER NOT NULL DEFAULT 50,
  visual_seed TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  project_type TEXT NOT NULL DEFAULT 'project',
  languages TEXT NOT NULL DEFAULT '[]',
  has_git INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS quests (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'todo',
  xp_reward INTEGER NOT NULL DEFAULT 50,
  due_at TEXT,
  priority INTEGER NOT NULL DEFAULT 2,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  quest_id TEXT NOT NULL,
  title TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'todo',
  estimate_points INTEGER NOT NULL DEFAULT 10,
  actual_points INTEGER,
  blockers TEXT NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY(quest_id) REFERENCES quests(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS session_events (
  id TEXT PRIMARY KEY,
  agent TEXT NOT NULL,
  cwd TEXT NOT NULL,
  command TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  suggested_task_ids TEXT NOT NULL DEFAULT '[]',
  metadata TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_quests_project_id ON quests(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_quest_id ON tasks(quest_id);
CREATE INDEX IF NOT EXISTS idx_tasks_state ON tasks(state);
CREATE INDEX IF NOT EXISTS idx_tasks_completed_at ON tasks(completed_at);
`;

export class AtlasDb {
  private db: Database;

  constructor(dbPath?: string) {
    const here = fileURLToPath(new URL(".", import.meta.url));
    const inferredDefault = resolve(here, "../../../data/project-atlas.db");
    const path = dbPath ?? process.env.ATLAS_DB_PATH ?? inferredDefault;
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
  }

  init(): void {
    this.db.exec(schema);
  }

  close(): void {
    this.db.close();
  }

  listProjects(): Project[] {
    const rows = this.db.query("SELECT * FROM projects ORDER BY updated_at DESC").all() as Record<string, unknown>[];
    return rows.map(toProject);
  }

  getProject(projectId: string): Project | null {
    const row = this.db.query("SELECT * FROM projects WHERE id = ? OR slug = ? OR path = ? LIMIT 1").get(projectId, projectId, projectId) as Record<string, unknown> | null;
    return row ? toProject(row) : null;
  }

  listQuests(projectId?: string): Quest[] {
    const rows = projectId
      ? (this.db.query("SELECT * FROM quests WHERE project_id = ? ORDER BY priority DESC, updated_at DESC").all(projectId) as Record<string, unknown>[])
      : (this.db.query("SELECT * FROM quests ORDER BY updated_at DESC").all() as Record<string, unknown>[]);
    return rows.map(toQuest);
  }

  createQuest(input: {
    projectId: string;
    title: string;
    description?: string;
    state?: QuestState;
    xpReward?: number;
    dueAt?: string | null;
    priority?: number;
  }): Quest {
    const createdAt = nowIso();
    const quest: Quest = {
      id: uid("quest"),
      projectId: input.projectId,
      title: input.title,
      description: input.description ?? "",
      state: input.state ?? "todo",
      xpReward: input.xpReward ?? 50,
      dueAt: input.dueAt ?? null,
      priority: input.priority ?? 2,
      createdAt,
      updatedAt: createdAt,
    };

    this.db
      .query(
        `INSERT INTO quests (id, project_id, title, description, state, xp_reward, due_at, priority, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        quest.id,
        quest.projectId,
        quest.title,
        quest.description,
        quest.state,
        quest.xpReward,
        quest.dueAt,
        quest.priority,
        quest.createdAt,
        quest.updatedAt
      );

    this.touchProjectByQuest(quest.id);
    return quest;
  }

  updateQuest(questId: string, patch: QuestPatch): Quest | null {
    const current = this.db.query("SELECT * FROM quests WHERE id = ? LIMIT 1").get(questId) as Record<string, unknown> | null;
    if (!current) {
      return null;
    }
    const next = {
      title: patch.title ?? String(current.title),
      description: patch.description ?? String(current.description ?? ""),
      state: patch.state ?? (String(current.state) as QuestState),
      dueAt: patch.dueAt ?? (current.due_at ? String(current.due_at) : null),
      priority: patch.priority ?? Number(current.priority ?? 2),
      xpReward: patch.xpReward ?? Number(current.xp_reward ?? 50),
      updatedAt: nowIso(),
    };

    this.db
      .query(
        `UPDATE quests
         SET title = ?, description = ?, state = ?, due_at = ?, priority = ?, xp_reward = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(next.title, next.description, next.state, next.dueAt, next.priority, next.xpReward, next.updatedAt, questId);

    this.touchProjectByQuest(questId);
    const updated = this.db.query("SELECT * FROM quests WHERE id = ?").get(questId) as Record<string, unknown>;
    return toQuest(updated);
  }

  listTasks(filter: TaskFilter = {}): Task[] {
    if (filter.projectId) {
      const rows = this.db
        .query(
          `SELECT t.*
           FROM tasks t
           JOIN quests q ON q.id = t.quest_id
           WHERE q.project_id = ?
           ${filter.state ? "AND t.state = ?" : ""}
           ORDER BY t.updated_at DESC`
        )
        .all(...(filter.state ? [filter.projectId, filter.state] : [filter.projectId])) as Record<string, unknown>[];
      return rows.map(toTask);
    }

    const rows = filter.state
      ? (this.db.query("SELECT * FROM tasks WHERE state = ? ORDER BY updated_at DESC").all(filter.state) as Record<string, unknown>[])
      : (this.db.query("SELECT * FROM tasks ORDER BY updated_at DESC").all() as Record<string, unknown>[]);
    return rows.map(toTask);
  }

  listTaskContexts(projectId?: string): Array<{ id: string; projectId: string; title: string; state: TaskState; blockers: string[] }> {
    const rows = this.db
      .query(
        `SELECT
          t.id as task_id,
          t.title as task_title,
          t.state as task_state,
          t.blockers as blockers,
          q.project_id as project_id
        FROM tasks t
        JOIN quests q ON q.id = t.quest_id
        ${projectId ? "WHERE q.project_id = ?" : ""}
        ORDER BY t.updated_at DESC`
      )
      .all(...(projectId ? [projectId] : [])) as Record<string, unknown>[];

    return rows.map((row) => ({
      id: String(row.task_id),
      projectId: String(row.project_id),
      title: String(row.task_title),
      state: String(row.task_state) as TaskState,
      blockers: parseJsonArray(row.blockers),
    }));
  }

  createTask(input: {
    questId: string;
    title: string;
    details?: string;
    state?: TaskState;
    estimatePoints?: number;
    blockers?: string[];
    notes?: string;
  }): Task {
    const createdAt = nowIso();
    const task: Task = {
      id: uid("task"),
      questId: input.questId,
      title: input.title,
      details: input.details ?? "",
      state: input.state ?? "todo",
      estimatePoints: input.estimatePoints ?? 10,
      actualPoints: null,
      blockers: input.blockers ?? [],
      notes: input.notes ?? "",
      createdAt,
      updatedAt: createdAt,
      completedAt: null,
    };

    this.db
      .query(
        `INSERT INTO tasks
         (id, quest_id, title, details, state, estimate_points, actual_points, blockers, notes, created_at, updated_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        task.id,
        task.questId,
        task.title,
        task.details,
        task.state,
        task.estimatePoints,
        task.actualPoints,
        JSON.stringify(task.blockers),
        task.notes,
        task.createdAt,
        task.updatedAt,
        task.completedAt
      );

    this.touchProjectByQuest(task.questId);
    return task;
  }

  updateTask(taskId: string, patch: TaskPatch): Task | null {
    const current = this.db.query("SELECT * FROM tasks WHERE id = ? LIMIT 1").get(taskId) as Record<string, unknown> | null;
    if (!current) {
      return null;
    }
    const nextState = patch.state ?? (String(current.state) as TaskState);
    const completedAt = nextState === "done" ? (current.completed_at ? String(current.completed_at) : nowIso()) : null;
    const next = {
      title: patch.title ?? String(current.title),
      details: patch.details ?? String(current.details ?? ""),
      state: nextState,
      estimatePoints: patch.estimatePoints ?? Number(current.estimate_points ?? 10),
      actualPoints: patch.actualPoints ?? (current.actual_points === null ? null : Number(current.actual_points)),
      blockers: patch.blockers ?? parseJsonArray(current.blockers),
      notes: patch.notes ?? String(current.notes ?? ""),
      updatedAt: nowIso(),
      completedAt,
    };

    this.db
      .query(
        `UPDATE tasks
         SET title = ?, details = ?, state = ?, estimate_points = ?, actual_points = ?, blockers = ?, notes = ?, updated_at = ?, completed_at = ?
         WHERE id = ?`
      )
      .run(
        next.title,
        next.details,
        next.state,
        next.estimatePoints,
        next.actualPoints,
        JSON.stringify(next.blockers),
        next.notes,
        next.updatedAt,
        next.completedAt,
        taskId
      );

    const questId = String(current.quest_id);
    this.touchProjectByQuest(questId);
    const updated = this.db.query("SELECT * FROM tasks WHERE id = ? LIMIT 1").get(taskId) as Record<string, unknown>;
    return toTask(updated);
  }

  completeTask(taskId: string): Task | null {
    const current = this.db.query("SELECT * FROM tasks WHERE id = ? LIMIT 1").get(taskId) as Record<string, unknown> | null;
    if (!current) {
      return null;
    }

    const doneAt = nowIso();
    const actualPoints = current.actual_points === null || current.actual_points === undefined
      ? Number(current.estimate_points ?? 10)
      : Number(current.actual_points);

    this.db
      .query(
        `UPDATE tasks
         SET state = 'done', completed_at = ?, updated_at = ?, actual_points = ?
         WHERE id = ?`
      )
      .run(doneAt, doneAt, actualPoints, taskId);

    const questId = String(current.quest_id);
    this.touchProjectByQuest(questId);
    const updated = this.db.query("SELECT * FROM tasks WHERE id = ? LIMIT 1").get(taskId) as Record<string, unknown>;
    return toTask(updated);
  }

  logSessionEvent(input: Omit<SessionEvent, "id">): SessionEvent {
    const event: SessionEvent = {
      ...input,
      id: uid("evt"),
    };

    this.db
      .query(
        `INSERT INTO session_events (id, agent, cwd, command, started_at, ended_at, suggested_task_ids, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        event.id,
        event.agent,
        event.cwd,
        event.command,
        event.startedAt,
        event.endedAt,
        JSON.stringify(event.suggestedTaskIds),
        JSON.stringify(event.metadata)
      );

    return event;
  }

  listSessionEvents(limit = 100): SessionEvent[] {
    const rows = this.db
      .query("SELECT * FROM session_events ORDER BY started_at DESC LIMIT ?")
      .all(limit) as Record<string, unknown>[];
    return rows.map(toSessionEvent);
  }

  importProjectsFromIndex(indexPath: string): { imported: number; updated: number } {
    const raw = readFileSync(indexPath, "utf8");
    const records = JSON.parse(raw) as ProjectIndexRecord[];
    let imported = 0;
    let updated = 0;

    for (const record of records) {
      if (!record.path) {
        continue;
      }
      const existing = this.db.query("SELECT id FROM projects WHERE path = ? LIMIT 1").get(record.path) as { id: string } | null;
      const id = existing?.id ?? uid("proj");
      const now = nowIso();
      const pathParts = record.path.split("/");
      const name = pathParts[pathParts.length - 1]
        .replace(/[-_]+/g, " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase());
      const slug = slugify(record.path.replaceAll("/", "-"));
      const tags = [record.project_type ?? "project", ...(record.languages ?? []).slice(0, 2)].map((item) => item.toLowerCase());

      this.db
        .query(
          `INSERT INTO projects
           (id, slug, name, path, status, tags, health_score, visual_seed, summary, project_type, languages, has_git, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(path) DO UPDATE SET
             slug = excluded.slug,
             name = excluded.name,
             tags = excluded.tags,
             visual_seed = excluded.visual_seed,
             summary = excluded.summary,
             project_type = excluded.project_type,
             languages = excluded.languages,
             has_git = excluded.has_git,
             updated_at = excluded.updated_at`
        )
        .run(
          id,
          slug,
          name,
          record.path,
          "active",
          JSON.stringify(tags),
          55,
          record.path,
          record.summary ?? "",
          record.project_type ?? "project",
          JSON.stringify(record.languages ?? []),
          record.has_git ? 1 : 0,
          now,
          now
        );

      if (existing) {
        updated += 1;
      } else {
        imported += 1;
      }
    }

    return { imported, updated };
  }

  getProjectPulse(projectId: string): ProjectPulse {
    const tasks = this.listTasks({ projectId });
    const total = tasks.length;
    const tasksTodo = tasks.filter((task) => task.state === "todo").length;
    const tasksDoing = tasks.filter((task) => task.state === "doing" || task.state === "review").length;
    const tasksBlocked = tasks.filter((task) => task.state === "blocked").length;
    const tasksDone = tasks.filter((task) => task.state === "done").length;

    const completionPercent = total > 0 ? Math.round((tasksDone / total) * 100) : 0;
    const velocity7d = tasks.filter((task) => {
      if (!task.completedAt) {
        return false;
      }
      const completedAt = new Date(task.completedAt).getTime();
      const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      return completedAt >= sevenDaysAgo;
    }).length;

    const xpEarned = tasks
      .filter((task) => task.state === "done")
      .reduce((totalXp, task) => totalXp + (task.actualPoints ?? task.estimatePoints), 0);

    const latestUpdate = tasks
      .map((task) => new Date(task.updatedAt).getTime())
      .sort((a, b) => b - a)[0] ?? 0;
    const stale = latestUpdate > 0 ? Date.now() - latestUpdate > 10 * 24 * 60 * 60 * 1000 : true;

    const next = this.getNextTaskRecommendation(projectId);

    return {
      projectId,
      completionPercent,
      tasksTodo,
      tasksDoing,
      tasksBlocked,
      tasksDone,
      velocity7d,
      stale,
      xpEarned,
      nextAction: next?.reason ?? "Create your first quest to start momentum.",
    };
  }

  getNextTaskRecommendation(projectId?: string): NextTaskRecommendation | null {
    const rows = this.db
      .query(
        `SELECT
           t.id as task_id,
           t.title as task_title,
           t.state as task_state,
           t.blockers as blockers,
           t.estimate_points as estimate_points,
           q.id as quest_id,
           q.state as quest_state,
           q.priority as quest_priority,
           q.title as quest_title,
           p.id as project_id,
           p.name as project_name
         FROM tasks t
         JOIN quests q ON q.id = t.quest_id
         JOIN projects p ON p.id = q.project_id
         WHERE t.state IN ('todo', 'doing', 'review')
           ${projectId ? "AND p.id = ?" : ""}
         ORDER BY q.priority DESC, t.updated_at DESC`
      )
      .all(...(projectId ? [projectId] : [])) as Record<string, unknown>[];

    if (rows.length === 0) {
      return null;
    }

    let top: NextTaskRecommendation | null = null;
    for (const row of rows) {
      const blockers = parseJsonArray(row.blockers);
      let score = 0;
      const state = String(row.task_state);
      if (state === "doing") score += 40;
      if (state === "review") score += 34;
      if (state === "todo") score += 24;
      score += Number(row.quest_priority ?? 2) * 11;
      if (String(row.quest_state) === "active") score += 18;
      score -= blockers.length * 20;
      score = clamp(score, 0, 100);

      const reason = blockers.length > 0
        ? `Unblock ${String(row.task_title)} in ${String(row.project_name)}.`
        : `Push ${String(row.task_title)} (${String(row.quest_title)}) forward.`;

      const candidate: NextTaskRecommendation = {
        taskId: String(row.task_id),
        projectId: String(row.project_id),
        reason,
        score,
      };

      if (!top || candidate.score > top.score) {
        top = candidate;
      }
    }

    return top;
  }

  private touchProjectByQuest(questId: string): void {
    const row = this.db.query("SELECT project_id FROM quests WHERE id = ? LIMIT 1").get(questId) as { project_id: string } | null;
    if (!row) {
      return;
    }
    const pulse = this.getProjectPulse(row.project_id);

    const healthScore = clamp(
      Math.round(
        pulse.completionPercent * 0.5 +
          Math.min(25, pulse.velocity7d * 3) +
          (pulse.tasksBlocked > 0 ? -12 : 8) +
          (pulse.stale ? -16 : 8)
      ),
      0,
      100
    );

    this.db
      .query("UPDATE projects SET updated_at = ?, health_score = ? WHERE id = ?")
      .run(nowIso(), healthScore, row.project_id);
  }
}

let singleton: AtlasDb | null = null;

export function getAtlasDb(dbPath?: string): AtlasDb {
  if (!singleton) {
    singleton = new AtlasDb(dbPath);
    singleton.init();
  }
  return singleton;
}
