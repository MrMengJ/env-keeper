import { parseVersionedConfig } from "./configFile.js";

/**
 * 项目轨的「方案」:一份存在扩展私有存储里、随时能整份套用进环境文件的内容。
 *
 * 为什么不是项目目录里的 `.env.<名字>` 文件(设计决议 §十一.4):
 * 方案可以随便起名,而项目目录是团队共享的命名空间——团队已有的 `.env.develop`
 * 和用户自己想叫"develop"的方案会抢同一个文件名。放扩展里就没有这个问题。
 *
 * 方案不解释、不代表 `.env` 现在是什么,只是"一份候选内容";
 * `.env` 该是什么,永远只取决于它自己写着什么。
 */
export interface Preset {
  id: string;
  /** 归属项目(项目 id,不是路径——路径会变),方案不跨项目共享 */
  projectId: string;
  name: string;
  /** 这份方案是干嘛的。几个月后光看名字未必想得起来 */
  note?: string;
  /** 自由文本标签,不是独立实体:没人用某个组名,那个组就自然不存在 */
  group?: string;
  /** 原始 .env 文本,保留注释、空行、引号 */
  content: string;
  createdAt: string;
  updatedAt: string;
}

/** 某个环境文件上一次套用的是哪份方案,用来判断之后有没有被手改过(漂移) */
export interface PresetAppliedState {
  presetId: string;
  appliedAt: string;
}

export interface PresetsFile {
  version: 1;
  presets: Preset[];
  /** key 见 appliedStateKey */
  appliedState: Record<string, PresetAppliedState>;
}

export const CURRENT_PRESETS_VERSION = 1;

export function createEmptyPresetsFile(): PresetsFile {
  return { version: 1, presets: [], appliedState: {} };
}

/** 空内容 → 空文件;损坏或版本过新 → 抛 ConfigFileError(同 registry / shell 配置) */
export function parsePresetsFile(jsonStr: string): PresetsFile {
  const parsed = parseVersionedConfig(jsonStr, CURRENT_PRESETS_VERSION);
  if (!parsed) return createEmptyPresetsFile();

  const rawState = parsed.data.appliedState;
  return migratePresetsFile(
    {
      version: CURRENT_PRESETS_VERSION,
      presets: Array.isArray(parsed.data.presets) ? (parsed.data.presets as Preset[]) : [],
      appliedState:
        rawState && typeof rawState === "object" && !Array.isArray(rawState)
          ? (rawState as Record<string, PresetAppliedState>)
          : {},
    },
    parsed.version
  );
}

/** 老版本升级到当前版本。目前只有 v1,留接缝同 migrateRegistry */
export function migratePresetsFile(file: PresetsFile, fromVersion: number): PresetsFile {
  if (fromVersion === CURRENT_PRESETS_VERSION) return file;
  return file;
}

export function formatPresetsFile(file: PresetsFile): string {
  return JSON.stringify(file, null, 2) + "\n";
}

/** appliedState 的 key。文件名而不是完整路径:项目目录搬家后 id 不变,记录也不该失效 */
export function appliedStateKey(projectId: string, envFilename: string): string {
  return `${projectId}:${envFilename}`;
}

