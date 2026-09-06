import { describe, expect, it } from "vitest";
import {
  addShellSnippet,
  createEmptyShellConfig,
  formatShellConfig,
  generateShellScript,
  moveShellSnippet,
  matchesDeclaredType,
  parseShellConfig,
  removeShellSnippet,
  toggleShellSnippet,
  updateShellSnippet,
} from "./shellTrack.js";
import { ConfigFileError } from "./configFile.js";

describe("shellTrack", () => {
  it("CRUD snippets", () => {
    const cfg = createEmptyShellConfig();
    const { config: c1, snippet: s1 } = addShellSnippet(cfg, {
      name: "JAVA_HOME",
      type: "export",
      content: 'export JAVA_HOME="/Library/Java/Home"',
      enabled: true,
      description: "Default Java",
    });

    expect(c1.snippets).toHaveLength(1);
    expect(s1.name).toBe("JAVA_HOME");

    const updated = updateShellSnippet(c1, s1.id, { description: "Updated Java" });
    expect(updated.snippets[0]?.description).toBe("Updated Java");

    const disabled = toggleShellSnippet(updated, s1.id);
    expect(disabled.snippets[0]?.enabled).toBe(false);

    const removed = removeShellSnippet(disabled, s1.id);
    expect(removed.snippets).toHaveLength(0);
  });

  it("generateShellScript: ignores disabled snippets and formats header", () => {
    const snippets = [
      {
        id: "1",
        name: "JAVA_HOME",
        type: "export" as const,
        content: 'export JAVA_HOME="/opt/java"',
        enabled: true,
        description: "Primary JDK",
      },
      {
        id: "2",
        name: "gs alias",
        type: "alias" as const,
        content: 'alias gs="git status"',
        enabled: false,
      },
      {
        id: "3",
        name: "pnpm alias",
        type: "alias" as const,
        content: 'alias p="pnpm"',
        enabled: true,
      },
    ];

    const script = generateShellScript(snippets);
    expect(script).toContain("source ~/.env-butler/shell.sh");
    expect(script).toContain('export JAVA_HOME="/opt/java"');
    expect(script).toContain('alias p="pnpm"');
    expect(script).not.toContain('alias gs="git status"');
  });

  it("matchesDeclaredType: export/alias should lead with their keyword, snippet is unrestricted", () => {
    expect(matchesDeclaredType("export", 'export FOO="bar"')).toBe(true);
    expect(matchesDeclaredType("export", 'export FOO="bar"; export BAZ="qux"')).toBe(true);
    expect(matchesDeclaredType("export", 'alias ll="ls -la"')).toBe(false);

    expect(matchesDeclaredType("alias", 'alias ll="ls -la"')).toBe(true);
    expect(matchesDeclaredType("alias", 'alias -g G="| grep"')).toBe(true);
    expect(matchesDeclaredType("alias", 'export FOO="bar"')).toBe(false);

    // 跳过开头的空行/注释行再判断
    expect(matchesDeclaredType("export", '# sets home dir\n\nexport JAVA_HOME="/opt/java"')).toBe(true);

    // 内容为空或只有注释,不判定(避免用户还没写完就被提示)
    expect(matchesDeclaredType("export", "")).toBe(true);
    expect(matchesDeclaredType("export", "# just a comment")).toBe(true);

    // snippet 类型完全不限制
    expect(matchesDeclaredType("snippet", "ls -la")).toBe(true);
  });

  it("moveShellSnippet 调整生成顺序", () => {
    let cfg = createEmptyShellConfig();
    const ids: string[] = [];
    for (const name of ["A", "B", "C"]) {
      const r = addShellSnippet(cfg, { name, type: "export", content: `export ${name}=1`, enabled: true });
      cfg = r.config;
      ids.push(r.snippet.id);
    }
    const names = (c: typeof cfg) => c.snippets.map((s) => s.name);
    expect(names(cfg)).toEqual(["A", "B", "C"]);

    // 下移中间一条
    expect(names(moveShellSnippet(cfg, ids[1]!, "down"))).toEqual(["A", "C", "B"]);
    // 上移最后一条
    expect(names(moveShellSnippet(cfg, ids[2]!, "up"))).toEqual(["A", "C", "B"]);

    // 已经在边界:原样返回,不报错也不越界
    expect(names(moveShellSnippet(cfg, ids[0]!, "up"))).toEqual(["A", "B", "C"]);
    expect(names(moveShellSnippet(cfg, ids[2]!, "down"))).toEqual(["A", "B", "C"]);

    // id 不存在也原样返回
    expect(names(moveShellSnippet(cfg, "nope", "up"))).toEqual(["A", "B", "C"]);

    // 不改动原对象(纯函数)
    expect(names(cfg)).toEqual(["A", "B", "C"]);

    // 顺序真的会反映到生成的脚本里
    const moved = moveShellSnippet(cfg, ids[0]!, "down");
    const script = generateShellScript(moved.snippets);
    expect(script.indexOf("export B=1")).toBeLessThan(script.indexOf("export A=1"));
  });

  it("parseShellConfig & formatShellConfig", () => {
    const raw = "";
    expect(parseShellConfig(raw)).toEqual({ version: 1, snippets: [] });

    // 坏文件必须抛错:静默返回空的话,保存时会连带重新生成 shell.sh,
    // 等于把用户的全局环境变量和 alias 一起清空
    expect(() => parseShellConfig("{ oops")).toThrow(ConfigFileError);
    expect(() => parseShellConfig(JSON.stringify({ version: 99, snippets: [] }))).toThrow(ConfigFileError);
    expect(parseShellConfig(JSON.stringify({ snippets: [] }))).toEqual({ version: 1, snippets: [] });

    const c = createEmptyShellConfig();
    const formatted = formatShellConfig(c);
    expect(parseShellConfig(formatted)).toEqual(c);
  });
});
