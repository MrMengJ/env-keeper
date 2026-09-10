import { describe, expect, it } from "vitest";
import { ConfigFileError } from "./configFile.js";
import {
  addPreset,
  clearPresetApplied,
  createEmptyPresetsFile,
  detectPresetDrift,
  findMatchingPreset,
  formatPresetsFile,
  getAppliedPreset,
  groupPresets,
  listPresetGroups,
  listPresetsForProject,
  parsePresetsFile,
  recordPresetApplied,
  removePreset,
  removePresetsForProject,
  restorePreset,
  restoreProjectPresets,
  updatePreset,
} from "./presets.js";

const NOW = new Date("2026-09-09T10:00:00.000Z");

describe("presets", () => {
  it("add / update / remove", () => {
    const { file: f1, preset } = addPreset(
      createEmptyPresetsFile(),
      { projectId: "p1", name: "  客户-老王 ", content: "A=1\n", note: "  ", group: " 客户 " },
      NOW
    );
    expect(preset.name).toBe("客户-老王");
    expect(preset.note).toBeUndefined();
    expect(preset.group).toBe("客户");
    expect(preset.createdAt).toBe(NOW.toISOString());

    const later = new Date("2026-09-10T00:00:00.000Z");
    const f2 = updatePreset(f1, preset.id, { note: "老王的测试环境", group: "" }, later);
    expect(f2.presets[0]?.note).toBe("老王的测试环境");
    expect(f2.presets[0]?.group).toBeUndefined();
    expect(f2.presets[0]?.updatedAt).toBe(later.toISOString());
    expect(f2.presets[0]?.createdAt).toBe(NOW.toISOString());

    // 没提到的字段不动
    const f3 = updatePreset(f2, preset.id, { content: "A=2\n" });
    expect(f3.presets[0]?.note).toBe("老王的测试环境");
    expect(f3.presets[0]?.content).toBe("A=2\n");

    expect(removePreset(f3, preset.id).presets).toHaveLength(0);
  });

  it("removing a preset clears applied state pointing to it", () => {
    const { file: f1, preset } = addPreset(createEmptyPresetsFile(), { projectId: "p1", name: "a", content: "" });
    const f2 = recordPresetApplied(f1, "p1", ".env", preset.id, NOW);
    expect(getAppliedPreset(f2, "p1", ".env")?.id).toBe(preset.id);

    const f3 = removePreset(f2, preset.id);
    expect(getAppliedPreset(f3, "p1", ".env")).toBeUndefined();
    expect(Object.keys(f3.appliedState)).toHaveLength(0);
  });

  it("removing a project drops its presets and applied state, keeps others", () => {
    let file = createEmptyPresetsFile();
    const a = addPreset(file, { projectId: "p1", name: "a", content: "" });
    file = a.file;
    const b = addPreset(file, { projectId: "p2", name: "b", content: "" });
    file = b.file;
    file = recordPresetApplied(file, "p1", ".env", a.preset.id);
    file = recordPresetApplied(file, "p2", ".env", b.preset.id);

    const cleaned = removePresetsForProject(file, "p1");
    expect(listPresetsForProject(cleaned, "p1")).toHaveLength(0);
    expect(listPresetsForProject(cleaned, "p2")).toHaveLength(1);
    expect(getAppliedPreset(cleaned, "p2", ".env")?.id).toBe(b.preset.id);
    expect(getAppliedPreset(cleaned, "p1", ".env")).toBeUndefined();
  });

  it("groups: sorted by name, ungrouped last, distinct group list", () => {
    let file = createEmptyPresetsFile();
    for (const [name, group] of [
      ["z-临时", undefined],
      ["客户-小李", "客户"],
      ["测试-免费额度", "测试"],
      ["客户-老王", "客户"],
      ["a-临时", undefined],
    ] as const) {
      file = addPreset(file, { projectId: "p1", name, content: "", group }).file;
    }
    // 别的项目的分组不该混进来
    file = addPreset(file, { projectId: "p2", name: "x", content: "", group: "别家" }).file;

    expect(listPresetGroups(file, "p1")).toEqual(["客户", "测试"]);

    const buckets = groupPresets(listPresetsForProject(file, "p1"));
    expect(buckets.map((b) => b.group)).toEqual(["客户", "测试", undefined]);
    expect(buckets[0]?.presets.map((p) => p.name)).toEqual(["客户-小李", "客户-老王"]);
    expect(buckets[2]?.presets.map((p) => p.name)).toEqual(["a-临时", "z-临时"]);
  });

  it("matching and drift", () => {
    const { file: f1, preset } = addPreset(createEmptyPresetsFile(), {
      projectId: "p1",
      name: "a",
      content: "A=1\n",
    });
    expect(findMatchingPreset(f1.presets, "A=1\n")?.id).toBe(preset.id);
    expect(findMatchingPreset(f1.presets, "A=1")).toBeUndefined();

    // 没套用过 → 谈不上漂移
    expect(detectPresetDrift(f1, "p1", ".env", "A=2\n")).toBeUndefined();

    const f2 = recordPresetApplied(f1, "p1", ".env", preset.id);
    expect(detectPresetDrift(f2, "p1", ".env", "A=1\n")).toBeUndefined();
    expect(detectPresetDrift(f2, "p1", ".env", "A=2\n")?.id).toBe(preset.id);

    // 方案自己改了也算漂移:用户在意的是"两边对不上了"
    const f3 = updatePreset(f2, preset.id, { content: "A=3\n" });
    expect(detectPresetDrift(f3, "p1", ".env", "A=1\n")?.id).toBe(preset.id);

    const f4 = clearPresetApplied(f3, "p1", ".env");
    expect(detectPresetDrift(f4, "p1", ".env", "A=1\n")).toBeUndefined();
    // 清一个不存在的 key 不该产生新对象以外的副作用
    expect(clearPresetApplied(f4, "p1", ".env.other")).toBe(f4);
  });

  it("parse / format round-trip and error handling", () => {
    let file = createEmptyPresetsFile();
    const { file: f1, preset } = addPreset(file, { projectId: "p1", name: "a", content: "K=v\n", group: "g" }, NOW);
    file = recordPresetApplied(f1, "p1", ".env", preset.id, NOW);

    const text = formatPresetsFile(file);
    const parsed = parsePresetsFile(text);
    expect(parsed).toEqual(file);

    expect(parsePresetsFile("")).toEqual(createEmptyPresetsFile());
    expect(parsePresetsFile("{}")).toEqual(createEmptyPresetsFile());
    // appliedState 写成了数组这种坏形态,按空处理而不是崩
    expect(parsePresetsFile('{"version":1,"presets":[],"appliedState":[]}').appliedState).toEqual({});

    expect(() => parsePresetsFile("{ bad json")).toThrow(ConfigFileError);
    expect(() => parsePresetsFile('{"version": 99}')).toThrow(ConfigFileError);
  });
});

