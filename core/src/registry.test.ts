import { describe, expect, it } from "vitest";
import {
  addProject,
  createEmptyRegistry,
  formatRegistry,
  parseRegistry,
  removeProject,
  setEnvrcNoticeDismissed,
  sortProjectsByRecent,
  toggleProjectSecret,
  touchProject,
} from "./registry.js";
import { ConfigFileError } from "./configFile.js";

describe("registry", () => {
  it("parseRegistry & formatRegistry: 空内容当新装,坏内容必须抛错", () => {
    // 空文件 = 全新安装,不是异常
    expect(parseRegistry("")).toEqual({ version: 1, projects: [] });

    // 坏文件绝不能静默当成空:那样用户看到空列表 → 重新添加 → 保存,
    // 就把还留着原始数据的坏文件覆盖没了
    expect(() => parseRegistry("{ invalid json")).toThrow(ConfigFileError);
    expect(() => parseRegistry("[1,2,3]")).toThrow(ConfigFileError);

    // 来自更新版本的扩展(用户降级)也要拦住,否则不认识的新字段会被写没
    try {
      parseRegistry(JSON.stringify({ version: 99, projects: [] }));
      throw new Error("应该抛错");
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigFileError);
      expect((e as ConfigFileError).reason).toBe("tooNew");
      expect((e as ConfigFileError).fileVersion).toBe(99);
    }

    // 缺 version 字段的早期文件按 v1 放行,不算损坏
    expect(parseRegistry(JSON.stringify({ projects: [] }))).toEqual({ version: 1, projects: [] });

    const initial = createEmptyRegistry();
    const formatted = formatRegistry(initial);
    expect(parseRegistry(formatted)).toEqual(initial);
  });

  it("addProject: adds new project and handles duplicate path gracefully", () => {
    const reg = createEmptyRegistry();
    const { registry: r1, project: p1 } = addProject(reg, {
      name: "My App",
      path: "/Users/dev/my-app",
    });

    expect(r1.projects).toHaveLength(1);
    expect(p1.name).toBe("My App");

    // add duplicate path updates name & touches time
    const { registry: r2, project: p2 } = addProject(
      r1,
      {
        name: "Renamed App",
        path: "/Users/dev/my-app",
      },
      999999
    );

    expect(r2.projects).toHaveLength(1);
    expect(p2.name).toBe("Renamed App");
    expect(p2.lastOpenedAt).toBe(999999);
  });

  it("removeProject & touchProject", () => {
    const reg = createEmptyRegistry();
    const { registry: r1, project: p1 } = addProject(reg, {
      name: "App 1",
      path: "/path/1",
    });

    const touched = touchProject(r1, p1.id, 12345678);
    expect(touched.projects[0]?.lastOpenedAt).toBe(12345678);

    const removed = removeProject(touched, p1.id);
    expect(removed.projects).toHaveLength(0);
  });

  it("toggleProjectSecret: toggles custom secret in project", () => {
    const reg = createEmptyRegistry();
    const { registry: r1, project: p1 } = addProject(reg, {
      name: "App",
      path: "/path",
    });

    const added = toggleProjectSecret(r1, p1.id, "MY_CUSTOM_SECRET");
    expect(added.projects[0]?.customSecrets).toContain("MY_CUSTOM_SECRET");

    const removed = toggleProjectSecret(added, p1.id, "my_custom_secret");
    expect(removed.projects[0]?.customSecrets).toHaveLength(0);
  });

  it("setEnvrcNoticeDismissed: toggles the per-project .envrc notice flag", () => {
    const reg = createEmptyRegistry();
    const { registry: r1, project: p1 } = addProject(reg, {
      name: "App",
      path: "/path",
    });
    expect(r1.projects[0]?.dismissedEnvrcNotice).toBeUndefined();

    const dismissed = setEnvrcNoticeDismissed(r1, p1.id, true);
    expect(dismissed.projects[0]?.dismissedEnvrcNotice).toBe(true);

    const restored = setEnvrcNoticeDismissed(dismissed, p1.id, false);
    expect(restored.projects[0]?.dismissedEnvrcNotice).toBe(false);
  });

  it("sortProjectsByRecent: sorts descending by lastOpenedAt", () => {
    const reg = {
      version: 1 as const,
      projects: [
        { id: "1", name: "Old", path: "/1", lastOpenedAt: 100 },
        { id: "2", name: "New", path: "/2", lastOpenedAt: 500 },
        { id: "3", name: "Mid", path: "/3", lastOpenedAt: 300 },
      ],
    };
    const sorted = sortProjectsByRecent(reg);
    expect(sorted.map((p) => p.id)).toEqual(["2", "3", "1"]);
  });
});
