import { createHash } from "node:crypto";
import type { EnvLine } from "./parseEnv.js";

const DEFAULT_SECRET_PATTERN = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL)/i;

export interface EnvVariableOptions {
  quote?: "'" | '"' | null;
  disabled?: boolean;
  /** 行内注释正文(不含 `#`)。传空串表示去掉注释;不传表示沿用原有的 */
  comment?: string;
}

/**
 * 格式化单行 KV 文本
 */
export function formatKVRaw(
  key: string,
  value: string,
  options: {
    quote?: "'" | '"' | null;
    disabled?: boolean;
    end?: "\n" | "\r\n" | "";
    comment?: string;
  } = {}
): string {
  const { quote = null, disabled = false, end = "\n", comment } = options;
  const quotedValue = quote ? `${quote}${value}${quote}` : value;
  const prefix = disabled ? "# " : "";
  // 注释统一重排成 ` # 正文`。只有被编辑过的行才会走到这里重建 raw,
  // 没动过的行始终原样保留,所以不会全文重排空格
  const trailing = comment && comment.trim() !== "" ? ` # ${comment.trim()}` : "";
  return `${prefix}${key}=${quotedValue}${trailing}${end}`;
}

/**
 * 更新已有的环境变量值，保持原注释状态、换行符和原有引用格式
 */
export function updateEnvVariable(
  lines: EnvLine[],
  key: string,
  newValue: string,
  options?: EnvVariableOptions
): EnvLine[] {
  return lines.map((line) => {
    if (line.type !== "kv" || line.key !== key) return line;

    const quote = options?.quote !== undefined ? options.quote : line.quote;
    const disabled = options?.disabled !== undefined ? options.disabled : line.disabled;
    const comment = options?.comment !== undefined ? options.comment : line.comment;
    const end = line.end;

    return {
      type: "kv",
      key: line.key,
      value: newValue,
      quote,
      disabled,
      comment: comment === "" ? undefined : comment,
      end,
      raw: formatKVRaw(line.key, newValue, { quote, disabled, end, comment }),
    };
  });
}

/**
 * 新增环境变量，若已存在则更新，若不存在则追加到末尾
 */
export function addEnvVariable(
  lines: EnvLine[],
  key: string,
  value: string,
  options?: EnvVariableOptions
): EnvLine[] {
  const exists = lines.some((l) => l.type === "kv" && l.key === key);
  if (exists) {
    return updateEnvVariable(lines, key, value, options);
  }

  const result = [...lines];
  // 确保前一行有换行符
  if (result.length > 0) {
    const last = result[result.length - 1];
    if (last && last.end === "") {
      last.end = "\n";
      last.raw = last.raw + "\n";
    }
  }

  const quote = options?.quote ?? null;
  const disabled = options?.disabled ?? false;
  const comment = options?.comment?.trim() ? options.comment : undefined;
  const end: "\n" = "\n";

  result.push({
    type: "kv",
    key,
    value,
    quote,
    disabled,
    comment,
    end,
    raw: formatKVRaw(key, value, { quote, disabled, end, comment }),
  });

  return result;
}

/**
 * 删除指定 key 的环境变量
 */
export function removeEnvVariable(lines: EnvLine[], key: string): EnvLine[] {
  return lines.filter((line) => !(line.type === "kv" && line.key === key));
}

/**
 * 切换指定 key 的启用/禁用状态（在 `KEY=val` 与 `# KEY=val` 之间切换）
 */
export function toggleEnvVariable(lines: EnvLine[], key: string): EnvLine[] {
  return lines.map((line) => {
    if (line.type !== "kv" || line.key !== key) return line;

    const newDisabled = !line.disabled;
    return {
      ...line,
      disabled: newDisabled,
      raw: formatKVRaw(line.key, line.value, {
        quote: line.quote,
        disabled: newDisabled,
        end: line.end,
        comment: line.comment,
      }),
    };
  });
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
      const prefix = line.disabled ? "# " : "";
      // 行内注释要留下:.env.example 是给团队看的模板,
      // 逐个变量的说明恰恰是最该保留的部分(值才是要清空的)
      const trailing = line.comment ? ` # ${line.comment}` : "";
      return `${prefix}${line.key}=${trailing}${line.end}`;
    })
    .join("");
}

/**
 * 判断是否为敏感字段
 * 匹配内置规则 (KEY, TOKEN, SECRET, PASSWORD, PASSWD, CREDENTIAL)，或项目自定义敏感列表
 */
export function isSecretKey(key: string, customSecrets?: string[]): boolean {
  if (customSecrets && customSecrets.some((s) => s.toLowerCase() === key.toLowerCase())) {
    return true;
  }
  return DEFAULT_SECRET_PATTERN.test(key);
}

/**
 * 对敏感值打码
 */
export function maskSecret(_value: string): string {
  return "••••••••";
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
}

/**
 * 比较两份 .env 解析结果的键值差异(如"某历史快照"与"当前文件")
 * base = 旧版本, target = 新版本;returns 按 added/removed/changed/unchanged 排序、同类型内按 key 排序
 */
export function diffEnvVariables(baseLines: EnvLine[], targetLines: EnvLine[]): EnvDiffEntry[] {
  const baseMap = new Map<string, string>();
  for (const l of baseLines) {
    if (l.type === "kv") baseMap.set(l.key, l.value);
  }
  const targetMap = new Map<string, string>();
  for (const l of targetLines) {
    if (l.type === "kv") targetMap.set(l.key, l.value);
  }

  const keys = new Set<string>([...baseMap.keys(), ...targetMap.keys()]);
  const result: EnvDiffEntry[] = [];

  for (const key of keys) {
    const inBase = baseMap.has(key);
    const inTarget = targetMap.has(key);

    if (inBase && !inTarget) {
      result.push({ key, type: "removed", baseValue: baseMap.get(key) });
    } else if (!inBase && inTarget) {
      result.push({ key, type: "added", targetValue: targetMap.get(key) });
    } else {
      const baseValue = baseMap.get(key);
      const targetValue = targetMap.get(key);
      result.push({
        key,
        type: baseValue === targetValue ? "unchanged" : "changed",
        baseValue,
        targetValue,
      });
    }
  }

  const order: Record<EnvDiffType, number> = { added: 0, removed: 1, changed: 2, unchanged: 3 };
  return result.sort((a, b) => order[a.type] - order[b.type] || a.key.localeCompare(b.key));
}

const ENV_FILENAME_RE = /^\.env(\.[A-Za-z0-9_-]+)?$/;

/**
 * 校验新建的环境文件名是否合法(必须是 .env 或 .env.<后缀>,后缀仅允许字母数字下划线短横线)
 */
export function isValidEnvFilename(filename: string): boolean {
  return ENV_FILENAME_RE.test(filename.trim());
}