/** 分组名统一裁剪,空串等于没分组,避免 "客户" 和 "客户 " 变成两个组 */
function normalizeGroup(group: string | undefined): string | undefined {
  const trimmed = group?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeNote(note: string | undefined): string | undefined {
  const trimmed = note?.trim();
  return trimmed ? trimmed : undefined;
}

export interface NewPresetInput {
  projectId: string;
  name: string;
  content: string;
  note?: string;
  group?: string;
}

export function addPreset(
  file: PresetsFile,
  input: NewPresetInput,
  now: Date = new Date()
): { file: PresetsFile; preset: Preset } {
  const iso = now.toISOString();
  const preset: Preset = {
    id: `ps_${now.getTime()}_${Math.random().toString(36).slice(2, 7)}`,
    projectId: input.projectId,
    name: input.name.trim(),
    note: normalizeNote(input.note),
    group: normalizeGroup(input.group),
    content: input.content,
    createdAt: iso,
    updatedAt: iso,
  };
  return { file: { ...file, presets: [...file.presets, preset] }, preset };
}

export type PresetUpdate = Partial<Pick<Preset, "name" | "note" | "group" | "content">>;

export function updatePreset(file: PresetsFile, id: string, updates: PresetUpdate, now: Date = new Date()): PresetsFile {
  return {
    ...file,
    presets: file.presets.map((p) => {
      if (p.id !== id) return p;
      const next: Preset = { ...p, updatedAt: now.toISOString() };
      if (updates.name !== undefined) next.name = updates.name.trim();
      if (updates.content !== undefined) next.content = updates.content;
      if ("note" in updates) next.note = normalizeNote(updates.note);
      if ("group" in updates) next.group = normalizeGroup(updates.group);
      return next;
    }),
  };
}

/** 删方案时把指向它的套用记录一起清掉,不留悬空引用 */
export function removePreset(file: PresetsFile, id: string): PresetsFile {
  const appliedState: Record<string, PresetAppliedState> = {};
  for (const [key, state] of Object.entries(file.appliedState)) {
    if (state.presetId !== id) appliedState[key] = state;
  }
  return { ...file, presets: file.presets.filter((p) => p.id !== id), appliedState };
}

/** 项目被移除登记时,它的方案和套用记录一并清掉 */
export function removePresetsForProject(file: PresetsFile, projectId: string): PresetsFile {
  const prefix = `${projectId}:`;
  const appliedState: Record<string, PresetAppliedState> = {};
  for (const [key, state] of Object.entries(file.appliedState)) {
    if (!key.startsWith(prefix)) appliedState[key] = state;
  }
  return { ...file, presets: file.presets.filter((p) => p.projectId !== projectId), appliedState };
}

export function listPresetsForProject(file: PresetsFile, projectId: string): Preset[] {
  return file.presets.filter((p) => p.projectId === projectId);
}

/** 本项目已经用过的分组名,去重、按名字排序——填表单时列出来供选 */
export function listPresetGroups(file: PresetsFile, projectId: string): string[] {
  const groups = new Set<string>();
  for (const p of listPresetsForProject(file, projectId)) {
    if (p.group) groups.add(p.group);
  }
  return [...groups].sort((a, b) => a.localeCompare(b));
}

/**
 * 把本项目里某个分组整体改名;`to` 为空等于解散这个组(组内方案全部变成未分组)。
 * 分组只是散落在每份方案上的一个字段,没有独立实体,所以"改组名"只能是把这些方案挨个改掉——
 * 这里一次做完、一次写入,免得用户逐份改漏一份就分裂成两个组。
 * 只动本项目:别的项目里同名的组只是碰巧同名,彼此无关。
 * 新名字撞上本项目已有的组时等于合并,由界面在调用前确认。
 */
export function renamePresetGroup(
  file: PresetsFile,
  projectId: string,
  from: string,
  to: string | undefined,
  now: Date = new Date()
): PresetsFile {
  const target = normalizeGroup(to);
  if (target === from) return file;
  const iso = now.toISOString();
  return {
    ...file,
    presets: file.presets.map((p) =>
      p.projectId === projectId && p.group === from ? { ...p, group: target, updatedAt: iso } : p
    ),
  };
}

export interface PresetGroupBucket {
  /** undefined 表示未分组 */
  group: string | undefined;
  presets: Preset[];
}

/**
 * 按分组分桶:有分组的按组名排序,未分组的固定放最后。
 * 桶内按名字排序,保证同一个列表每次打开顺序一致。
 */
export function groupPresets(presets: Preset[]): PresetGroupBucket[] {
  const byGroup = new Map<string, Preset[]>();
  const ungrouped: Preset[] = [];
  for (const p of presets) {
    if (!p.group) {
      ungrouped.push(p);
      continue;
    }
    const bucket = byGroup.get(p.group);
    if (bucket) bucket.push(p);
    else byGroup.set(p.group, [p]);
  }

  const byName = (a: Preset, b: Preset) => a.name.localeCompare(b.name);
  const buckets: PresetGroupBucket[] = [...byGroup.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([group, items]) => ({ group, presets: items.sort(byName) }));
  if (ungrouped.length > 0) buckets.push({ group: undefined, presets: ungrouped.sort(byName) });
  return buckets;
}

export function recordPresetApplied(
  file: PresetsFile,
  projectId: string,
  envFilename: string,
  presetId: string,
  now: Date = new Date()
): PresetsFile {
  return {
    ...file,
    appliedState: {
      ...file.appliedState,
      [appliedStateKey(projectId, envFilename)]: { presetId, appliedAt: now.toISOString() },
    },
  };
}

export function clearPresetApplied(file: PresetsFile, projectId: string, envFilename: string): PresetsFile {
  const key = appliedStateKey(projectId, envFilename);
  if (!(key in file.appliedState)) return file;
  const appliedState = { ...file.appliedState };
  delete appliedState[key];
  return { ...file, appliedState };
}

/** 这个文件上一次套用的方案;记录指向的方案已被删除时返回 undefined */
export function getAppliedPreset(file: PresetsFile, projectId: string, envFilename: string): Preset | undefined {
  const state = file.appliedState[appliedStateKey(projectId, envFilename)];
  if (!state) return undefined;
  return file.presets.find((p) => p.id === state.presetId);
}

/**
 * 内容跟当前文件一模一样的那份方案,界面上打「当前生效」用。
 * 只比对文本,不比对时间——用户在意的是"现在跑的是哪一套值",不是"最后一次点了哪个"。
 */
export function findMatchingPreset(presets: Preset[], content: string): Preset | undefined {
  return presets.find((p) => p.content === content);
}

/**
 * 漂移:上次套用了某份方案,但现在文件内容跟那份方案的**当前**内容不一样了。
 * 不区分是文件改了还是方案改了——用户在意的只是"两边对不上了"。
 */
export function detectPresetDrift(
  file: PresetsFile,
  projectId: string,
  envFilename: string,
  currentContent: string
): Preset | undefined {
  const applied = getAppliedPreset(file, projectId, envFilename);
  if (!applied) return undefined;
  return applied.content === currentContent ? undefined : applied;
}

/**
 * 把历史记录里的某一份方案恢复回来:还在就整份覆盖,已经删了就按原 id 加回去。
 * 只动这一份——方案之间没有依赖(每份都是独立完整的 .env 内容),
 * 不像 Shell 片段那样有"单独回滚会凑出不存在的组合"的问题
 */
export function restorePreset(file: PresetsFile, snapshot: Preset, now: Date = new Date()): PresetsFile {
  const restored: Preset = { ...snapshot, updatedAt: now.toISOString() };
  const exists = file.presets.some((p) => p.id === snapshot.id);
  return {
    ...file,
    presets: exists ? file.presets.map((p) => (p.id === snapshot.id ? restored : p)) : [...file.presets, restored],
  };
}

/**
 * 把某个项目的方案整体换回历史里的那一版,其他项目的方案和套用记录原样不动。
 * presets.json 是全局一份、只有一条历史线,但用户永远是从某个项目进来看历史的,
 * 恢复的范围也该跟着收敛到这个项目
 */
export function restoreProjectPresets(file: PresetsFile, snapshot: PresetsFile, projectId: string): PresetsFile {
  const prefix = `${projectId}:`;
  const appliedState: Record<string, PresetAppliedState> = {};
  for (const [key, state] of Object.entries(file.appliedState)) {
    if (!key.startsWith(prefix)) appliedState[key] = state;
  }
  for (const [key, state] of Object.entries(snapshot.appliedState)) {
    if (key.startsWith(prefix)) appliedState[key] = state;
  }
  return {
    ...file,
    presets: [
      ...file.presets.filter((p) => p.projectId !== projectId),
      ...snapshot.presets.filter((p) => p.projectId === projectId),
    ],
    appliedState,
  };
}
