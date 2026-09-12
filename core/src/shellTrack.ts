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
  /**
   * 自由文本分组,同项目轨方案的 group:不是独立实体,没人用某个组名它就自然不存在。
   * 只管列表怎么分区,不影响 shell.sh 的生成顺序
   */
  group?: string;
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
  // 版本号不动的整理:大小写不同的组名合并(2026-09-11 起组名不区分大小写)
  const unified = unifyGroupCase(config);
  if (fromVersion === CURRENT_SHELL_CONFIG_VERSION) return unified;
  return unified;
}

export function formatShellConfig(config: ShellConfig): string {
  return JSON.stringify(config, null, 2) + "\n";
}

/** 分组名统一裁剪,空串等于没分组,避免 "Java" 和 "Java " 变成两个组 */
function normalizeGroup(group: string | undefined): string | undefined {
  const trimmed = group?.trim();
  return trimmed ? trimmed : undefined;
}

/** 大小写不同视为同一个组,已有的拼法优先(同方案的 canonicalGroup) */
function canonicalShellGroup(config: ShellConfig, group: string | undefined): string | undefined {
  const normalized = normalizeGroup(group);
  if (!normalized) return undefined;
  const lower = normalized.toLowerCase();
  return config.snippets.find((s) => s.group?.toLowerCase() === lower)?.group ?? normalized;
}

/** 老数据里大小写不同的组名合并成先出现的那个拼法 */
function unifyGroupCase(config: ShellConfig): ShellConfig {
  const seen = new Map<string, string>();
  let changed = false;
  const snippets = config.snippets.map((s) => {
    if (!s.group) return s;
    const canonical = seen.get(s.group.toLowerCase());
    if (canonical === undefined) {
      seen.set(s.group.toLowerCase(), s.group);
      return s;
    }
    if (canonical === s.group) return s;
    changed = true;
    return { ...s, group: canonical };
  });
  return changed ? { ...config, snippets } : config;
}

