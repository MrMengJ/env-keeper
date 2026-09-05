import { describe, expect, it } from "vitest";
import { type EnvLine, parseEnv } from "./parseEnv.js";
import {
  addEnvVariable,
  computeFingerprint,
  diffEnvVariables,
  generateExampleEnv,
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
});
