/**
 * registry.json / shell.json 这类"扩展私有配置文件"的公共读取逻辑。
 *
 * 为什么单独抽出来:这两个文件原先在 JSON 解析失败时都是 `catch { 返回空配置 }`,
 * 上层拿到的东西和"用户从来没配过"完全一样,分不出是"真没有"还是"读坏了"。
 * 后果是用户看到空列表 → 重新添加 → 保存 → 把还留着原始数据的坏文件覆盖掉,
 * 数据就真的没了。所以这里改成**明确抛错**,由调用方负责隔离原文件并告知用户。
 */

/** 读取失败的原因,决定界面怎么说、文件怎么隔离 */
export type ConfigFailureReason =
  /** JSON 语法坏了,或者根本不是一个对象 */
  | "malformed"
  /** 文件来自更新版本的扩展(用户降级了),当旧版处理会把不认识的新字段写没 */
  | "tooNew";

export class ConfigFileError extends Error {
  readonly reason: ConfigFailureReason;
  /** 文件里声明的版本号,仅 tooNew 时有意义 */
  readonly fileVersion?: number;

  constructor(reason: ConfigFailureReason, message: string, fileVersion?: number) {
    super(message);
    this.name = "ConfigFileError";
    this.reason = reason;
    this.fileVersion = fileVersion;
  }
}

/**
 * 解析带 version 字段的配置文件的公共前半段。
 *
 * - 内容为空 → 返回 null,调用方给一份空配置(全新安装就是这个情况,不算异常)
 * - JSON 坏掉 / 顶层不是对象 → 抛 malformed
 * - version 比当前新 → 抛 tooNew
 * - version 缺失或比当前旧 → 放行,把 version 一并返回,调用方决定要不要迁移
 */
export function parseVersionedConfig(
  jsonStr: string,
  currentVersion: number
): { data: Record<string, unknown>; version: number } | null {
  if (!jsonStr || jsonStr.trim() === "") return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    throw new ConfigFileError("malformed", e instanceof Error ? e.message : String(e));
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ConfigFileError("malformed", "配置文件的顶层不是一个 JSON 对象");
  }

  const data = parsed as Record<string, unknown>;
  // version 缺失时按 1 处理:早期文件可能没写这个字段,不该因此判定为损坏
  const rawVersion = data.version;
  const version = typeof rawVersion === "number" && Number.isFinite(rawVersion) ? rawVersion : 1;

  if (version > currentVersion) {
    throw new ConfigFileError(
      "tooNew",
      `配置文件版本 ${version} 高于当前扩展支持的 ${currentVersion}`,
      version
    );
  }

  return { data, version };
}
