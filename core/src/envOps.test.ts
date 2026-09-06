import { describe, expect, it } from "vitest";
import { type EnvLine, parseEnv, serializeEnv } from "./parseEnv.js";
import {
  addEnvVariable,
  computeFingerprint,
  diffEnvVariables,
  generateExampleEnv,
  mergeExampleEnv,
  isEncryptedValue,
  isSecretKey,
  isValidEnvFilename,
  maskSecret,
  removeEnvVariable,
  toggleEnvVariable,
  updateEnvVariable,
} from "./envOps.js";

describe("envOps", () => {
  it("updateEnvVariable: updates value while keeping comments and quote", () => {
    const raw = '# comment\nPORT="3000"\nHOST=localhost\n';
    const lines = parseEnv(raw);
    const updated = updateEnvVariable(lines, "PORT", "8080");

    const portLine = updated.find(
      (l): l is Extract<EnvLine, { type: "kv" }> => l.type === "kv" && l.key === "PORT"
    );
    expect(portLine?.value).toBe("8080");
    const rawOutput = updated.map((l) => l.raw).join("");
    expect(rawOutput).toBe('# comment\nPORT="8080"\nHOST=localhost\n');
  });

  it("addEnvVariable: appends new variable or updates existing", () => {
    const raw = "PORT=3000\n";
    const lines = parseEnv(raw);

    const added = addEnvVariable(lines, "API_KEY", "secret123", { quote: '"' });
    expect(added.map((l) => l.raw).join("")).toBe('PORT=3000\nAPI_KEY="secret123"\n');

    // add existing
    const updated = addEnvVariable(added, "PORT", "4000");
    expect(updated.map((l) => l.raw).join("")).toBe('PORT=4000\nAPI_KEY="secret123"\n');
  });

  it("removeEnvVariable: removes line cleanly", () => {
    const raw = "FOO=bar\nBAZ=qux\n";
    const lines = parseEnv(raw);
    const removed = removeEnvVariable(lines, "FOO");
    expect(removed.map((l) => l.raw).join("")).toBe("BAZ=qux\n");
  });

  it("toggleEnvVariable: switches between enabled and commented", () => {
    const raw = "PORT=3000\n";
    const lines = parseEnv(raw);

    const disabled = toggleEnvVariable(lines, "PORT");
    const firstDisabled = disabled[0];
    expect(firstDisabled && firstDisabled.type === "kv" && firstDisabled.disabled).toBe(true);
    expect(disabled.map((l) => l.raw).join("")).toBe("# PORT=3000\n");

    const reEnabled = toggleEnvVariable(disabled, "PORT");
    const firstEnabled = reEnabled[0];
    expect(firstEnabled && firstEnabled.type === "kv" && firstEnabled.disabled).toBe(false);
    expect(reEnabled.map((l) => l.raw).join("")).toBe("PORT=3000\n");
  });

  it("generateExampleEnv: empties values and preserves comments/structure", () => {
    const raw = "# App Config\nPORT=3000\n\n# Secret\nAPI_KEY=\"super_secret\"\n";
    const lines = parseEnv(raw);
    const example = generateExampleEnv(lines);
    expect(example).toBe("# App Config\nPORT=\n\n# Secret\nAPI_KEY=\n");
  });

  it("isSecretKey & maskSecret: identifies sensitive keywords or custom list", () => {
    expect(isSecretKey("MY_API_KEY")).toBe(true);
    expect(isSecretKey("GITHUB_TOKEN")).toBe(true);
    expect(isSecretKey("DB_PASSWORD")).toBe(true);
    expect(isSecretKey("REDIS_PASSWD")).toBe(true);
    expect(isSecretKey("CLIENT_SECRET")).toBe(true);
    expect(isSecretKey("AWS_CREDENTIALS")).toBe(true);
    expect(isSecretKey("PORT")).toBe(false);

    // custom list
    expect(isSecretKey("CUSTOM_VAR", ["CUSTOM_VAR"])).toBe(true);
    expect(maskSecret("any_value")).toBe("••••••••");
  });

  it("isEncryptedValue: recognizes dotenvx prefix", () => {
    expect(isEncryptedValue("encrypted:xyz123==")).toBe(true);
    expect(isEncryptedValue("normal_value")).toBe(false);
  });

  it("computeFingerprint: deterministic sha256 hash", () => {
    const h1 = computeFingerprint("FOO=BAR\n");
    const h2 = computeFingerprint("FOO=BAR\n");
    const h3 = computeFingerprint("FOO=BAZ\n");
    expect(h1).toBe(h2);
    expect(h1).not.toBe(h3);
  });

  it("diffEnvVariables: classifies added/removed/changed/unchanged and sorts by significance", () => {
    const base = parseEnv("PORT=3000\nHOST=localhost\nOLD_ONLY=bye\n");
    const target = parseEnv("PORT=4000\nHOST=localhost\nNEW_ONLY=hi\n");
    const diff = diffEnvVariables(base, target);

    expect(diff).toEqual([
      { key: "NEW_ONLY", type: "added", targetValue: "hi" },
      { key: "OLD_ONLY", type: "removed", baseValue: "bye" },
      { key: "PORT", type: "changed", baseValue: "3000", targetValue: "4000" },
      { key: "HOST", type: "unchanged", baseValue: "localhost", targetValue: "localhost" },
    ]);
  });

  it("isValidEnvFilename: accepts .env and .env.<suffix>, rejects unsafe/unrelated names", () => {
    expect(isValidEnvFilename(".env")).toBe(true);
    expect(isValidEnvFilename(".env.development")).toBe(true);
    expect(isValidEnvFilename(".env.feature_kuangzhen")).toBe(true);
    expect(isValidEnvFilename("env")).toBe(false);
    expect(isValidEnvFilename(".envrc")).toBe(false);
    expect(isValidEnvFilename(".env.../etc")).toBe(false);
    expect(isValidEnvFilename(".env ")).toBe(true); // 前后空白会被 trim
  });

  it("行内注释:编辑值时注释保持不变", () => {
    const lines = parseEnv("API_URL=http://old.com # 生产环境\n");
    const updated = updateEnvVariable(lines, "API_URL", "http://new.com");
    expect(serializeEnv(updated)).toBe("API_URL=http://new.com # 生产环境\n");
  });

  it("行内注释:可以改写,也可以传空串删掉", () => {
    const lines = parseEnv("API_URL=http://a.com # 旧说明\n");
    expect(serializeEnv(updateEnvVariable(lines, "API_URL", "http://a.com", { comment: "新说明" }))).toBe(
      "API_URL=http://a.com # 新说明\n"
    );
    expect(serializeEnv(updateEnvVariable(lines, "API_URL", "http://a.com", { comment: "" }))).toBe(
      "API_URL=http://a.com\n"
    );
  });

  it("行内注释:加引号不会把注释吞进值里", () => {
    const lines = parseEnv("API_URL=http://a.com # 生产环境\n");
    const quoted = updateEnvVariable(lines, "API_URL", "http://a.com", { quote: '"' });
    // 注释留在引号外面,dotenv 读到的值仍然是干净的
    expect(serializeEnv(quoted)).toBe('API_URL="http://a.com" # 生产环境\n');
  });

  it("行内注释:启用/禁用切换不丢注释", () => {
    const lines = parseEnv("PORT=3000 # 服务端口\n");
    const off = toggleEnvVariable(lines, "PORT");
    expect(serializeEnv(off)).toBe("# PORT=3000 # 服务端口\n");
    expect(serializeEnv(toggleEnvVariable(off, "PORT"))).toBe("PORT=3000 # 服务端口\n");
  });

  it("行内注释:新增变量可以带注释", () => {
    const added = addEnvVariable(parseEnv(""), "NEW_KEY", "v", { comment: "说明" });
    expect(serializeEnv(added)).toBe("NEW_KEY=v # 说明\n");
  });

  it("生成 .env.example 时清空值但保留行内注释", () => {
    const lines = parseEnv("# 数据库\nDB_URL=postgres://real/secret # 找运维要\nPORT=3000\n");
    expect(generateExampleEnv(lines)).toBe("# 数据库\nDB_URL= # 找运维要\nPORT=\n");
  });

  it("mergeExampleEnv 保住模板里手写的说明", () => {
    const example = parseEnv(
      ["# 去 Stripe 后台 → Developers → API keys 复制", "STRIPE_KEY=", "", "# 本地随便填", "PORT=3000", ""].join("\n"),
    );
    const env = parseEnv(["STRIPE_KEY=sk_live_real", "PORT=8080", "NEW_ONE=abc # 新加的"].join("\n"));

    const r = mergeExampleEnv(example, env);
    // 手写注释、手填的占位值都原样留着,不会被 .env 的真实值冲掉
    expect(r.content).toContain("# 去 Stripe 后台 → Developers → API keys 复制");
    expect(r.content).toContain("# 本地随便填");
    expect(r.content).toContain("PORT=3000");
    expect(r.content).not.toContain("sk_live_real");
    expect(r.content).not.toContain("8080");
    // 新键追加到末尾,带上行内注释
    expect(r.content).toContain("NEW_ONE= # 新加的");
    expect(r.added).toEqual(["NEW_ONE"]);
    expect(r.kept.sort()).toEqual(["PORT", "STRIPE_KEY"]);
    expect(r.removed).toEqual([]);
  });

  it("mergeExampleEnv 移除 .env 里已经没有的键", () => {
    const example = parseEnv("A=\n# 关于 B 的说明\nB=\nC=\n");
    const env = parseEnv("A=1\nC=3\n");
    const r = mergeExampleEnv(example, env);
    expect(r.removed).toEqual(["B"]);
    expect(r.content).toContain("A=");
    expect(r.content).toContain("C=");
    expect(r.content).not.toContain("B=");
    // 键没了,但它上面那段独立注释还在——不敢替用户判断注释是不是只属于这个键
    expect(r.content).toContain("# 关于 B 的说明");
  });

  it("mergeExampleEnv 模板为空时等价于重新生成,且反复合并结果稳定", () => {
    const env = parseEnv("A=1 # 说明\nB=2\n");
    const first = mergeExampleEnv(parseEnv(""), env);
    expect(first.content).toBe(generateExampleEnv(env));

    // 幂等:再合并一次不该有任何变化
    const second = mergeExampleEnv(parseEnv(first.content), env);
    expect(second.content).toBe(first.content);
    expect(second.added).toEqual([]);
    expect(second.removed).toEqual([]);
  });
});