export function addShellSnippet(
  config: ShellConfig,
  snippet: Omit<ShellSnippet, "id">
): { config: ShellConfig; snippet: ShellSnippet } {
  const id = `sh_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const newSnippet: ShellSnippet = {
    ...snippet,
    group: canonicalShellGroup(config, snippet.group),
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
    snippets: config.snippets.map((s) => {
      if (s.id !== id) return s;
      const next = { ...s, ...updates };
      if ("group" in updates) next.group = canonicalShellGroup(config, updates.group);
      return next;
    }),
  };
}

/** 已经用过的分组名,去重、按名字排序——填表单时列出来供选 */
export function listShellGroups(config: ShellConfig): string[] {
  const groups = new Set<string>();
  for (const s of config.snippets) {
    if (s.group) groups.add(s.group);
  }
  return [...groups].sort((a, b) => a.localeCompare(b));
}

export interface ShellGroupBucket {
  /** undefined 表示未分组 */
  group: string | undefined;
  snippets: ShellSnippet[];
}

/**
 * 按分组分桶。组的先后 = 组内第一条片段在生成顺序里的位置,未分组固定最后;
 * 桶内保持生成顺序。这样列表里的 #n 大致递增,也不用为"组的顺序"另外存任何东西。
 * (方案那边组按字母排,因为方案没有顺序这个概念)
 */
export function groupShellSnippets(snippets: ShellSnippet[]): ShellGroupBucket[] {
  const byGroup = new Map<string, ShellSnippet[]>();
  const ungrouped: ShellSnippet[] = [];
  for (const s of snippets) {
    if (!s.group) {
      ungrouped.push(s);
      continue;
    }
    const bucket = byGroup.get(s.group);
    if (bucket) bucket.push(s);
    else byGroup.set(s.group, [s]);
  }
  // Map 保持插入顺序 = 第一条片段出现的顺序
  const buckets: ShellGroupBucket[] = [...byGroup.entries()].map(([group, items]) => ({ group, snippets: items }));
  if (ungrouped.length > 0) buckets.push({ group: undefined, snippets: ungrouped });
  return buckets;
}

/**
 * 整组改名;`to` 为空等于解散(组内片段全部变成未分组)。
 * 分组只是散落在每条片段上的字段,逐条改容易漏,漏一条就分裂成两个组——这里一次改完。
 * 新名字撞上已有的组等于合并,由界面在调用前确认
 */
export function renameShellGroup(config: ShellConfig, from: string, to: string | undefined): ShellConfig {
  const target = canonicalShellGroup(config, to);
  if (target === from) return config;
  return {
    ...config,
    snippets: config.snippets.map((s) => (s.group === from ? { ...s, group: target } : s)),
  };
}

/** 整组启用 / 禁用。"场景"的轻量版:不新增实体、不保存状态 */
export function setShellGroupEnabled(config: ShellConfig, group: string, enabled: boolean): ShellConfig {
  return {
    ...config,
    snippets: config.snippets.map((s) => (s.group === group && s.enabled !== enabled ? { ...s, enabled } : s)),
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
  const targetIndex = adjacentInGroupIndex(config.snippets, id, direction);
  const index = config.snippets.findIndex((s) => s.id === id);
  if (index < 0 || targetIndex < 0) return config;

  const snippets = [...config.snippets];
  const moved = snippets[index];
  const displaced = snippets[targetIndex];
  if (!moved || !displaced) return config;

  snippets[index] = displaced;
  snippets[targetIndex] = moved;
  return { ...config, snippets };
}

/**
 * 同一组里、生成顺序上的前一条 / 后一条的下标;没有返回 -1。
 * 列表是按分组分区显示的,移动只跟同组的邻居换位:此前跟数组里的邻居换,邻居可能在别的组,
 * 片段会从眼前的分区消失、跑到另一个分区去。未分组的片段在未分组的范围内换
 */
export function adjacentInGroupIndex(snippets: ShellSnippet[], id: string, direction: "up" | "down"): number {
  const index = snippets.findIndex((s) => s.id === id);
  if (index < 0) return -1;
  const group = snippets[index]?.group ?? undefined;
  const step = direction === "up" ? -1 : 1;
  for (let i = index + step; i >= 0 && i < snippets.length; i += step) {
    if ((snippets[i]?.group ?? undefined) === group) return i;
  }
  return -1;
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

/**
 * 两个片段在用户看得见的层面是否等价(都不存在也算一样)。
 * 导出给界面的历史页共用:此前界面自己抄了一份,加 group 字段时漏改,只改分组的版本在历史里就消失了
 */
export function sameShellSnippet(a: ShellSnippet | undefined, b: ShellSnippet | undefined): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return (
    a.name === b.name &&
    a.type === b.type &&
    a.content === b.content &&
    a.enabled === b.enabled &&
    (a.description ?? "") === (b.description ?? "") &&
    (a.group ?? "") === (b.group ?? "") &&
    (a.containsSecret ?? false) === (b.containsSecret ?? false)
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
      const changed = !sameShellSnippet(before, after);
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

/** 一个 `KEY=值` 词:值可以是引号包住的一段,也可以是不含空白的一串 */
const ASSIGNMENT_TOKEN_RE = /^([A-Za-z_][A-Za-z0-9_]*)=("(?:[^"\\]|\\.)*"|'[^']*'|[^\s"']*)/;

export interface ShellAssignment {
  key: string;
  /** 已去掉包裹引号的值 */
  value: string;
}

interface ShellAssignmentToken extends ShellAssignment {
  /** 值在这一行里的起止位置(含引号),打码时替换用 */
  valueStart: number;
  valueEnd: number;
}

/**
 * 认出一行里的全局赋值(可多个:`export A=1 B=2`)。规则按 shell 的实际语义:
 * - `export A=1 B=2` / `A=1 B=2`(整行都是赋值)→ 全部算
 * - `A=1 mycmd`(赋值后面跟着命令)→ 那是给这一条命令的临时变量,不算
 * - 认不出的行返回 null
 */
function parseAssignmentLine(line: string): ShellAssignmentToken[] | null {
  let pos = 0;
  const skipSpaces = () => {
    while (pos < line.length && /\s/.test(line[pos]!)) pos++;
  };
  skipSpaces();
  const exportMatch = /^export\s+/.exec(line.slice(pos));
  const exported = exportMatch !== null;
  if (exportMatch) pos += exportMatch[0].length;

  const tokens: ShellAssignmentToken[] = [];
  while (pos < line.length) {
    skipSpaces();
    if (pos >= line.length) break;
    if (line[pos] === "#") break; // 行尾注释
    const m = ASSIGNMENT_TOKEN_RE.exec(line.slice(pos));
    if (!m) return exported ? tokens : null; // 非赋值的词:不带 export 时整行是"临时变量 + 命令",不算
    const rawValue = m[2] ?? "";
    let value = rawValue;
    const first = value[0];
    if ((first === '"' || first === "'") && value.endsWith(first) && value.length >= 2) value = value.slice(1, -1);
    const keyLen = (m[1] ?? "").length + 1;
    tokens.push({
      key: m[1]!,
      value,
      valueStart: pos + keyLen,
      valueEnd: pos + keyLen + rawValue.length,
    });
    pos += m[0].length;
  }
  return tokens.length > 0 ? tokens : null;
}

/** 函数定义的起始行:`name() {`、`function name {`、`function name() {` */
const FUNCTION_START_RE = /^\s*(?:function\s+[\w-]+\s*(?:\(\s*\))?|[\w-]+\s*\(\s*\))\s*\{/;

/**
 * 逐行遍历,跳过函数体:函数里的赋值是局部的(或只在调用时发生),不算"设了全局变量"。
 * 靠数花括号找函数结尾——够用,不做完整的 shell 解析
 */
function forEachTopLevelLine(content: string, visit: (line: string) => void): void {
  let depth = 0;
  for (const line of content.split("\n")) {
    if (depth === 0 && FUNCTION_START_RE.test(line)) {
      depth = 1;
      depth += (line.match(/\{/g)?.length ?? 1) - 1 - (line.match(/\}/g)?.length ?? 0);
      if (depth <= 0) depth = 0;
      continue;
    }
    if (depth > 0) {
      depth += (line.match(/\{/g)?.length ?? 0) - (line.match(/\}/g)?.length ?? 0);
      if (depth < 0) depth = 0;
      continue;
    }
    visit(line);
  }
}

/**
 * 从片段内容里抽出全局的 `KEY=值` / `export KEY=值` 赋值(一行多个也认,函数体内的不算)。
 * 给全局搜索和重复设置检查用:宁可少给结果,也不要把命令行参数误当成变量
 */
export function extractShellAssignments(content: string): ShellAssignment[] {
  const result: ShellAssignment[] = [];
  forEachTopLevelLine(content, (line) => {
    // 被注释掉的行不算:它在 shell 里本来就不生效
    if (line.trim().startsWith("#")) return;
    for (const { key, value } of parseAssignmentLine(line) ?? []) result.push({ key, value });
  });
  return result;
}

/** `alias name=`,允许中间带 `-g` 这类选项 */
const SHELL_ALIAS_RE = /^\s*alias\s+(?:-\w+\s+)*([^\s=-][^\s=]*)=/;

export interface ShellConflict {
  kind: "variable" | "alias";
  /** 变量名或 alias 名 */
  name: string;
  /** 卷入的片段,按生成顺序;全部是已启用的 */
  snippets: { id: string; name: string }[];
  /** 生成顺序最靠后的那份,shell 里最终以它为准 */
  effectiveId: string;
}

/**
 * 找出"两个已启用的片段设置了同一个变量 / 同名 alias"。
 * 这是"一个片段一个开关"这条路欠的:互斥的两个值是两个片段,没人拦着把它们同时打开,
 * 而 shell 里静默地以后者为准,用户很难察觉。这里只提示,不阻断。
 *
 * `PATH="$PATH:/x"` 这种引用自己的追加写法不算冲突——两个片段都往 PATH 里加东西是累积,不是互斥。
 * 同一片段内重复赋值同一个 key 也不算:那是片段自己的事。
 */
export function findShellConflicts(snippets: ShellSnippet[]): ShellConflict[] {
  const active = snippets.filter((s) => s.enabled && s.content.trim() !== "");
  const owners = new Map<string, { kind: ShellConflict["kind"]; name: string; ids: Map<string, string> }>();

  const claim = (kind: ShellConflict["kind"], name: string, snippet: ShellSnippet) => {
    const mapKey = `${kind}:${name}`;
    const entry = owners.get(mapKey) ?? { kind, name, ids: new Map<string, string>() };
    entry.ids.set(snippet.id, snippet.name);
    owners.set(mapKey, entry);
  };

  for (const snippet of active) {
    for (const { key, value } of extractShellAssignments(snippet.content)) {
      if (value.includes(`$${key}`) || value.includes(`\${${key}`)) continue;
      claim("variable", key, snippet);
    }
    forEachTopLevelLine(snippet.content, (line) => {
      const match = SHELL_ALIAS_RE.exec(line);
      if (match?.[1]) claim("alias", match[1], snippet);
    });
  }

  const conflicts: ShellConflict[] = [];
  for (const { kind, name, ids } of owners.values()) {
    if (ids.size < 2) continue;
    const involved = [...ids.entries()].map(([id, snippetName]) => ({ id, name: snippetName }));
    conflicts.push({ kind, name, snippets: involved, effectiveId: involved[involved.length - 1]!.id });
  }
  return conflicts;
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
      const trimmed = line.trim();
      // 注释掉的赋值也要打码:被注释掉的 API_KEY 仍然是密钥
      const commented = trimmed.startsWith("#");
      const body = commented ? line.replace(/^(\s*#\s?)/, "") : line;
      const prefix = commented ? line.slice(0, line.length - body.length) : "";
      const tokens = parseAssignmentLine(body);
      if (!tokens) {
        // 整段标记为敏感时,连认不出的行也一并遮住(注释行除外,那是说明文字)
        return maskAll && trimmed !== "" && !commented ? MASKED_VALUE : line;
      }
      // 从后往前替换,前面的位置才不会漂
      let out = body;
      for (const tk of [...tokens].reverse()) {
        if (tk.value === "") continue;
        if (!maskAll && !isSecretKey(tk.key, customSecrets, tk.value)) continue;
        out = `${out.slice(0, tk.valueStart)}${MASKED_VALUE}${out.slice(tk.valueEnd)}`;
      }
      return prefix + out;
    })
    .join("\n");
}

export function generateShellScript(snippets: ShellSnippet[]): string {
  const activeSnippets = snippets.filter((s) => s.enabled && s.content.trim() !== "");

  const lines: string[] = [
    "#!/usr/bin/env bash",
    "# ============================================================================",
    "# Generated by Env Keeper. DO NOT EDIT THIS FILE DIRECTLY.",
    "# To use this file, add the following line to your ~/.zshrc or ~/.bashrc:",
    "#   source ~/.env-butler/shell.sh",
    "# ============================================================================",
    "",
  ];

  for (const item of activeSnippets) {
    const group = item.group ? ` (${item.group})` : "";
    const desc = item.description ? ` - ${item.description}` : "";
    lines.push(`# [${item.type.toUpperCase()}] ${item.name}${group}${desc}`);
    lines.push(item.content.trim());
    lines.push("");
  }

  return lines.join("\n");
}
