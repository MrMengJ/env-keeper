/**
 * Shell 片段的"意图检查"。
 *
 * 为什么需要它:`zsh -n` 只查语法,而 `exprot PASSWORD=xxx` 语法完全合法——
 * 它在 shell 眼里是"带一个临时环境变量执行 exprot 这条命令",报不出任何错,
 * 但用户的本意显然是 export,这一行永远不会生效。这类"语法对、意图错"
 * 只能靠启发式识别,所以这里给出的是**提醒**而不是错误:调用方应该
 * 让用户确认后仍可保存,毕竟 `env FOO=bar mycmd` 这种写法也是合法的。
 */

export type ShellLintCode = "misspelledKeyword" | "unknownAssignmentPrefix";

export interface ShellLintWarning {
  /** 行号,从 1 开始 */
  line: number;
  code: ShellLintCode;
  /** 被怀疑写错的那个词 */
  word: string;
  /** 猜出来的正确写法(仅 misspelledKeyword 有) */
  suggestion?: string;
  /** 该行原文(已去掉首尾空白) */
  text: string;
}

/** 合法地出现在 `VAR=value` 前面的命令,见到这些就不再怀疑 */
const KNOWN_PREFIXES = new Set([
  "export",
  "local",
  "declare",
  "typeset",
  "readonly",
  "alias",
  "env",
  "unset",
  "set",
  "sudo",
  "command",
  "exec",
  "eval",
  "builtin",
  "nohup",
  "time",
  "then",
  "do",
  "else",
  "elif",
]);

/** 会被"猜错别字"的关键字 */
const KEYWORDS = ["export", "alias", "readonly", "declare", "typeset", "unset", "local"];

/** 形如 `<词> <变量名>=` 的行——真正会被误写成 exprot 的就是这种 */
const ASSIGNMENT_WITH_PREFIX_RE = /^\s*([A-Za-z_][A-Za-z0-9_.-]*)\s+([A-Za-z_][A-Za-z0-9_]*)=/;

/**
 * 受限的 Damerau-Levenshtein 距离(允许相邻两字符互换算一步)。
 * 必须支持"互换"这一步:最典型的错法 exprot / exoprt 都是两个字母调了位置,
 * 普通 Levenshtein 会算成 2,跟随便打错两个字母混在一起,分不出来。
 */
export function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const d: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));

  for (let i = 0; i <= m; i++) d[i]![0] = i;
  for (let j = 0; j <= n; j++) d[0]![j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, d[i - 2]![j - 2]! + 1);
      }
      d[i]![j] = best;
    }
  }

  return d[m]![n]!;
}

/**
 * 检查一段 shell 代码里"看起来写错了"的行。返回空数组表示没发现可疑之处。
 */
export function lintShellSnippet(content: string): ShellLintWarning[] {
  const warnings: ShellLintWarning[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    const text = raw.trim();
    if (text === "" || text.startsWith("#")) continue;

    const match = ASSIGNMENT_WITH_PREFIX_RE.exec(raw);
    if (!match) continue;

    const word = match[1]!;
    if (KNOWN_PREFIXES.has(word)) continue;

    const suggestion = KEYWORDS.find((k) => editDistance(word.toLowerCase(), k) === 1);
    warnings.push({
      line: i + 1,
      code: suggestion ? "misspelledKeyword" : "unknownAssignmentPrefix",
      word,
      ...(suggestion ? { suggestion } : {}),
      text,
    });
  }

  return warnings;
}
