import { createHash } from "node:crypto";
import type { EnvLine, EnvQuote } from "./parseEnv.js";

const DEFAULT_SECRET_PATTERN = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH|DSN|PRIVATE|JWT|SALT|SIGNATURE|CERT)/i;

/** 值本身长得像带账号密码的连接串:`postgres://user:pass@host/db`。`DATABASE_URL` 这类名字不带敏感词,只能看值 */
const CREDENTIAL_URL_RE = /:\/\/[^/\s:@]+:[^/\s@]+@/;

/**
 * HTTP 头里那种"方案 + 凭证"的写法:`Bearer eyJhbGci…` / `Basic dXNlcjpwYXNz`。
 * 要求凭证是一整串不含空白、至少 8 位的 token——光凭 `Basic` 这个词本身不算数,
 * 否则 `PLAN=Basic plan` 这类普通值也会被打码
 */
const AUTH_SCHEME_RE = /^(Bearer|Basic|Digest)\s+[A-Za-z0-9._~+/=-]{8,}$/;

/** 值里带账号密码或认证头(URL 凭据 / Bearer)。名字判不出来时的补充,不看名字 */
export function isSecretValue(value: string | undefined): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return CREDENTIAL_URL_RE.test(trimmed) || AUTH_SCHEME_RE.test(trimmed);
}

export interface EnvVariableOptions {
  quote?: EnvQuote | null;
  disabled?: boolean;
  /** 行内注释正文(不含 `#`)。传空串表示去掉注释;不传表示沿用原有的 */
  comment?: string;
  /** 行首带 `export `;不传表示沿用原有的 */
  exportPrefix?: boolean;
}

/**
 * 值不加引号就写不回去的情况(按 dotenv 的读法):
 * 含换行(引号才能跨行)、含 `#`(会被当成注释截断)、首尾有空格(无引号会被 trim 掉)、以引号字符开头
 */
