import { describe, it, expect } from "vitest";
import { parseEnv, serializeEnv } from "./parseEnv.js";

describe("parseEnv", () => {
  it("解析普通 KV", () => {
    const lines = parseEnv("FOO=bar\n");
    expect(lines).toHaveLength(1);
    const [line] = lines;
    expect(line).toMatchObject({ type: "kv", key: "FOO", value: "bar", disabled: false });
  });

  it("保留顺序与空行、注释", () => {
    const lines = parseEnv("# 注释\n\nFOO=1\nBAR=2\n");
    expect(lines.map((l) => l.type)).toEqual(["comment", "blank", "kv", "kv"]);
    expect(lines.map((l) => (l.type === "kv" ? l.key : null))).toEqual([null, null, "FOO", "BAR"]);
  });

  it("去除值的包裹引号并记录 quote", () => {
    const input = ['FOO="hello world"', "BAR='it is'"].join("\n") + "\n";
    const lines = parseEnv(input);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ type: "kv", key: "FOO", value: "hello world", quote: '"' });
    expect(lines[1]).toMatchObject({ type: "kv", key: "BAR", value: "it is", quote: "'" });
  });

  it("识别被注释掉的 KV(# KEY=value → disabled)", () => {
    const lines = parseEnv("# DISABLED_KEY=1\nACTIVE=2\n");
    expect(lines[0]).toMatchObject({ type: "kv", key: "DISABLED_KEY", value: "1", disabled: true });
    expect(lines[1]).toMatchObject({ type: "kv", key: "ACTIVE", value: "2", disabled: false });
  });

  it("纯注释(去掉 # 后不是合法 KV)按 comment 处理", () => {
    const lines = parseEnv("# 这是一段说明\n# not-a-key\n");
    expect(lines.every((l) => l.type === "comment")).toBe(true);
  });

  it("值为空 / 值为空字符串", () => {
    const lines = parseEnv("EMPTY=\nSET=\n");
    expect(lines[0]).toMatchObject({ type: "kv", key: "EMPTY", value: "" });
    expect(lines[1]).toMatchObject({ type: "kv", key: "SET", value: "" });
  });

  it("支持 CRLF 行尾并正确保留", () => {
    const lines = parseEnv("FOO=1\r\nBAR=2\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ end: "\r\n" });
    expect(lines[1]).toMatchObject({ end: "\r\n" });
  });

  it("round-trip: 解析再序列化,输出与输入一致", () => {
    const input = "# header\n\nFOO=bar\n# DISABLED=x\nBAZ=\"quoted value\"\n";
    expect(serializeEnv(parseEnv(input))).toBe(input);
  });

  it("行内注释:按 dotenv 规则切出 comment", () => {
    const [line] = parseEnv("DATABASE_URL=postgres://localhost/app # 本地开发用");
    expect(line).toMatchObject({
      type: "kv",
      key: "DATABASE_URL",
      value: "postgres://localhost/app",
      comment: "本地开发用",
    });
  });

  it("行内注释:引号内的 # 属于值,不是注释", () => {
    const [quoted] = parseEnv('PASSWORD="ab#cd" # 真注释');
    expect(quoted).toMatchObject({ value: "ab#cd", quote: '"', comment: "真注释" });

    // 整段被引号包住且没有尾随注释时,# 全部属于值
    const [onlyValue] = parseEnv("TOKEN='a#b#c'");
    expect(onlyValue).toMatchObject({ value: "a#b#c", comment: undefined });
  });

  it("行内注释:无引号时第一个 # 就截断(与 dotenv 一致,不要求前面有空格)", () => {
    const [line] = parseEnv("SECRET=abc#123");
    expect(line).toMatchObject({ value: "abc", comment: "123" });
  });

  it("行内注释:没有注释时不产生 comment 字段", () => {
    const [line] = parseEnv("PORT=3000");
    expect(line).toMatchObject({ value: "3000", comment: undefined });
  });

  it("行内注释:被注释禁用的变量也能带行内注释", () => {
    const [line] = parseEnv("# PORT=3000 # 暂时停用");
    expect(line).toMatchObject({ type: "kv", disabled: true, key: "PORT", value: "3000", comment: "暂时停用" });
  });

  it("行内注释:纯注释行不会被误认成变量", () => {
    const [line] = parseEnv("# 这一行只是说明");
    expect(line?.type).toBe("comment");
  });

  it("行内注释:没有动过的行仍然原样写回", () => {
    const src = "A=1   #   空格很乱的注释\nB=2\n";
    expect(serializeEnv(parseEnv(src))).toBe(src);
  });

  it("多行值:引号包住的值可以跨行,算一条变量,原文完整保留", () => {
    const src = 'CERT="line1\nline2\nline3"\nNEXT=1\n';
    const lines = parseEnv(src);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ type: "kv", key: "CERT", value: "line1\nline2\nline3", quote: '"' });
    expect(lines[1]).toMatchObject({ type: "kv", key: "NEXT" });
    expect(serializeEnv(lines)).toBe(src);
  });

  it("多行值:收尾引号后面可以带行内注释", () => {
    const [line] = parseEnv("KEY='a\nb' # 两行\n");
    expect(line).toMatchObject({ type: "kv", key: "KEY", value: "a\nb", quote: "'", comment: "两行" });
  });

  it("多行值:被注释掉的多行值,后续行也都带 # 才算一条", () => {
    const src = '# CERT="line1\n# line2"\nNEXT=1\n';
    const lines = parseEnv(src);
    expect(lines[0]).toMatchObject({ type: "kv", key: "CERT", disabled: true, value: "line1\nline2" });
    expect(lines).toHaveLength(2);
    expect(serializeEnv(lines)).toBe(src);
  });

  it("多行值:引号到文件尾都没关上,按单行处理,不吞后面的行", () => {
    const lines = parseEnv('BROKEN="oops\nNEXT=1\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ type: "kv", key: "BROKEN", value: '"oops', quote: null });
    expect(lines[1]).toMatchObject({ type: "kv", key: "NEXT" });
  });

  it("多行值:CRLF 文件里的多行值也能识别并原样写回", () => {
    const src = 'A="x\r\ny"\r\nB=2\r\n';
    const lines = parseEnv(src);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ key: "A", value: "x\r\ny", end: "\r\n" });
    expect(serializeEnv(lines)).toBe(src);
  });

  describe("对齐 dotenv 16(2026-09-11 逐例对照)", () => {
    it("export 前缀:认出来是变量,并记住带前缀", () => {
      const [line] = parseEnv("export FOO=bar\n");
      expect(line).toMatchObject({ type: "kv", key: "FOO", value: "bar", exportPrefix: true });
      const [off] = parseEnv("# export FOO=bar\n");
      expect(off).toMatchObject({ type: "kv", key: "FOO", disabled: true, exportPrefix: true });
      const [plain] = parseEnv("FOO=bar\n");
      expect(plain).toMatchObject({ type: "kv", exportPrefix: undefined });
    });

    it("无引号的值去首尾空格;引号两侧的空白也不算值", () => {
      expect(parseEnv("A= 1")[0]).toMatchObject({ value: "1" });
      expect(parseEnv("  A  =  1  ")[0]).toMatchObject({ key: "A", value: "1" });
      expect(parseEnv('A=  "q"  ')[0]).toMatchObject({ value: "q", quote: '"' });
    });

    it("反引号也是引号", () => {
      expect(parseEnv("A=`tick # not comment`")[0]).toMatchObject({ value: "tick # not comment", quote: "`" });
    });

    it("双引号里的 \\n 展开成真换行,单引号不展开", () => {
      expect(parseEnv('A="l1\\nl2"')[0]).toMatchObject({ value: "l1\nl2" });
      expect(parseEnv("A='l1\\nl2'")[0]).toMatchObject({ value: "l1\\nl2" });
    });

    it("反斜杠转义的引号不算收尾", () => {
      expect(parseEnv('A="a \\" # b"')[0]).toMatchObject({ value: 'a \\" # b', comment: undefined });
    });

    it("变量名允许点和短横线、可以数字开头(dotenv 的规则)", () => {
      expect(parseEnv("A.B=1")[0]).toMatchObject({ type: "kv", key: "A.B" });
      expect(parseEnv("A-B=1")[0]).toMatchObject({ type: "kv", key: "A-B" });
      expect(parseEnv("1A=1")[0]).toMatchObject({ type: "kv", key: "1A" });
      expect(parseEnv("A B=1")[0]?.type).toBe("comment");
    });

    it("引号里夹着同种引号:按 dotenv 的兜底剥掉首尾一对", () => {
      expect(parseEnv('A="a"b"')[0]).toMatchObject({ type: "kv", value: 'a"b', quote: '"' });
      expect(parseEnv("A='it''s'")[0]).toMatchObject({ type: "kv", value: "it''s", quote: "'" });
      // 首尾不是同一种引号就当无引号
      expect(parseEnv('A="a"b')[0]).toMatchObject({ type: "kv", value: '"a"b', quote: null });
    });
  });
});
