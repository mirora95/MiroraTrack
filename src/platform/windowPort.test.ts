import { describe, expect, it, vi } from "vitest";
import type { WindowPreferences } from "../finance/types";
import {
  clampWindowPreferences,
  restoreWindowPreferences,
  type WindowStatePort,
} from "./windowPort";

const workArea = { x: 0, y: 0, width: 1920, height: 1040 };

describe("window state adapter boundary", () => {
  it("clamps saved size and position into the visible work area", () => {
    expect(clampWindowPreferences({
      x: 4_000,
      y: -900,
      width: 3_000,
      height: 2_000,
      maximized: false,
    }, workArea)).toEqual({
      x: 0,
      y: 0,
      width: 1920,
      height: 1040,
      maximized: false,
    });
  });

  it("falls back to OS defaults without rejecting when native restoration fails", async () => {
    const port: WindowStatePort = {
      visibleWorkArea: vi.fn().mockResolvedValue(workArea),
      apply: vi.fn().mockRejectedValue(new Error("native unavailable")),
    };
    const preferences: WindowPreferences = {
      width: 1440,
      height: 920,
      maximized: false,
    };

    await expect(restoreWindowPreferences(port, preferences))
      .resolves.toBe(false);
  });

  it("applies maximized state after clamped bounds", async () => {
    const apply = vi.fn().mockResolvedValue(undefined);
    const port: WindowStatePort = {
      visibleWorkArea: vi.fn().mockResolvedValue(workArea),
      apply,
    };
    await expect(restoreWindowPreferences(port, {
      x: 100,
      y: 80,
      width: 1440,
      height: 920,
      maximized: true,
    })).resolves.toBe(true);
    expect(apply).toHaveBeenCalledWith({
      x: 100,
      y: 80,
      width: 1440,
      height: 920,
      maximized: true,
    });
  });
});

