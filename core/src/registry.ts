export interface ProjectMeta {
  id: string;
  name: string;
  path: string;
  lastOpenedAt: number;
  customSecrets?: string[];
  /** 用户主动关闭了该项目的 .envrc(direnv) 提示,不再需要每次都显示 */
  dismissedEnvrcNotice?: boolean;
}

export interface RegistryData {
  version: 1;
  projects: ProjectMeta[];
}

export function createEmptyRegistry(): RegistryData {
  return {
    version: 1,
    projects: [],
  };
}

export function parseRegistry(jsonStr: string): RegistryData {
  if (!jsonStr || jsonStr.trim() === "") {
    return createEmptyRegistry();
  }
  try {
    const data = JSON.parse(jsonStr);
    if (!data || typeof data !== "object") return createEmptyRegistry();
    return {
      version: 1,
      projects: Array.isArray(data.projects) ? data.projects : [],
    };
  } catch {
    return createEmptyRegistry();
  }
}

export function formatRegistry(registry: RegistryData): string {
  return JSON.stringify(registry, null, 2) + "\n";
}

export function generateProjectId(projectPath: string): string {
  return Buffer.from(projectPath.trim()).toString("base64url");
}

export function addProject(
  registry: RegistryData,
  item: { name: string; path: string },
  now = Date.now()
): { registry: RegistryData; project: ProjectMeta } {
  const normPath = item.path.trim();
  const id = generateProjectId(normPath);
  const existing = registry.projects.find((p) => p.path === normPath || p.id === id);

  if (existing) {
    const updated: ProjectMeta = {
      ...existing,
      name: item.name.trim() || existing.name,
      lastOpenedAt: now,
    };
    return {
      registry: {
        ...registry,
        projects: registry.projects.map((p) => (p.id === existing.id ? updated : p)),
      },
      project: updated,
    };
  }

  const newProject: ProjectMeta = {
    id,
    name: item.name.trim() || normPath.split("/").filter(Boolean).pop() || "Untitled",
    path: normPath,
    lastOpenedAt: now,
    customSecrets: [],
  };

  return {
    registry: {
      ...registry,
      projects: [newProject, ...registry.projects],
    },
    project: newProject,
  };
}

export function removeProject(registry: RegistryData, projectId: string): RegistryData {
  return {
    ...registry,
    projects: registry.projects.filter((p) => p.id !== projectId),
  };
}

export function touchProject(registry: RegistryData, projectId: string, now = Date.now()): RegistryData {
  return {
    ...registry,
    projects: registry.projects.map((p) => (p.id === projectId ? { ...p, lastOpenedAt: now } : p)),
  };
}

export function toggleProjectSecret(
  registry: RegistryData,
  projectId: string,
  key: string
): RegistryData {
  return {
    ...registry,
    projects: registry.projects.map((p) => {
      if (p.id !== projectId) return p;
      const secrets = p.customSecrets ?? [];
      const lower = key.toLowerCase();
      const exists = secrets.some((s) => s.toLowerCase() === lower);
      const nextSecrets = exists
        ? secrets.filter((s) => s.toLowerCase() !== lower)
        : [...secrets, key];
      return {
        ...p,
        customSecrets: nextSecrets,
      };
    }),
  };
}

export function setEnvrcNoticeDismissed(
  registry: RegistryData,
  projectId: string,
  dismissed: boolean
): RegistryData {
  return {
    ...registry,
    projects: registry.projects.map((p) => (p.id === projectId ? { ...p, dismissedEnvrcNotice: dismissed } : p)),
  };
}

export function sortProjectsByRecent(registry: RegistryData): ProjectMeta[] {
  return [...registry.projects].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
}
