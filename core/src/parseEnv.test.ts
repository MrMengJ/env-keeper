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
});
