export type ProjectStatus = "active" | "paused" | "archived";
export type QuestState = "todo" | "active" | "done" | "blocked";
export type TaskState = "todo" | "doing" | "review" | "done" | "blocked";

export interface Project {
  id: string;
  slug: string;
  name: string;
  path: string;
  status: ProjectStatus;
  tags: string[];
  healthScore: number;
  visualSeed: string;
  createdAt: string;
  updatedAt: string;
}

export interface Quest {
  id: string;
  projectId: string;
  title: string;
  description: string;
  state: QuestState;
  xpReward: number;
  dueAt: string | null;
  priority: number;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  questId: string;
  title: string;
  details: string;
  state: TaskState;
  estimatePoints: number;
  actualPoints: number | null;
  blockers: string[];
  notes: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface SessionEvent {
  id: string;
  agent: "codex" | "claude" | "unknown";
  cwd: string;
  command: string;
  startedAt: string;
  endedAt: string | null;
  suggestedTaskIds: string[];
  metadata: Record<string, string>;
}

export interface ProjectPulse {
  projectId: string;
  completionPercent: number;
  tasksTodo: number;
  tasksDoing: number;
  tasksBlocked: number;
  tasksDone: number;
  velocity7d: number;
  stale: boolean;
  xpEarned: number;
  nextAction: string;
}

export interface NextTaskRecommendation {
  taskId: string;
  projectId: string;
  reason: string;
  score: number;
}

export interface LLMRecommendation {
  summary: string;
  recommendedTaskIds: string[];
  provider: string;
}

export const QUEST_STATES: QuestState[] = ["todo", "active", "done", "blocked"];
export const TASK_STATES: TaskState[] = ["todo", "doing", "review", "done", "blocked"];

export function nowIso(): string {
  return new Date().toISOString();
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function seededPalette(seed: string): { from: string; to: string; accent: string } {
  const hash = hashToInt(seed);
  const hueA = hash % 360;
  const hueB = (hueA + 44 + (hash % 63)) % 360;
  const hueC = (hueB + 120) % 360;
  return {
    from: `hsl(${hueA} 88% 56%)`,
    to: `hsl(${hueB} 78% 46%)`,
    accent: `hsl(${hueC} 92% 64%)`
  };
}

export function hashToInt(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}
