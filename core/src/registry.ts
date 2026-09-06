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

/**
 * 项目 id。**刻意与路径无关**。
 *
 * 早期是路径的 base64,后果是项目目录一改名/搬家,id 就跟着变,
 * 而 customSecrets、dismissedEnvrcNotice 这些设置都是绑在 id 上的——
 * 等于用户挪一下文件夹,标过的敏感字段和关掉的提示全部失效。
 * 改成与路径无关之后,path 只是一个普通字段,改路径不丢任何设置。
 *
 * 老项目的 base64 id 原样保留继续用:id 是不透明的,不需要迁移。
 */
export function generateProjectId(): string {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 改掉某个项目的目录路径(目录被搬走/改名后重新指过去)。
 * id 不变,所以敏感标记等设置全部跟着保留。
 */
export function relocateProject(registry: RegistryData, id: string, newPath: string): RegistryData {
  const normPath = newPath.trim();
  return {
    ...registry,
    projects: registry.projects.map((p) => (p.id === id ? { ...p, path: normPath } : p)),
  };
}

export function addProject(
  registry: RegistryData,
  item: { name: string; path: string },
  now = Date.now()
): { registry: RegistryData; project: ProjectMeta } {
  const normPath = item.path.trim();
  // 重复判定只看路径:id 已经和路径无关了
  const existing = registry.projects.find((p) => p.path === normPath);

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
    id: generateProjectId(),
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
