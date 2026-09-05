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
});
