"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { seededPalette, type Project, type ProjectPulse, type Quest, type Task } from "@atlas/core";

type Filter = "all" | "active" | "stale" | "blocked";

type ProjectWithPulse = {
  project: Project;
  pulse: ProjectPulse;
};

const API_BASE = process.env.NEXT_PUBLIC_ATLAS_API_BASE ?? "http://localhost:3341";

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  return (await response.json()) as T;
}

export default function Page(): React.ReactElement {
  const [projects, setProjects] = useState<ProjectWithPulse[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [quests, setQuests] = useState<Quest[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [summary, setSummary] = useState<string>("Loading tactical route...");
  const [loading, setLoading] = useState<boolean>(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [newQuest, setNewQuest] = useState<string>("");
  const [newTask, setNewTask] = useState<string>("");

  async function loadProjects(): Promise<void> {
    setLoading(true);
    try {
      let payload = await fetchJson<{ projects: Project[] }>(`${API_BASE}/api/projects`);
      if (payload.projects.length === 0) {
        await fetchJson(`${API_BASE}/api/projects/import-index`, { method: "POST", body: JSON.stringify({}) });
        payload = await fetchJson<{ projects: Project[] }>(`${API_BASE}/api/projects`);
      }
      const withPulse = await Promise.all(
        payload.projects.map(async (project) => {
          const pulsePayload = await fetchJson<{ pulse: ProjectPulse }>(`${API_BASE}/api/projects/${project.id}/pulse`);
          return { project, pulse: pulsePayload.pulse };
        })
      );
      setProjects(withPulse);
      if (!selectedProjectId && withPulse.length > 0) {
        setSelectedProjectId(withPulse[0].project.id);
      }
    } finally {
      setLoading(false);
    }
  }

  async function loadProjectDetail(projectId: string): Promise<void> {
    const [questsPayload, tasksPayload, recommendationPayload] = await Promise.all([
      fetchJson<{ quests: Quest[] }>(`${API_BASE}/api/quests?projectId=${projectId}`),
      fetchJson<{ tasks: Task[] }>(`${API_BASE}/api/tasks?projectId=${projectId}`),
      fetchJson<{ summary?: string }>(`${API_BASE}/api/recommendations/next?projectId=${projectId}`),
    ]);

    setQuests(questsPayload.quests);
    setTasks(tasksPayload.tasks);
    setSummary(recommendationPayload.summary ?? "No recommendation available yet.");
  }

  useEffect(() => {
    void loadProjects();
  }, []);

  useEffect(() => {
    if (!selectedProjectId) {
      setQuests([]);
      setTasks([]);
      return;
    }
    void loadProjectDetail(selectedProjectId);
  }, [selectedProjectId]);

  const selectedProject = useMemo(
    () => projects.find((entry) => entry.project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId]
  );

  const visibleProjects = useMemo(() => {
    if (filter === "all") return projects;
    if (filter === "active") return projects.filter((entry) => entry.pulse.tasksDoing > 0 || entry.pulse.tasksTodo > 0);
    if (filter === "stale") return projects.filter((entry) => entry.pulse.stale);
    return projects.filter((entry) => entry.pulse.tasksBlocked > 0);
  }, [filter, projects]);

  const totalXp = useMemo(() => projects.reduce((acc, entry) => acc + entry.pulse.xpEarned, 0), [projects]);
  const level = Math.max(1, Math.floor(totalXp / 200) + 1);

  async function createQuest(): Promise<void> {
    if (!selectedProjectId || !newQuest.trim()) return;
    await fetchJson(`${API_BASE}/api/quests`, {
      method: "POST",
      body: JSON.stringify({
        projectId: selectedProjectId,
        title: newQuest.trim(),
        state: "active",
        priority: 2,
      }),
    });
    setNewQuest("");
    await loadProjectDetail(selectedProjectId);
    await loadProjects();
  }

  async function createTask(): Promise<void> {
    if (!selectedProjectId || !newTask.trim()) return;
    await fetchJson(`${API_BASE}/api/tasks`, {
      method: "POST",
      body: JSON.stringify({
        projectId: selectedProjectId,
        title: newTask.trim(),
        state: "todo",
        estimatePoints: 12,
      }),
    });
    setNewTask("");
    await loadProjectDetail(selectedProjectId);
    await loadProjects();
  }

  async function completeTask(taskId: string): Promise<void> {
    await fetchJson(`${API_BASE}/api/tasks/${taskId}/complete`, { method: "POST" });
    if (selectedProjectId) {
      await loadProjectDetail(selectedProjectId);
      await loadProjects();
    }
  }

  return (
    <main className="atlas-shell">
      <div className="bg-orb bg-orb-a" />
      <div className="bg-orb bg-orb-b" />
      <header className="topbar">
        <div>
          <p className="eyebrow">Project Atlas</p>
          <h1>Personal Project Universe</h1>
        </div>
        <div className="hud">
          <div className="hud-item">
            <span>Level</span>
            <strong>{level}</strong>
          </div>
          <div className="hud-item">
            <span>XP</span>
            <strong>{totalXp}</strong>
          </div>
          <div className="hud-item">
            <span>Projects</span>
            <strong>{projects.length}</strong>
          </div>
        </div>
      </header>

      <section className="brief">
        <p>{summary}</p>
      </section>

      <section className="filters">
        {(["all", "active", "stale", "blocked"] as Filter[]).map((item) => (
          <button
            key={item}
            type="button"
            className={item === filter ? "filter active" : "filter"}
            onClick={() => setFilter(item)}
          >
            {item}
          </button>
        ))}
      </section>

      <div className="layout-grid">
        <section className="project-grid">
          {loading ? <p className="muted">Loading projects...</p> : null}
          <AnimatePresence>
            {visibleProjects.map((entry, index) => {
              const palette = seededPalette(entry.project.visualSeed);
              const progress = entry.pulse.completionPercent;
              const selected = entry.project.id === selectedProjectId;
              return (
                <motion.button
                  key={entry.project.id}
                  type="button"
                  className={selected ? "project-card selected" : "project-card"}
                  style={{
                    backgroundImage: `linear-gradient(135deg, ${palette.from}, ${palette.to})`,
                    boxShadow: selected ? `0 0 0 2px ${palette.accent}, 0 20px 40px rgba(0,0,0,.25)` : undefined,
                  }}
                  onClick={() => setSelectedProjectId(entry.project.id)}
                  initial={{ opacity: 0, y: 22 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -18 }}
                  transition={{ delay: index * 0.025 }}
                  whileHover={{ y: -6, rotateX: 4, rotateY: -2 }}
                >
                  <div className="card-top">
                    <p>{entry.project.name}</p>
                    <span>{entry.pulse.stale ? "Stale" : "Live"}</span>
                  </div>
                  <div className="ring" style={{ background: `conic-gradient(${palette.accent} ${progress}%, rgba(255,255,255,.2) ${progress}%)` }}>
                    <div className="ring-inner">{progress}%</div>
                  </div>
                  <div className="stats">
                    <span>Doing {entry.pulse.tasksDoing}</span>
                    <span>Blocked {entry.pulse.tasksBlocked}</span>
                    <span>Velocity {entry.pulse.velocity7d}</span>
                  </div>
                </motion.button>
              );
            })}
          </AnimatePresence>
        </section>

        <aside className="detail-panel">
          {selectedProject ? (
            <>
              <h2>{selectedProject.project.name}</h2>
              <p className="muted">{selectedProject.pulse.nextAction}</p>

              <div className="creator">
                <input
                  value={newQuest}
                  onChange={(event) => setNewQuest(event.target.value)}
                  placeholder="Create quest..."
                />
                <button type="button" onClick={() => void createQuest()}>
                  Add Quest
                </button>
              </div>

              <div className="creator">
                <input
                  value={newTask}
                  onChange={(event) => setNewTask(event.target.value)}
                  placeholder="Add task..."
                />
                <button type="button" onClick={() => void createTask()}>
                  Add Task
                </button>
              </div>

              <h3>Quest Chain</h3>
              <div className="list">
                {quests.map((quest) => (
                  <div key={quest.id} className="list-item">
                    <div>
                      <strong>{quest.title}</strong>
                      <p>{quest.state}</p>
                    </div>
                    <span>{quest.xpReward} XP</span>
                  </div>
                ))}
                {quests.length === 0 ? <p className="muted">No quests yet.</p> : null}
              </div>

              <h3>Tasks</h3>
              <div className="list">
                {tasks.map((task) => (
                  <div key={task.id} className="list-item">
                    <div>
                      <strong>{task.title}</strong>
                      <p>{task.state}</p>
                    </div>
                    {task.state === "done" ? (
                      <span className="done">Done</span>
                    ) : (
                      <button type="button" onClick={() => void completeTask(task.id)}>
                        Complete
                      </button>
                    )}
                  </div>
                ))}
                {tasks.length === 0 ? <p className="muted">No tasks yet.</p> : null}
              </div>
            </>
          ) : (
            <p className="muted">Pick a project card to inspect quests and tasks.</p>
          )}
        </aside>
      </div>
    </main>
  );
}
