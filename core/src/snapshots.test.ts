import { describe, expect, it } from "vitest";
import {
  checkSnapshotSoftLimit,
  formatSnapshotTimestamp,
  generateSnapshotFilename,
  parseSnapshotFilename,
} from "./snapshots.js";

describe("snapshots", () => {
  it("formatSnapshotTimestamp & generateSnapshotFilename", () => {
    const fixedDate = new Date(2026, 8, 1, 18, 34, 30); // 2026-09-01 18:34:30
    const ts = formatSnapshotTimestamp(fixedDate);
    expect(ts).toBe("2026-09-01-183430");

    const fn1 = generateSnapshotFilename(".env", fixedDate);
    expect(fn1).toBe("2026-09-01-183430.env");

    const fn2 = generateSnapshotFilename(".env.development", fixedDate);
    expect(fn2).toBe("2026-09-01-183430.env.development");
  });

  it("parseSnapshotFilename: handles the current single-dot and the legacy double-dot names", () => {
    // 现在生成的格式
    expect(parseSnapshotFilename("2026-09-01-183430.env.production")).toEqual({
      timestampStr: "2026-09-01-183430",
      envFilename: ".env.production",
    });
    expect(parseSnapshotFilename("2026-09-01-183430.env")).toEqual({
      timestampStr: "2026-09-01-183430",
      envFilename: ".env",
    });

    // 历史遗留的双点格式(磁盘上已有的老快照),改了命名规则后仍要能读出来
    expect(parseSnapshotFilename("2026-09-01-183430..env.production")).toEqual({
      timestampStr: "2026-09-01-183430",
      envFilename: ".env.production",
    });

    expect(parseSnapshotFilename("invalid_name.txt")).toBeNull();
  });

  it("checkSnapshotSoftLimit", () => {
    expect(checkSnapshotSoftLimit(100, 500).exceeded).toBe(false);
    expect(checkSnapshotSoftLimit(500, 500).exceeded).toBe(true);
    expect(checkSnapshotSoftLimit(501, 500).exceeded).toBe(true);
  });

  it("parseSnapshotFilename 认得同秒撞名时补的序号", () => {
    expect(parseSnapshotFilename("2026-09-06-100633-2..env.development")).toEqual({
      timestampStr: "2026-09-06-100633",
      envFilename: ".env.development",
    });
  });
});