function needsQuotes(value: string): boolean {
  return /[\r\n#]/.test(value) || value !== value.trim() || /^["'`]/.test(value);
}

/**
 * 用户选的引号形态 + 值本身,决定最终写进文件的引号。
 * 用户明确选了就听用户的;没选但值不加引号就会读坏时,自动加。
 * 优先双引号;值里已有双引号、或含 `\n` 这种反斜杠序列(双引号里会被 dotenv 展开成换行)时,改用单引号
 */
export function resolveQuote(value: string, quote: EnvQuote | null | undefined): EnvQuote | null {
  if (quote) return quote;
  if (!needsQuotes(value)) return null;
  const preferSingle = !value.includes("'") && (value.includes('"') || /\\[nr]/.test(value));
  return preferSingle ? "'" : '"';
}

/**
 * 格式化单行 KV 文本。值含换行时会写成多个物理行(引号包住);
 * 这时"禁用"要给每一个物理行都加 `# `,否则重新读取时只有第一行是注释
 */
export function formatKVRaw(
  key: string,
  value: string,
  options: {
    quote?: EnvQuote | null;
    disabled?: boolean;
    end?: "\n" | "\r\n" | "";
    comment?: string;
    exportPrefix?: boolean;
  } = {}
): string {
  const { disabled = false, end = "\n", comment, exportPrefix = false } = options;
  const quote = resolveQuote(value, options.quote);
  const quotedValue = quote ? `${quote}${value}${quote}` : value;
  // 注释统一重排成 ` # 正文`。只有被编辑过的行才会走到这里重建 raw,
  // 没动过的行始终原样保留,所以不会全文重排空格
  const trailing = comment && comment.trim() !== "" ? ` # ${comment.trim()}` : "";
  const body = `${exportPrefix ? "export " : ""}${key}=${quotedValue}${trailing}`;
  const prefixed = disabled ? `# ${body.replace(/(\r?\n)/g, "$1# ")}` : body;
  return `${prefixed}${end}`;
}

/**
 * 按名字找"该动哪一行":优先第一条启用的,没有启用的就取第一条。
 * 同一个 key 写了两行是常见写法(一行注释掉留着备用),按名字全量匹配会把两行一起改掉
 */
export function findEnvLineIndex(lines: EnvLine[], key: string): number {
  const enabled = lines.findIndex((l) => l.type === "kv" && l.key === key && !l.disabled);
  if (enabled >= 0) return enabled;
  return lines.findIndex((l) => l.type === "kv" && l.key === key);
}

/** 每个 key 在文件里出现了几行(启用 + 注释掉的都算),用来在界面上标出"重复" */
export function countEnvKeys(lines: EnvLine[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const l of lines) {
    if (l.type === "kv") counts.set(l.key, (counts.get(l.key) ?? 0) + 1);
  }
  return counts;
}

export interface EnvLinePatch extends EnvVariableOptions {
  /** 改名;不传保持原名 */
  key?: string;
  value: string;
}

/**
 * 只改第 index 行(必须是 kv 行),原位重建,其他行一个字符不动。
 * 改名也在原位:此前"改名 = 删旧行 + 追加到末尾",变量会跑到文件最底下
 */
export function updateEnvVariableAt(lines: EnvLine[], index: number, patch: EnvLinePatch): EnvLine[] {
  const line = lines[index];
  if (!line || line.type !== "kv") return lines;

  const key = patch.key ?? line.key;
  const quote = resolveQuote(patch.value, patch.quote !== undefined ? patch.quote : line.quote);
  const disabled = patch.disabled !== undefined ? patch.disabled : line.disabled;
  const comment = patch.comment !== undefined ? patch.comment : line.comment;
  const exportPrefix = patch.exportPrefix !== undefined ? patch.exportPrefix : (line.exportPrefix ?? false);
  const end = line.end;

  const next: EnvLine = {
    type: "kv",
    key,
    value: patch.value,
    quote,
    disabled,
    comment: comment === "" ? undefined : comment,
    exportPrefix: exportPrefix || undefined,
    end,
    raw: formatKVRaw(key, patch.value, { quote, disabled, end, comment, exportPrefix }),
  };
  return lines.map((l, i) => (i === index ? next : l));
}

/** 删掉第 index 行 */
export function removeEnvVariableAt(lines: EnvLine[], index: number): EnvLine[] {
  const line = lines[index];
  if (!line || line.type !== "kv") return lines;
  return lines.filter((_, i) => i !== index);
}

/** 切换第 index 行的启用/禁用(在 `KEY=val` 与 `# KEY=val` 之间切换) */
export function toggleEnvVariableAt(lines: EnvLine[], index: number): EnvLine[] {
  const line = lines[index];
  if (!line || line.type !== "kv") return lines;
  return updateEnvVariableAt(lines, index, { value: line.value, disabled: !line.disabled });
}

/**
 * 按名字更新值,保持原注释状态、换行符和原有引用格式。
 * 只动 findEnvLineIndex 选中的那一行
 */
export function updateEnvVariable(
  lines: EnvLine[],
  key: string,
  newValue: string,
  options?: EnvVariableOptions
): EnvLine[] {
  const index = findEnvLineIndex(lines, key);
  if (index < 0) return lines;
  return updateEnvVariableAt(lines, index, { value: newValue, ...options });
}

/**
 * 新增环境变量,若已存在则更新那一行(优先启用的那行),若不存在则追加到末尾。
 * 不修改传入的数组:上一版会原地给最后一行补换行,React 那边拿着的旧状态会跟着变
 */
export function addEnvVariable(
  lines: EnvLine[],
  key: string,
  value: string,
  options?: EnvVariableOptions
): EnvLine[] {
  const existing = findEnvLineIndex(lines, key);
  if (existing >= 0) {
    return updateEnvVariableAt(lines, existing, { value, ...options });
  }

  const result = [...lines];
  // 确保前一行有换行符
  const last = result[result.length - 1];
  if (last && last.end === "") {
    result[result.length - 1] = { ...last, end: "\n", raw: last.raw + "\n" };
  }

  const quote = resolveQuote(value, options?.quote ?? null);
  const disabled = options?.disabled ?? false;
  const comment = options?.comment?.trim() ? options.comment : undefined;
  const exportPrefix = options?.exportPrefix ?? false;
  const end: "\n" = "\n";

  result.push({
    type: "kv",
    key,
    value,
    quote,
    disabled,
    comment,
    exportPrefix: exportPrefix || undefined,
    end,
    raw: formatKVRaw(key, value, { quote, disabled, end, comment, exportPrefix }),
  });

  return result;
}

/** 按名字删除(只删 findEnvLineIndex 选中的那一行) */
export function removeEnvVariable(lines: EnvLine[], key: string): EnvLine[] {
  const index = findEnvLineIndex(lines, key);
  return index < 0 ? lines : removeEnvVariableAt(lines, index);
}

/** 按名字切换启用/禁用(只动 findEnvLineIndex 选中的那一行) */
export function toggleEnvVariable(lines: EnvLine[], key: string): EnvLine[] {
  const index = findEnvLineIndex(lines, key);
  return index < 0 ? lines : toggleEnvVariableAt(lines, index);
}

/**
 * 一键生成 .env.example 格式文本
 * 保留所有结构、注释、空行与变量名，将变量值清空或替换为占位
 */
export function generateExampleEnv(lines: EnvLine[]): string {
  return lines
    .map((line) => {
      if (line.type !== "kv") {
        return line.raw;
      }
      const prefix = `${line.disabled ? "# " : ""}${line.exportPrefix ? "export " : ""}`;
      // 行内注释要留下:.env.example 是给团队看的模板,
      // 逐个变量的说明恰恰是最该保留的部分(值才是要清空的)
      const trailing = line.comment ? ` # ${line.comment}` : "";
      return `${prefix}${line.key}=${trailing}${line.end}`;
    })
    .join("");
}

export interface ExampleMergeResult {
  content: string;
  /** .env 里有、模板里还没有的键(这次新加进模板) */
  added: string[];
  /** 模板里有、.env 里已经没有的键(这次从模板移除) */
  removed: string[];
  /** 两边都有,模板里那一行原样保留 */
  kept: string[];
}

/**
 * 把当前 .env 的键合并进已有的 .env.example,而不是整个重新生成。
 *
 * 为什么要合并:.env.example 是提交进 git、给团队看的模板,
 * 上面经常有人手写补充("这个 key 去 XX 后台申请"这类说明),
 * 而这些内容 .env 里根本没有。整体重新生成会把它们全冲掉。
 *
 * 合并规则:
 * - 两边都有的键 → **模板里那一行原样保留**(手写的说明、占位值都不动)
 * - .env 新增的键 → 追加到模板末尾,带上行内注释
 * - .env 已删除的键 → 从模板移除
 * - 模板里独立的注释段、空行 → 原样保留
 *
 * 已有键保持模板自己的顺序、新键追加到末尾,是为了让改动最小:
 * 跟着 .env 重排会让 git diff 变得没法看。
 */
export function mergeExampleEnv(existingExampleLines: EnvLine[], envLines: EnvLine[]): ExampleMergeResult {
  const envKvs = envLines.filter((l): l is Extract<EnvLine, { type: "kv" }> => l.type === "kv");
  const envKeys = new Set(envKvs.map((l) => l.key));

  const kept: string[] = [];
  const removed: string[] = [];
  const out: string[] = [];
  const seenInExample = new Set<string>();

  for (const line of existingExampleLines) {
    if (line.type !== "kv") {
      out.push(line.raw);
      continue;
    }
    if (envKeys.has(line.key)) {
      out.push(line.raw);
      kept.push(line.key);
      seenInExample.add(line.key);
    } else {
      removed.push(line.key);
    }
  }

  const added: string[] = [];
  for (const kv of envKvs) {
    if (seenInExample.has(kv.key)) continue;
    added.push(kv.key);
    const prefix = `${kv.disabled ? "# " : ""}${kv.exportPrefix ? "export " : ""}`;
    const trailing = kv.comment ? ` # ${kv.comment}` : "";
    out.push(`${prefix}${kv.key}=${trailing}\n`);
  }

  // 追加新键之前,原内容最后一行如果没有换行会把两行黏在一起
  const content = out.join("");
  const normalized =
    added.length > 0 && content.length > 0 && !content.endsWith("\n") ? `${content}\n` : content;

  return { content: normalized, added, removed, kept };
}

/**
 * 项目名单里"用户说这个不是敏感"的条目带这个前缀,如 `!PUBLIC_KEY`。
 * 内置规则按关键词猜(KEY / TOKEN / …),`PUBLIC_KEY`、`KEY_PREFIX` 会被猜错,
 * 此前"取消敏感标记"只是把名字加进名单,内置规则照样命中,取消等于没取消。
 * 放进同一份名单而不是另开字段:名单本来就是"用户对这个项目的敏感判断",一处存完
 */
export const SECRET_IGNORE_PREFIX = "!";

/**
 * 判断是否为敏感字段。优先级:用户说不是 > 用户说是 > 内置规则(按名字的关键词)> 按值(URL 里带账号密码)。
 * 名单按项目存,不跨项目。误判方向刻意偏向"多打码":`MONKEY` 命中 KEY 会被打码,用户可以按项目取消
 */
export function isSecretKey(key: string, customSecrets?: string[], value?: string): boolean {
  const lower = key.toLowerCase();
  if (customSecrets) {
    if (customSecrets.some((s) => s.toLowerCase() === `${SECRET_IGNORE_PREFIX}${lower}`)) return false;
    if (customSecrets.some((s) => s.toLowerCase() === lower)) return true;
  }
  return DEFAULT_SECRET_PATTERN.test(key) || isSecretValue(value);
}

/**
 * 对敏感值打码
 */
/** 打码后统一显示成这一串,长度固定,不泄露原值长度 */
export const MASKED_VALUE = "••••••••";

export function maskSecret(_value: string): string {
  return MASKED_VALUE;
}

/**
 * 检查值是否由 dotenvx 加密 (识别 `encrypted:` 前缀)
 */
export function isEncryptedValue(value: string): boolean {
  return typeof value === "string" && value.startsWith("encrypted:");
}

/**
 * 计算文件内容指纹摘要（用于保存时冲突检测）
 */
export function computeFingerprint(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export type EnvDiffType = "added" | "removed" | "changed" | "unchanged";

export interface EnvDiffEntry {
  key: string;
  type: EnvDiffType;
  /** 旧版本(如快照)中的值,不存在则为 undefined */
  baseValue?: string;
  /** 新版本(如当前文件)中的值,不存在则为 undefined */
  targetValue?: string;
  /** 旧版本中该变量是否被注释禁用;该版本里没有这个变量时为 undefined */
  baseDisabled?: boolean;
  /** 新版本中该变量是否被注释禁用;该版本里没有这个变量时为 undefined */
  targetDisabled?: boolean;
  /** 两版的行内注释;只改了注释也算改动,界面上要能看出改的是注释 */
  baseComment?: string;
  targetComment?: string;
}

/**
 * 比较两份 .env 解析结果的键值差异(如"某历史快照"与"当前文件")
 * base = 旧版本, target = 新版本;returns 按 added/removed/changed/unchanged 排序、同类型内按 key 排序
 */
export function diffEnvVariables(baseLines: EnvLine[], targetLines: EnvLine[]): EnvDiffEntry[] {
  const collect = (lines: EnvLine[]): Map<string, { value: string; disabled: boolean; comment?: string }> => {
    const map = new Map<string, { value: string; disabled: boolean; comment?: string }>();
    for (const l of lines) {
      if (l.type === "kv") map.set(l.key, { value: l.value, disabled: l.disabled, comment: l.comment });
    }
    return map;
  };

  const baseMap = collect(baseLines);
  const targetMap = collect(targetLines);

  const keys = new Set<string>([...baseMap.keys(), ...targetMap.keys()]);
  const result: EnvDiffEntry[] = [];

  for (const key of keys) {
    const base = baseMap.get(key);
    const target = targetMap.get(key);

    if (base && !target) {
      result.push({ key, type: "removed", baseValue: base.value, baseDisabled: base.disabled, baseComment: base.comment });
    } else if (!base && target) {
      result.push({
        key,
        type: "added",
        targetValue: target.value,
        targetDisabled: target.disabled,
        targetComment: target.comment,
      });
    } else if (base && target) {
      // 值没变但启用状态变了也算改动:注释掉一个变量对运行结果的影响跟删掉它一样大,
      // 只比值的话这种改动在差异里会完全消失。行内注释同理——那是用户写给自己看的说明
      const same =
        base.value === target.value &&
        base.disabled === target.disabled &&
        (base.comment ?? "") === (target.comment ?? "");
      result.push({
        key,
        type: same ? "unchanged" : "changed",
        baseValue: base.value,
        targetValue: target.value,
        baseDisabled: base.disabled,
        targetDisabled: target.disabled,
        baseComment: base.comment,
        targetComment: target.comment,
      });
    }
  }

  const order: Record<EnvDiffType, number> = { added: 0, removed: 1, changed: 2, unchanged: 3 };
  return result.sort((a, b) => order[a.type] - order[b.type] || a.key.localeCompare(b.key));
}

/** `.env` 或 `.env.<段>.<段>…`,每段只允许字母数字下划线短横线(`.env.development.local` 是 Next / Vite 的标准命名) */
const ENV_FILENAME_RE = /^\.env(\.[A-Za-z0-9_-]+)*$/;

/** 模板文件:形态像环境文件,但里面没有真实值,不当环境文件管理(生成 .env.example 有专门的动作) */
export const ENV_TEMPLATE_FILENAMES: ReadonlySet<string> = new Set([".env.example", ".env.sample", ".env.template"]);

/** 原子写临时文件名里的标记(storage 层拼名用):`.env.env-butler-tmp-1234` */
export const ENV_TMP_MARKER = ".env-butler-tmp";

/**
 * 是不是原子写留下的临时文件。
 * 临时文件名故意以 `.env` 开头,好让项目的 `.env*` 忽略规则挡住崩溃残片;
 * 代价是它正好落在下面这套白名单里——不排掉的话,写盘那一瞬间的临时文件会出现在界面的下拉框里
 */
export function isEnvTempFilename(filename: string): boolean {
  return filename.includes(ENV_TMP_MARKER);
}

/**
 * 这个文件名算不算"环境文件"。白名单而不是"以 .env 开头":
 * `.envrc` 是 direnv 的 shell 脚本(设计上绝不能碰)、`.env_副本` / `.environment` 也都不是
 */
export function isEnvFilename(filename: string): boolean {
  return (
    !isEnvTempFilename(filename) && ENV_FILENAME_RE.test(filename) && !ENV_TEMPLATE_FILENAMES.has(filename)
  );
}

/** 校验新建的环境文件名是否合法(同 isEnvFilename,允许前后空白) */
export function isValidEnvFilename(filename: string): boolean {
  return isEnvFilename(filename.trim());
}
