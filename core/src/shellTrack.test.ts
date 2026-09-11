import { describe, expect, it } from "vitest";
import {
  addShellSnippet,
  createEmptyShellConfig,
  formatShellConfig,
  diffShellSnippets,
  extractShellAssignments,
  findShellConflicts,
  generateShellScript,
  groupShellSnippets,
  listShellGroups,
  renameShellGroup,
  setShellGroupEnabled,
  moveShellSnippet,
  maskShellContent,
  matchesDeclaredType,
  parseShellConfig,
  removeShellSnippet,
  toggleShellSnippet,
  updateShellSnippet,
  type ShellSnippet,
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

  it("diffShellSnippets 按 id 比对", () => {
    const mk = (id: string, name: string, content: string, enabled = true): ShellSnippet => ({
      id,
      name,
      type: "export",
      content,
      enabled,
    });
    const before = [mk("a", "A", "export A=1"), mk("b", "B", "export B=1"), mk("c", "C", "export C=1")];
    const after = [
      mk("a", "A", "export A=1"), // 没变
      mk("b", "B2", "export B=1"), // 只改了名字
      mk("d", "D", "export D=1"), // 新增;c 被删了
    ];

    const diff = diffShellSnippets(before, after);
    const byId = Object.fromEntries(diff.map((d) => [d.id, d]));

    expect(byId.a?.type).toBe("unchanged");
    expect(byId.d?.type).toBe("added");
    expect(byId.c?.type).toBe("removed");
    expect(byId.c?.name).toBe("C"); // 删掉的用旧名展示

    // 只改名字要识别成 changed,而不是一删一增
    expect(byId.b?.type).toBe("changed");
    expect(byId.b?.previousName).toBe("B");
    expect(byId.b?.name).toBe("B2");

    // 只切换启用状态也算改动
    const toggled = diffShellSnippets([mk("a", "A", "export A=1", true)], [mk("a", "A", "export A=1", false)]);
    expect(toggled[0]?.type).toBe("changed");

    // added 排在 removed 前面,removed 排在 changed 前面
    expect(diff.map((d) => d.type)).toEqual(["added", "removed", "changed", "unchanged"]);
  });

  it("maskShellContent 只遮敏感行,认不出的原样保留", () => {
    const src = [
      "# 我的配置",
      'export JAVA_HOME="/opt/jdk"',
      'export API_KEY="sk-real-secret"',
      "DB_PASSWORD=hunter2",
      "alias ll='ls -la'",
      "some_random_command --flag",
    ].join("\n");

    const masked = maskShellContent(src);
    // 命中关键词的值被遮住
    expect(masked).toContain("export API_KEY=••••••••");
    expect(masked).toContain("DB_PASSWORD=••••••••");
    expect(masked).not.toContain("sk-real-secret");
    expect(masked).not.toContain("hunter2");
    // 不敏感的、注释、认不出的行原样保留
    expect(masked).toContain('export JAVA_HOME="/opt/jdk"');
    expect(masked).toContain("# 我的配置");
    expect(masked).toContain("alias ll='ls -la'");
    expect(masked).toContain("some_random_command --flag");
  });

  it("maskShellContent 支持自定义敏感词与整段遮蔽", () => {
    const src = "export MY_THING=abc\nexport OTHER=def";
    expect(maskShellContent(src, { customSecrets: ["MY_THING"] })).toContain("export MY_THING=••••••••");
    expect(maskShellContent(src, { customSecrets: ["MY_THING"] })).toContain("export OTHER=def");

    // 整段标记敏感时,连认不出的行也遮住,但注释和空行保留(否则完全看不出结构)
    const all = maskShellContent("# 说明\n\nsome_command --token abc\nexport A=1", { maskAll: true });
    expect(all).toContain("# 说明");
    expect(all).not.toContain("some_command");
    expect(all).toContain("export A=••••••••");
  });

  it("分组:字段裁剪、分桶按首次出现顺序、整组改名 / 解散 / 启停", () => {
    const mk = (id: string, group: string | undefined, enabled = true): Omit<ShellSnippet, "id"> & { id: string } => ({
      id,
      name: id,
      type: "snippet",
      content: `echo ${id}`,
      enabled,
      group,
    });
    let config = createEmptyShellConfig();
    // 生成顺序:a(Java) b(代理) c(Java) d(无) e(代理,已禁用)
    for (const snip of [mk("a", " Java "), mk("b", "代理"), mk("c", "Java"), mk("d", undefined), mk("e", "代理", false)]) {
      config = addShellSnippet(config, snip).config;
    }
    expect(config.snippets[0]?.group).toBe("Java");
    expect(listShellGroups(config)).toEqual(["Java", "代理"]);

    const buckets = groupShellSnippets(config.snippets);
    expect(buckets.map((b) => b.group)).toEqual(["Java", "代理", undefined]);
    expect(buckets[0]?.snippets.map((s) => s.name)).toEqual(["a", "c"]);
    expect(buckets[1]?.snippets.map((s) => s.name)).toEqual(["b", "e"]);

    // 更新时空串 = 取消分组
    const ungroupedA = updateShellSnippet(config, config.snippets[0]!.id, { group: "  " });
    expect(ungroupedA.snippets[0]?.group).toBeUndefined();
    // 没提 group 就不动
    expect(updateShellSnippet(config, config.snippets[0]!.id, { enabled: false }).snippets[0]?.group).toBe("Java");

    const renamed = renameShellGroup(config, "Java", "JDK");
    expect(listShellGroups(renamed)).toEqual(["JDK", "代理"]);
    // 合并进已有的组
    expect(listShellGroups(renameShellGroup(config, "Java", "代理"))).toEqual(["代理"]);
    // 解散
    expect(listShellGroups(renameShellGroup(config, "Java", ""))).toEqual(["代理"]);
    expect(renameShellGroup(config, "Java", "Java")).toBe(config);

    const allOff = setShellGroupEnabled(config, "代理", false);
    expect(allOff.snippets.map((s) => s.enabled)).toEqual([true, false, true, true, false]);
    const allOn = setShellGroupEnabled(config, "代理", true);
    expect(allOn.snippets.map((s) => s.enabled)).toEqual([true, true, true, true, true]);

    // 生成文件的注释头带组名;分组不影响顺序
    const script = generateShellScript(config.snippets);
    expect(script).toContain("# [SNIPPET] a (Java)");
    expect(script.indexOf("echo a")).toBeLessThan(script.indexOf("echo b"));
  });

  it("findShellConflicts 找出两个已启用片段设置同一个变量 / alias,后者生效", () => {
    const mk = (id: string, content: string, enabled = true): ShellSnippet => ({
      id,
      name: `片段${id}`,
      type: "snippet",
      content,
      enabled,
    });
    const snippets = [
      mk("a", 'export JAVA_HOME="/opt/jdk8"\nexport PATH="$JAVA_HOME/bin:$PATH"'),
      mk("b", 'export JAVA_HOME="/opt/jdk17"\nexport PATH="${PATH}:/x"'),
      mk("c", "export JAVA_HOME=/opt/jdk21", false),
      mk("d", "alias ll='ls -la'\nalias gs='git status'"),
      mk("e", "alias ll='eza -l'"),
      // 同一片段内重复不算
      mk("f", "X=1\nX=2"),
    ];

    const conflicts = findShellConflicts(snippets);
    expect(conflicts).toEqual([
      {
        kind: "variable",
        name: "JAVA_HOME",
        snippets: [
          { id: "a", name: "片段a" },
          { id: "b", name: "片段b" },
        ],
        effectiveId: "b",
      },
      {
        kind: "alias",
        name: "ll",
        snippets: [
          { id: "d", name: "片段d" },
          { id: "e", name: "片段e" },
        ],
        effectiveId: "e",
      },
    ]);
    // PATH 两边都是追加,不在冲突里
    expect(conflicts.some((c) => c.name === "PATH")).toBe(false);
  });

  it("extractShellAssignments 抽出片段里的变量", () => {
    const content = [
      "# 注释里的 IGNORED=1 不算",
      'export JAVA_HOME="/opt/jdk"',
      "PLAIN=abc",
      "alias ll='ls -la'",
      "some_cmd --token=xyz",
      "",
    ].join("\n");

    expect(extractShellAssignments(content)).toEqual([
      { key: "JAVA_HOME", value: "/opt/jdk" },
      { key: "PLAIN", value: "abc" },
    ]);
  });
});
