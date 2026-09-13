import { describe, expect, it } from "vitest";
import { editDistance, lintShellSnippet } from "./shellLint.js";

describe("shellLint", () => {
  it("editDistance: 相邻字符互换只算一步", () => {
    expect(editDistance("exprot", "export")).toBe(1);
    expect(editDistance("exoprt", "export")).toBe(1);
    expect(editDistance("expot", "export")).toBe(1);
    expect(editDistance("alais", "alias")).toBe(1);
    expect(editDistance("export", "export")).toBe(0);
    expect(editDistance("echo", "export")).toBeGreaterThan(1);
  });

  it("认出把 export 写错的行,并给出建议", () => {
    const warnings = lintShellSnippet(
      ['export JAVA_HOME="/Library/Java/Home"', "exprot PASSWORD=dsafesdc1", "export KEY=ADFEE"].join("\n"),
    );

    expect(warnings).toEqual([
      {
        line: 2,
        code: "misspelledKeyword",
        word: "exprot",
        suggestion: "export",
        text: "exprot PASSWORD=dsafesdc1",
      },
    ]);
  });

  it("首词不像任何关键字时,只提示「这条命令不认识」,不瞎猜", () => {
    const warnings = lintShellSnippet("mycommand FOO=bar\n");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.code).toBe("unknownAssignmentPrefix");
    expect(warnings[0]?.suggestion).toBeUndefined();
  });

  it("合法写法不报警", () => {
    const content = [
      "export FOO=bar",
      "alias ll=\"ls -la\"",
      "env NODE_ENV=production node app.js",
      "local TMP=1",
      "readonly X=1",
      "# exprot COMMENTED=1",
      "PLAIN=value",
      "",
    ].join("\n");
    expect(lintShellSnippet(content)).toEqual([]);
  });
});
