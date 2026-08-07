import { beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_PREFERENCES,
  LEGACY_PREFERENCES_STORAGE_KEY,
  PREFERENCES_STORAGE_KEY,
  readPreferences,
  writePreferences,
} from "../../src/stores/preferences";

describe("local preferences v2", () => {
  beforeEach(() => localStorage.clear());

  it("migrates the v1 record without losing theme or sidebar state", () => {
    localStorage.setItem(LEGACY_PREFERENCES_STORAGE_KEY, JSON.stringify({
      theme: "dark",
      sidebarCollapsed: true,
    }));
    expect(readPreferences()).toMatchObject({
      theme: "dark",
      sidebarCollapsed: true,
      density: "comfortable",
    });
    expect(localStorage.getItem(PREFERENCES_STORAGE_KEY)).not.toBeNull();
  });

  it("falls back safely when storage is malformed", () => {
    localStorage.setItem(PREFERENCES_STORAGE_KEY, "{bad");
    expect(readPreferences()).toEqual(DEFAULT_PREFERENCES);
  });

  it("recovers a valid v1 record when v2 is damaged", () => {
    localStorage.setItem(PREFERENCES_STORAGE_KEY, "{bad");
    localStorage.setItem(LEGACY_PREFERENCES_STORAGE_KEY, JSON.stringify({
      theme: "dark",
      sidebarCollapsed: true,
    }));
    expect(readPreferences()).toMatchObject({
      theme: "dark",
      sidebarCollapsed: true,
    });
  });

  it.each([{}, []])(
    "falls through parsed but invalid v2 shape to a valid v1 record",
    (invalidV2) => {
      localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(invalidV2));
      localStorage.setItem(LEGACY_PREFERENCES_STORAGE_KEY, JSON.stringify({
        theme: "dark",
        sidebarCollapsed: true,
      }));
      expect(readPreferences()).toMatchObject({
        theme: "dark",
        sidebarCollapsed: true,
      });
    },
  );

  it("round-trips validated display currency and window bounds", () => {
    const value = {
      ...DEFAULT_PREFERENCES,
      selectedDisplayCurrency: "EUR" as never,
      density: "compact" as const,
      window: { x: 10, y: 20, width: 1280, height: 800, maximized: false },
    };
    writePreferences(value);
    expect(readPreferences()).toEqual(value);
  });
});
