import { parseVersionedConfig } from "./configFile.js";

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

/** 当前扩展写出的注册表版本。改结构时 +1,并在 migrateRegistry 里补一段迁移 */
export const CURRENT_REGISTRY_VERSION = 1;

/**
 * 解析注册表。空内容 → 空注册表(全新安装);损坏或版本过新 → 抛 ConfigFileError,
 * 由调用方隔离原文件并告知用户,绝不静默当成"空"(否则下一次保存就把原数据覆盖没了)。
 */
export function parseRegistry(jsonStr: string): RegistryData {
  const parsed = parseVersionedConfig(jsonStr, CURRENT_REGISTRY_VERSION);
  if (!parsed) return createEmptyRegistry();

  return migrateRegistry(
    {
      version: CURRENT_REGISTRY_VERSION,
      projects: Array.isArray(parsed.data.projects) ? (parsed.data.projects as ProjectMeta[]) : [],
    },
    parsed.version
  );
}

/**
 * 老版本数据升级到当前版本。目前只有 v1,没有实际迁移,
 * 留着这个接缝是为了以后加字段时有地方落,而不是等到那时候再回来补版本判断。
 */
export function migrateRegistry(registry: RegistryData, fromVersion: number): RegistryData {
  if (fromVersion === CURRENT_REGISTRY_VERSION) return registry;
  // 未来的迁移按 fromVersion 逐级往上补
  return registry;
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
