import { isSecretKey, MASKED_VALUE } from "./envOps.js";
import { parseVersionedConfig } from "./configFile.js";

export type ShellSnippetType = "export" | "alias" | "snippet";

export interface ShellSnippet {
  id: string;
  name: string;
  type: ShellSnippetType;
  content: string;
  enabled: boolean;
  description?: string;
  /**
   * 用户手动标记"这段里有敏感信息"。片段内容是自由文本,
   * 按关键词自动识别总有漏网的写法(比如密钥拼在一长串命令里),
   * 勾了就整段打码,作为自动识别之外的兜底。
   */
  containsSecret?: boolean;
}

export interface ShellConfig {
  version: 1;
  snippets: ShellSnippet[];
}

export function createEmptyShellConfig(): ShellConfig {
  return {
    version: 1,
    snippets: [],
  };
}

/** 当前扩展写出的 Shell 配置版本。改结构时 +1,并在 migrateShellConfig 里补一段迁移 */
export const CURRENT_SHELL_CONFIG_VERSION = 1;

/**
 * 解析 Shell 配置。空内容 → 空配置;损坏或版本过新 → 抛 ConfigFileError。
 * 这里静默返回空的危害比注册表更大:保存时会连带重新生成 shell.sh,
 * 等于把用户的全局环境变量和 alias 一起清空。
 */
export function parseShellConfig(jsonStr: string): ShellConfig {
  const parsed = parseVersionedConfig(jsonStr, CURRENT_SHELL_CONFIG_VERSION);
  if (!parsed) return createEmptyShellConfig();

  return migrateShellConfig(
    {
      version: CURRENT_SHELL_CONFIG_VERSION,
      snippets: Array.isArray(parsed.data.snippets) ? (parsed.data.snippets as ShellSnippet[]) : [],
    },
    parsed.version
  );
}

/** 老版本数据升级到当前版本。目前只有 v1,留接缝同 migrateRegistry */
export function migrateShellConfig(config: ShellConfig, fromVersion: number): ShellConfig {
  if (fromVersion === CURRENT_SHELL_CONFIG_VERSION) return config;
  return config;
}

export function formatShellConfig(config: ShellConfig): string {
  return JSON.stringify(config, null, 2) + "\n";
}

