import { useEffect } from "react";
import { create } from "zustand";

import { isSupportedCurrency } from "../finance/money";
import type { UiPreferences } from "../finance/types";

export type ThemePreference = UiPreferences["theme"];
type ResolvedTheme = Exclude<ThemePreference, "system">;

export const LEGACY_PREFERENCES_STORAGE_KEY = "miroratrack.preferences.v1";
export const PREFERENCES_STORAGE_KEY = "miroratrack.preferences.v2";
export const DEFAULT_PREFERENCES: UiPreferences = {
  theme: "system",
  density: "comfortable",
  sidebarCollapsed: false,
  selectedDisplayCurrency: "USD" as never,
  window: { width: 1440, height: 920, maximized: false },
};

const themes = new Set(["light", "dark", "system"]);
const densities = new Set(["compact", "comfortable"]);

function finite(value: unknown): value is number {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    Math.abs(value) <= 100_000;
}

function parsePreferences(value: unknown): UiPreferences {
  if (!value || typeof value !== "object") return DEFAULT_PREFERENCES;
  const item = value as Record<string, unknown>;
  const windowValue =
    item.window && typeof item.window === "object"
      ? item.window as Record<string, unknown>
      : {};
  const width = finite(windowValue.width) &&
      windowValue.width >= 1080 && windowValue.width <= 10_000
    ? windowValue.width
    : DEFAULT_PREFERENCES.window.width;
  const height = finite(windowValue.height) &&
      windowValue.height >= 720 && windowValue.height <= 10_000
    ? windowValue.height
    : DEFAULT_PREFERENCES.window.height;
  return {
    theme: themes.has(item.theme as string)
      ? item.theme as ThemePreference
      : DEFAULT_PREFERENCES.theme,
    density: densities.has(item.density as string)
      ? item.density as UiPreferences["density"]
      : DEFAULT_PREFERENCES.density,
    sidebarCollapsed: typeof item.sidebarCollapsed === "boolean"
      ? item.sidebarCollapsed
      : DEFAULT_PREFERENCES.sidebarCollapsed,
    selectedDisplayCurrency:
      typeof item.selectedDisplayCurrency === "string" &&
      isSupportedCurrency(item.selectedDisplayCurrency)
        ? item.selectedDisplayCurrency
        : DEFAULT_PREFERENCES.selectedDisplayCurrency,
    window: {
      ...(finite(windowValue.x) ? { x: windowValue.x } : {}),
      ...(finite(windowValue.y) ? { y: windowValue.y } : {}),
      width,
      height,
      maximized: typeof windowValue.maximized === "boolean"
        ? windowValue.maximized
        : false,
    },
  };
}

function isValidV2Shape(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  if (
    !themes.has(item.theme as string) ||
    !densities.has(item.density as string) ||
    typeof item.sidebarCollapsed !== "boolean" ||
    typeof item.selectedDisplayCurrency !== "string" ||
    !isSupportedCurrency(item.selectedDisplayCurrency) ||
    !item.window ||
    typeof item.window !== "object" ||
    Array.isArray(item.window)
  ) return false;
  const windowValue = item.window as Record<string, unknown>;
  return finite(windowValue.width) &&
    windowValue.width >= 1080 &&
    windowValue.width <= 10_000 &&
    finite(windowValue.height) &&
    windowValue.height >= 720 &&
    windowValue.height <= 10_000 &&
    typeof windowValue.maximized === "boolean" &&
    (windowValue.x === undefined || finite(windowValue.x)) &&
    (windowValue.y === undefined || finite(windowValue.y));
}

function isValidV1Shape(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return themes.has(item.theme as string) &&
    typeof item.sidebarCollapsed === "boolean";
}

export function writePreferences(preferences: UiPreferences): void {
  try {
    localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Preferences remain available in memory.
  }
}

export function readPreferences(): UiPreferences {
  try {
    const current = localStorage.getItem(PREFERENCES_STORAGE_KEY);
    if (current !== null) {
      try {
        const parsed: unknown = JSON.parse(current);
        if (isValidV2Shape(parsed)) return parsePreferences(parsed);
      } catch {
        // A valid legacy record can still recover a damaged v2 record.
      }
    }
    const legacy = localStorage.getItem(LEGACY_PREFERENCES_STORAGE_KEY);
    if (legacy === null) return DEFAULT_PREFERENCES;
    const parsedLegacy: unknown = JSON.parse(legacy);
    if (!isValidV1Shape(parsedLegacy)) return DEFAULT_PREFERENCES;
    const migrated = parsePreferences(parsedLegacy);
    writePreferences(migrated);
    return migrated;
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

interface PreferencesState extends UiPreferences {
  setTheme(theme: ThemePreference): void;
  setSidebarCollapsed(collapsed: boolean): void;
  toggleSidebar(): void;
  setDensity(density: UiPreferences["density"]): void;
  setSelectedDisplayCurrency(currency: UiPreferences["selectedDisplayCurrency"]): void;
  setWindow(window: UiPreferences["window"]): void;
}

function resolvedTheme(theme: ThemePreference): ResolvedTheme {
  if (theme !== "system") return theme;
  try {
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  } catch {
    return "light";
  }
}

export function applyTheme(theme: ThemePreference): void {
  const resolved = resolvedTheme(theme);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
}

const initial = readPreferences();
const persisted = (state: PreferencesState): UiPreferences => ({
  theme: state.theme,
  density: state.density,
  sidebarCollapsed: state.sidebarCollapsed,
  selectedDisplayCurrency: state.selectedDisplayCurrency,
  window: state.window,
});

export const usePreferences = create<PreferencesState>((set, get) => ({
  ...initial,
  setTheme: (theme) => {
    set({ theme });
    applyTheme(theme);
    writePreferences({ ...persisted(get()), theme });
  },
  setSidebarCollapsed: (sidebarCollapsed) => {
    set({ sidebarCollapsed });
    writePreferences({ ...persisted(get()), sidebarCollapsed });
  },
  toggleSidebar: () => {
    const sidebarCollapsed = !get().sidebarCollapsed;
    set({ sidebarCollapsed });
    writePreferences({ ...persisted(get()), sidebarCollapsed });
  },
  setDensity: (density) => {
    set({ density });
    writePreferences({ ...persisted(get()), density });
  },
  setSelectedDisplayCurrency: (selectedDisplayCurrency) => {
    set({ selectedDisplayCurrency });
    writePreferences({ ...persisted(get()), selectedDisplayCurrency });
  },
  setWindow: (window) => {
    set({ window });
    writePreferences({ ...persisted(get()), window });
  },
}));

export function hydratePreferences(): void {
  const preferences = readPreferences();
  usePreferences.setState(preferences);
  applyTheme(preferences.theme);
}

applyTheme(initial.theme);

export function useThemePreference(): void {
  const theme = usePreferences((state) => state.theme);
  useEffect(() => {
    applyTheme(theme);
    if (theme !== "system") return;
    try {
      const media = window.matchMedia?.("(prefers-color-scheme: dark)");
      const update = () => applyTheme("system");
      media?.addEventListener?.("change", update);
      return () => media?.removeEventListener?.("change", update);
    } catch {
      return;
    }
  }, [theme]);
}
