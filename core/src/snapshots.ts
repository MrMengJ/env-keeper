/**
 * 快照命名与管理辅助纯函数
 * 命名规范: YYYY-MM-DD-HHmmss.<envFilename> (例如 2026-09-01-183430.env.development)
 */

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

export function formatSnapshotTimestamp(date = new Date()): string {
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const h = pad(date.getHours());
  const min = pad(date.getMinutes());
  const s = pad(date.getSeconds());
  return `${y}-${m}-${d}-${h}${min}${s}`;
}

export function generateSnapshotFilename(envFilename: string, date = new Date()): string {
  const cleanEnvName = envFilename.split("/").filter(Boolean).pop() || ".env";
  // envFilename 本身就以 "." 开头(.env / .env.development),再补一个点会得到 "时间戳..env" 这种双点文件名,
  // 这里统一成单个点分隔
  const normalized = cleanEnvName.startsWith(".") ? cleanEnvName : `.${cleanEnvName}`;
  return `${formatSnapshotTimestamp(date)}${normalized}`;
}

export function parseSnapshotFilename(filename: string): {
  timestampStr: string;
  envFilename: string;
} | null {
  // 时间戳只精确到秒,同一秒内连续保存会撞名,所以允许中间插一个 -2 / -3 的序号
  const match = /^(\d{4}-\d{2}-\d{2}-\d{6})(?:-\d+)?\.(.+)$/.exec(filename);
  if (!match) return null;
  const timestampStr = match[1];
  const rawEnvName = match[2];
  if (!timestampStr || !rawEnvName) return null;
  // 兼容两种文件名:新的单点 "时间戳.env" 解析出 "env",旧的双点 "时间戳..env" 解析出 ".env",
  // 统一补成以 "." 开头的环境文件名,老快照不会因为改了命名规则就读不出来
  const envFilename = rawEnvName.startsWith(".") ? rawEnvName : `.${rawEnvName}`;
  return {
    timestampStr,
    envFilename,
  };
}

export const SNAPSHOT_SOFT_LIMIT = 500;

export function checkSnapshotSoftLimit(
  count: number,
  limit = SNAPSHOT_SOFT_LIMIT
): { exceeded: boolean; message?: string } {
  if (count >= limit) {
    return {
      exceeded: true,
      message: `当前快照数量已达 ${count} 份（建议上限 ${limit} 份），请按需清理或归档。`,
    };
  }
  return { exceeded: false };
}
