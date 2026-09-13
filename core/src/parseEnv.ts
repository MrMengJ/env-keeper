/**
 * .env 文件解析 —— 纯函数,无副作用,不碰文件系统。
 *
 * 设计原则:因为 .env 文件是真相源,编辑后要能无损写回(round-trip),
 * 所以每一行都保留原始文本 `raw`(含行尾),同时给出语义覆盖。
 *
 * 语义解析**对齐 dotenv v16**(2026-09-11 用 dotenv 16.6.1 逐例对照过):
 * 值最终是被 Vite / Next 这类工具经 dotenv 读走的,规则不一致会导致
 * "界面显示的值 != 程序拿到的值",比不解析更危险。对齐的点:
 *  - 变量名前可以有 `export `;变量名允许字母数字下划线点短横线
 *  - 无引号的值去首尾空格;遇到第一个 `#` 截断,后面是行内注释
 *  - 单引号 / 双引号 / 反引号包住的值去掉引号,引号内的 `#` 属于值,引号可以跨行;
 *    反斜杠转义的同种引号不算收尾
 *  - 双引号里的 `\n` / `\r` 展开成真换行(dotenv 就这么做,单引号不展开)
 *  - 引号里夹着同种引号(`"a"b"`)按 dotenv 的兜底:先按无引号截,首尾是同一种引号就剥掉一对
 *  - 刻意不对齐的:`KEY: value` 这种冒号写法不认;引号没关上的行 dotenv 会整行丢掉,这里按无引号处理
 *
 * 分类:空行 / 注释 / KV / 被注释的 KV(# 开头且去掉注释符后是合法 KV)。
 * 非空、非注释、又不是合法 KV 的行按注释处理,原文不丢。
 */

export type EnvQuote = "'" | '"' | "`";

export type EnvLine =
  | { type: "blank"; raw: string; end: "\n" | "\r\n" | "" }
  | { type: "comment"; raw: string; end: "\n" | "\r\n" | "" }
  | {
      type: "kv";
      raw: string;
      end: "\n" | "\r\n" | ""; // 该行是否带换行(便于写回时重建文件);多行值时是最后一个物理行的行尾
      disabled: boolean; // true 表示被注释掉的 KV,如 `# KEY=value`
      key: string;
      value: string; // 已去除引号与行内注释、按 dotenv 规则处理过的值;多行值带真换行
      quote: EnvQuote | null; // 值原本是否被引号包裹
      comment?: string; // 行内注释的正文(不含 `#` 与两侧空白);没有则为 undefined
      exportPrefix?: boolean; // 行首带 `export `(dotenv 认,shell 里 source 也能用),写回时保留
    };

/** dotenv 的变量名规则:`[\w.-]+` */
export const ENV_KEY_RE = /^[\w.-]+$/;

/** 去掉前导空白与至多一个前导 `#`(含其后至多一个空格),用于识别"被注释的 KV"。 */
function stripCommentMarker(line: string): string {
  return line.replace(/^\s*# ?/, "");
}

/** 从 from 起找同种引号的收尾位置,反斜杠转义的不算;找不到返回 -1 */
function findClosingQuote(text: string, quote: EnvQuote, from: number): number {
  for (let i = from; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === quote) return i;
  }
  return -1;
}

function isQuote(ch: string | undefined): ch is EnvQuote {
  return ch === '"' || ch === "'" || ch === "`";
}

/** 把 `=` 左边拆成 export 前缀 + 变量名;不合法返回 null */
function parseKeyPart(left: string): { key: string; exportPrefix: boolean } | null {
  const trimmed = left.trim();
  const exportMatch = /^export\s+(.*)$/.exec(trimmed);
  const key = exportMatch?.[1] !== undefined ? exportMatch[1].trim() : trimmed;
  const exportPrefix = exportMatch !== null;
  if (!ENV_KEY_RE.test(key)) return null;
  return { key, exportPrefix };
}

/** 无引号的值:第一个 `#` 截断,值去首尾空格 */
function parseUnquotedValue(rest: string): { value: string; comment?: string } {
  const hash = rest.indexOf("#");
  if (hash < 0) return { value: rest.trim() };
  return { value: rest.slice(0, hash).trim(), comment: rest.slice(hash + 1).trim() };
}

type ParsedKV = {
  key: string;
  value: string;
  quote: EnvQuote | null;
  comment?: string;
  exportPrefix: boolean;
};

