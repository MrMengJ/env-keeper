/**
 * .env 文件解析 —— 纯函数,无副作用,不碰文件系统。
 *
 * 设计原则:因为 .env 文件是真相源,编辑后要能无损写回(round-trip),
 * 所以每一行都保留原始文本 `raw`(含行尾),同时给出语义覆盖。
 *
 * 第一版范围(刻意克制):
 *  - 分类行:空行 / 注释 / KV / 被注释的 KV(# 开头且去掉注释符后是合法 KV)
 *  - KV 值支持单双引号包裹,解析时去掉引号
 *  - 行内注释(`KEY=value # note`)按 dotenv v16 的规则切出来放进 comment 字段:
 *    值被引号包住时,引号内的 `#` 属于值;没有引号时,遇到第一个 `#` 就截断。
 *    刻意跟 dotenv 保持一致——值最终是被 Vite/Next 这类工具经 dotenv 读走的,
 *    解析规则不一致会导致"界面显示的值 != 程序拿到的值",比不解析更危险。
 */

export type EnvLine =
  | { type: "blank"; raw: string; end: "\n" | "\r\n" | "" }
  | { type: "comment"; raw: string; end: "\n" | "\r\n" | "" }
  | {
      type: "kv";
      raw: string;
      end: "\n" | "\r\n" | ""; // 该行是否带换行(便于写回时重建文件)
      disabled: boolean; // true 表示被注释掉的 KV,如 `# KEY=value`
      key: string;
      value: string; // 已去除引号与行内注释的值
      quote: "'" | '"' | null; // 值原本是否被引号包裹
      comment?: string; // 行内注释的正文(不含 `#` 与两侧空白);没有则为 undefined
    };

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** 去掉前导空白与至多一个前导 `#`(含其后至多一个空格),用于识别"被注释的 KV"。 */
function stripCommentMarker(line: string): string {
  return line.replace(/^\s*# ?/, "");
}

/**
 * 从 `=` 右边的原文里切出行内注释。
 * 规则对齐 dotenv v16:值被引号包住时先跳过整段引号,之后的第一个 `#` 才算注释起点;
 * 没有引号时,第一个 `#` 就是注释起点(不要求前面有空格)。
 */
function splitInlineComment(raw: string): { valuePart: string; comment?: string } {
  const offset = raw.length - raw.trimStart().length;
  const body = raw.slice(offset);
  const first = body[0];

  // 引号包裹时,把查找起点挪到收尾引号之后,保护引号内的 `#`
  let searchFrom = 0;
  if (first === '"' || first === "'") {
    const closing = body.indexOf(first, 1);
    if (closing >= 0) searchFrom = closing + 1;
  }

  const hash = body.indexOf("#", searchFrom);
  if (hash < 0) return { valuePart: raw };

  return {
    valuePart: raw.slice(0, offset + hash),
    comment: body.slice(hash + 1).trim(),
  };
}

function parseKV(body: string): { key: string; value: string; quote: "'" | '"' | null; comment?: string } | null {
  const eq = body.indexOf("=");
  if (eq < 0) return null;
  const key = body.slice(0, eq).trim();
  if (!KEY_RE.test(key)) return null;

  const { valuePart, comment } = splitInlineComment(body.slice(eq + 1));
  // 切走注释后值尾部会残留空白(`KEY=abc  # note`),会让下面的引号识别失效,所以要去掉;
  // 没有注释时保持原样,不改动既有行为
  let value = comment === undefined ? valuePart : valuePart.trimEnd();

  // 去除整段的包裹引号
  let quote: "'" | '"' | null = null;
  const first = value[0];
  const last = value[value.length - 1];
  if ((first === '"' || first === "'") && last === first && value.length >= 2) {
    quote = first;
    value = value.slice(1, -1);
  }

  return { key, value, quote, comment };
}

function classify(body: string): Extract<EnvLine, { type: "kv" }> | "blank" | "comment" {
  if (body.trim() === "") return "blank";

  if (/^\s*#/.test(body)) {
    const kv = parseKV(stripCommentMarker(body));
    if (kv) {
      return {
        type: "kv",
        raw: body, // raw 在分类后被外层替换为带行尾的完整行
        end: "",
        disabled: true,
        key: kv.key,
        value: kv.value,
        quote: kv.quote,
        comment: kv.comment,
      };
    }
    return "comment";
  }

  const kv = parseKV(body);
  if (kv) {
    return {
      type: "kv",
      raw: body,
      end: "",
      disabled: false,
      key: kv.key,
      value: kv.value,
      quote: kv.quote,
      comment: kv.comment,
    };
  }

  // 非空、非注释、非合法 KV —— 按注释处理,避免丢失原文(不破坏 round-trip)
  return "comment";
}

/** 解析 .env 文本为结构化行数组,保留顺序、原文与行尾。 */
export function parseEnv(input: string): EnvLine[] {
  const result: EnvLine[] = [];
  let rest = input;

  while (rest.length > 0) {
    // 逐行提取:主体(不含换行) + 可选行尾(\r\n 或 \n)
    const m = /^([^\r\n]*)(\r\n|\n)?/.exec(rest);
    const body = m?.[1] ?? "";
    const end = (m?.[2] as "\r\n" | "\n" | undefined) ?? "";

    const cls = classify(body);

    if (cls === "blank") {
      result.push({ type: "blank", raw: body + end, end });
    } else if (cls === "comment") {
      result.push({ type: "comment", raw: body + end, end });
    } else {
      // cls 是 kv 结构,填上真实 raw/end
      result.push({ ...cls, raw: body + end, end });
    }

    rest = rest.slice(body.length + end.length);
  }

  return result;
}

/** 将解析结果写回为文本(round-trip 辅助)。 */
export function serializeEnv(lines: EnvLine[]): string {
  return lines.map((l) => l.raw).join("");
}