describe("restorePreset", () => {
  it("overwrites an existing preset in place and re-adds a deleted one with its original id", () => {
    const { file: f1, preset } = addPreset(createEmptyPresetsFile(), { projectId: "p1", name: "a", content: "A=1\n" }, NOW);
    const other = addPreset(f1, { projectId: "p1", name: "b", content: "B=1\n" }, NOW);
    const changed = updatePreset(other.file, preset.id, { name: "a2", content: "A=2\n" });

    const later = new Date("2026-09-11T00:00:00.000Z");
    const back = restorePreset(changed, preset, later);
    expect(back.presets.map((p) => p.name)).toEqual(["a", "b"]);
    expect(back.presets[0]?.content).toBe("A=1\n");
    expect(back.presets[0]?.updatedAt).toBe(later.toISOString());
    // 别的方案不动
    expect(back.presets[1]).toEqual(other.preset);

    const deleted = removePreset(changed, preset.id);
    const readded = restorePreset(deleted, preset, later);
    expect(readded.presets.map((p) => p.id)).toEqual([other.preset.id, preset.id]);
  });
});

describe("restoreProjectPresets", () => {
  it("swaps only the given project's presets and applied state", () => {
    let old = createEmptyPresetsFile();
    const a1 = addPreset(old, { projectId: "p1", name: "a1", content: "A=1\n" }, NOW);
    old = a1.file;
    const b1 = addPreset(old, { projectId: "p2", name: "b1", content: "B=1\n" }, NOW);
    old = b1.file;
    old = recordPresetApplied(old, "p1", ".env", a1.preset.id, NOW);
    old = recordPresetApplied(old, "p2", ".env", b1.preset.id, NOW);

    // 之后:p1 删了 a1 加了 a2,p2 加了 b2
    let cur = removePreset(old, a1.preset.id);
    const a2 = addPreset(cur, { projectId: "p1", name: "a2", content: "A=2\n" }, NOW);
    cur = a2.file;
    const b2 = addPreset(cur, { projectId: "p2", name: "b2", content: "B=2\n" }, NOW);
    cur = b2.file;

    const restored = restoreProjectPresets(cur, old, "p1");
    expect(listPresetsForProject(restored, "p1").map((p) => p.name)).toEqual(["a1"]);
    // p2 保持"现在"的样子,不受影响
    expect(listPresetsForProject(restored, "p2").map((p) => p.name)).toEqual(["b1", "b2"]);
    expect(getAppliedPreset(restored, "p1", ".env")?.id).toBe(a1.preset.id);
    expect(getAppliedPreset(restored, "p2", ".env")?.id).toBe(b1.preset.id);
  });
});