function parseKV(body: string): ParsedKV | null {
  const eq = body.indexOf("=");
  if (eq < 0) return null;
  const keyPart = parseKeyPart(body.slice(0, eq));
  if (!keyPart) return null;

  const rest = body.slice(eq + 1);
  const stripped = rest.trimStart();
  const first = stripped[0];

  if (isQuote(first)) {
    const closing = findClosingQuote(stripped, first, 1);
    if (closing >= 0) {
      const after = stripped.slice(closing + 1).trimStart();
      // 收尾引号后面只能是空白或注释;还有别的东西(如 `"a"b`)dotenv 会整行丢掉,这里退回无引号处理
      if (after === "" || after.startsWith("#")) {
        let value = stripped.slice(1, closing);
        if (first === '"') value = value.replace(/\\n/g, "\n").replace(/\\r/g, "\r");
        const comment = after.startsWith("#") ? after.slice(1).trim() : undefined;
        return { ...keyPart, value, quote: first, comment };
      }
    }
  }

  const { value, comment } = parseUnquotedValue(rest);
  // dotenv 的兜底:按无引号截完之后,首尾还是同一种引号就把这一对剥掉(`"a"b"` → `a"b`)
  const head = value[0];
  if (isQuote(head) && value.length >= 2 && value[value.length - 1] === head) {
    let inner = value.slice(1, -1);
    if (head === '"') inner = inner.replace(/\\n/g, "\n").replace(/\\r/g, "\r");
    return { ...keyPart, value: inner, quote: head, comment };
  }
  return { ...keyPart, value, quote: null, comment };
}

function classify(body: string): Extract<EnvLine, { type: "kv" }> | "blank" | "comment" {
  if (body.trim() === "") return "blank";

  const commented = /^\s*#/.test(body);
  const kv = parseKV(commented ? stripCommentMarker(body) : body);
  if (!kv) return "comment";

  return {
    type: "kv",
    raw: body, // raw 在分类后被外层替换为带行尾的完整行
    end: "",
    disabled: commented,
    key: kv.key,
    value: kv.value,
    quote: kv.quote,
    comment: kv.comment,
    exportPrefix: kv.exportPrefix || undefined,
  };
}

/** 取出一个物理行:主体(不含换行) + 行尾 */
function takeLine(s: string): { body: string; end: "\n" | "\r\n" | "" } {
  const m = /^([^\r\n]*)(\r\n|\n)?/.exec(s);
  return { body: m?.[1] ?? "", end: (m?.[2] as "\r\n" | "\n" | undefined) ?? "" };
}

/**
 * 这一行是不是"引号开了没关"的赋值(`KEY="第一行`)。是就返回那个引号,否则 null。
 * dotenv 允许引号包住的值跨行,插件不认的话,编辑这种变量会把文件腰斩成一行正常一行垃圾。
 */
function unclosedQuote(body: string): EnvQuote | null {
  const eq = body.indexOf("=");
  if (eq < 0 || !parseKeyPart(body.slice(0, eq))) return null;
  const stripped = body.slice(eq + 1).trimStart();
  const first = stripped[0];
  if (!isQuote(first)) return null;
  return findClosingQuote(stripped, first, 1) < 0 ? first : null;
}

/** 解析 .env 文本为结构化行数组,保留顺序、原文与行尾。引号包住的多行值算一条变量。 */
export function parseEnv(input: string): EnvLine[] {
  const result: EnvLine[] = [];
  let rest = input;

  while (rest.length > 0) {
    const first = takeLine(rest);
    let raw = first.body;
    let logical = first.body;
    let end = first.end;
    let consumed = first.body.length + first.end.length;

    // 引号没关上就往后吞行,直到遇到收尾引号;被注释掉的多行值要求后续每一行也都带 #
    const commented = /^\s*#/.test(first.body);
    const quote = unclosedQuote(commented ? stripCommentMarker(first.body) : first.body);
    if (quote) {
      let scan = consumed;
      let extRaw = raw;
      let extLogical = logical;
      let extEnd = end;
      let closed = false;
      while (scan < rest.length) {
        const line = takeLine(rest.slice(scan));
        if (commented && !/^\s*#/.test(line.body)) break;
        const lineLogical = commented ? stripCommentMarker(line.body) : line.body;
        extRaw += extEnd + line.body;
        extLogical += extEnd + lineLogical;
        extEnd = line.end;
        scan += line.body.length + line.end.length;
        if (findClosingQuote(lineLogical, quote, 0) >= 0) {
          closed = true;
          break;
        }
      }
      // 到文件尾都没关上:按单行处理,跟以前一样,不吞掉后面的内容
      if (closed) {
        raw = extRaw;
        logical = extLogical;
        end = extEnd;
        consumed = scan;
      }
    }

    const cls = classify(logical);

    if (cls === "blank") {
      result.push({ type: "blank", raw: raw + end, end });
    } else if (cls === "comment") {
      result.push({ type: "comment", raw: raw + end, end });
    } else {
      // cls 是 kv 结构,填上真实 raw/end
      result.push({ ...cls, raw: raw + end, end });
    }

    rest = rest.slice(consumed);
  }

  return result;
}

/** 将解析结果写回为文本(round-trip 辅助)。 */
export function serializeEnv(lines: EnvLine[]): string {
  return lines.map((l) => l.raw).join("");
}