export function addShellSnippet(
  config: ShellConfig,
  snippet: Omit<ShellSnippet, "id">
): { config: ShellConfig; snippet: ShellSnippet } {
  const id = `sh_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const newSnippet: ShellSnippet = {
    ...snippet,
    id,
  };
  return {
    config: {
      ...config,
      snippets: [...config.snippets, newSnippet],
    },
    snippet: newSnippet,
  };
}

export function updateShellSnippet(
  config: ShellConfig,
  id: string,
  updates: Partial<Omit<ShellSnippet, "id">>
): ShellConfig {
  return {
    ...config,
    snippets: config.snippets.map((s) => (s.id === id ? { ...s, ...updates } : s)),
  };
}

export function removeShellSnippet(config: ShellConfig, id: string): ShellConfig {
  return {
    ...config,
    snippets: config.snippets.filter((s) => s.id !== id),
  };
}

export function toggleShellSnippet(config: ShellConfig, id: string): ShellConfig {
  return {
    ...config,
    snippets: config.snippets.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s)),
  };
}

/**
 * 粗略判断片段内容是否符合它声明的类型:export 类型建议以 export 开头,
 * alias 类型建议以 alias 开头(跳过内容开头的空行/注释行再判断,允许有变体写法如 `alias -g`)。
 * snippet(自定义脚本)类型不做任何限制,内容为空或只有注释时也不判定。
 *
 * 注意:这只是给用户一个温和提示用的启发式判断,不是强校验——
 * 类型字段本身只影响 UI 分组与生成文件时的注释头,不限制实际可写的内容。
 */
export function matchesDeclaredType(type: ShellSnippetType, content: string): boolean {
  if (type === "snippet") return true;

  const firstMeaningfulLine = content
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l !== "" && !l.startsWith("#"));

  if (!firstMeaningfulLine) return true;

  if (type === "export") return /^export\b/i.test(firstMeaningfulLine);
  if (type === "alias") return /^alias\b/i.test(firstMeaningfulLine);
  return true;
}

/**
 * 将启用的片段编译为 ~/.env-butler/shell.sh
 */
/**
 * 把片段在生成顺序里上移/下移一位。
 *
 * 顺序不是审美问题:generateShellScript 按数组顺序平铺输出,shell 从上往下执行,
 * 所以后面的片段能用到前面片段定义的东西,反过来不行。典型例子:
 *   export JAVA_HOME=/opt/jdk17
 *   export PATH="$JAVA_HOME/bin:$PATH"   ← 必须排在上面那条之后,否则 $JAVA_HOME 展开为空
 * 而且这种错不会报错,只会让命令莫名其妙找不到,所以要给用户调顺序的手段。
 *
 * 已经在最前/最后时原样返回配置,由调用方决定要不要提示。
 */
export function moveShellSnippet(config: ShellConfig, id: string, direction: "up" | "down"): ShellConfig {
  const index = config.snippets.findIndex((s) => s.id === id);
  if (index < 0) return config;

  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= config.snippets.length) return config;

  const snippets = [...config.snippets];
  const moved = snippets[index];
  const displaced = snippets[targetIndex];
  if (!moved || !displaced) return config;

  snippets[index] = displaced;
  snippets[targetIndex] = moved;
  return { ...config, snippets };
}

export type ShellSnippetDiffType = "added" | "removed" | "changed" | "unchanged";

export interface ShellSnippetDiffEntry {
  type: ShellSnippetDiffType;
  /** 片段 id;按 id 比对而不是按名字,这样"只改了名字"能识别成 changed 而不是一删一增 */
  id: string;
  /** 展示用的名字:removed 用旧名,其余用新名 */
  name: string;
  /** 名字被改过时,这里是旧名 */
  previousName?: string;
  before?: ShellSnippet;
  after?: ShellSnippet;
}

/** 两个片段在用户看得见的层面是否等价 */
function sameSnippet(a: ShellSnippet, b: ShellSnippet): boolean {
  return (
    a.name === b.name &&
    a.type === b.type &&
    a.content === b.content &&
    a.enabled === b.enabled &&
    (a.description ?? "") === (b.description ?? "")
  );
}

/**
 * 比较两份 Shell 片段列表(如"某历史快照"与"当前配置")。
 * base = 旧版本,target = 新版本;返回按 added/removed/changed/unchanged 排序,同类型内按名字排序。
 */
export function diffShellSnippets(base: ShellSnippet[], target: ShellSnippet[]): ShellSnippetDiffEntry[] {
  const baseMap = new Map(base.map((s) => [s.id, s]));
  const targetMap = new Map(target.map((s) => [s.id, s]));
  const ids = new Set<string>([...baseMap.keys(), ...targetMap.keys()]);
  const result: ShellSnippetDiffEntry[] = [];

  for (const id of ids) {
    const before = baseMap.get(id);
    const after = targetMap.get(id);

    if (before && !after) {
      result.push({ type: "removed", id, name: before.name, before });
    } else if (!before && after) {
      result.push({ type: "added", id, name: after.name, after });
    } else if (before && after) {
      const changed = !sameSnippet(before, after);
      result.push({
        type: changed ? "changed" : "unchanged",
        id,
        name: after.name,
        previousName: before.name !== after.name ? before.name : undefined,
        before,
        after,
      });
    }
  }

  const order: Record<ShellSnippetDiffType, number> = { added: 0, removed: 1, changed: 2, unchanged: 3 };
  return result.sort((a, b) => order[a.type] - order[b.type] || a.name.localeCompare(b.name));
}

/** 一行里"KEY=值"形态的赋值,可选带 export 前缀 */
const SHELL_ASSIGNMENT_RE = /^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_]*)(\s*=\s*)(.*)$/;

export interface ShellAssignment {
  key: string;
  /** 已去掉包裹引号的值 */
  value: string;
}

/**
 * 从片段内容里抽出 `KEY=值` / `export KEY=值` 形态的赋值。
 * 给全局搜索用:Shell 轨里存的同样是环境变量,用户搜 JAVA_HOME 却搜不到会当成 bug。
 * 认不出的行直接跳过——这里宁可少给结果,也不要把命令行参数误当成变量。
 */
export function extractShellAssignments(content: string): ShellAssignment[] {
  const result: ShellAssignment[] = [];
  for (const line of content.split("\n")) {
    // 被注释掉的行不算:它在 shell 里本来就不生效
    if (line.trim().startsWith("#")) continue;
    const match = SHELL_ASSIGNMENT_RE.exec(line);
    if (!match) continue;
    const key = match[2];
    let value = match[4] ?? "";
    const first = value[0];
    if ((first === '"' || first === "'") && value.endsWith(first) && value.length >= 2) {
      value = value.slice(1, -1);
    }
    if (key) result.push({ key, value });
  }
  return result;
}

/**
 * 把片段内容里的敏感值打码,用于界面展示。
 *
 * 片段是自由文本的多行 shell,没有 .env 那样的结构,所以只能逐行找
 * `KEY=值` / `export KEY=值` 这种形态,拿 KEY 交给 isSecretKey 判断。
 * 认不出的行原样保留——宁可漏打码也不要把用户看不懂的东西显示出来。
 *
 * 注意这只影响"显示":生成的 shell.sh 里必须是明文,否则 shell 读不到。
 * 它防的是别人瞄到你屏幕,不是防文件被读走。
 */
export function maskShellContent(
  content: string,
  options: { customSecrets?: string[]; maskAll?: boolean } = {}
): string {
  const { customSecrets, maskAll = false } = options;

  return content
    .split("\n")
    .map((line) => {
      const match = SHELL_ASSIGNMENT_RE.exec(line);
      if (!match) {
        // 整段标记为敏感时,连认不出的行也一并遮住
        return maskAll && line.trim() !== "" && !line.trim().startsWith("#") ? MASKED_VALUE : line;
      }
      const [, prefix, key, eq, value] = match;
      if (value === undefined || value === "") return line;
      if (!maskAll && !isSecretKey(key ?? "", customSecrets)) return line;
      return `${prefix}${key}${eq}${MASKED_VALUE}`;
    })
    .join("\n");
}

export function generateShellScript(snippets: ShellSnippet[]): string {
  const activeSnippets = snippets.filter((s) => s.enabled && s.content.trim() !== "");

  const lines: string[] = [
    "#!/usr/bin/env bash",
    "# ============================================================================",
    "# Generated by Env Butler. DO NOT EDIT THIS FILE DIRECTLY.",
    "# To use this file, add the following line to your ~/.zshrc or ~/.bashrc:",
    "#   source ~/.env-butler/shell.sh",
    "# ============================================================================",
    "",
  ];

  for (const item of activeSnippets) {
    const desc = item.description ? ` - ${item.description}` : "";
    lines.push(`# [${item.type.toUpperCase()}] ${item.name}${desc}`);
    lines.push(item.content.trim());
    lines.push("");
  }

  return lines.join("\n");
}
