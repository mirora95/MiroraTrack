import {
  LogicalPosition,
  LogicalSize,
  getCurrentWindow,
} from "@tauri-apps/api/window";
import type { WindowPreferences } from "../finance/types";

export interface WorkArea {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface WindowStatePort {
  visibleWorkArea(): Promise<WorkArea>;
  apply(preferences: Required<WindowPreferences>): Promise<void>;
}

export function clampWindowPreferences(
  preferences: WindowPreferences,
  workArea: WorkArea,
): Required<WindowPreferences> {
  const width = Math.min(Math.max(1, preferences.width), workArea.width);
  const height = Math.min(Math.max(1, preferences.height), workArea.height);
  const preferredX =
    preferences.x ?? workArea.x + Math.floor((workArea.width - width) / 2);
  const preferredY =
    preferences.y ?? workArea.y + Math.floor((workArea.height - height) / 2);
  return {
    x: clamp(preferredX, workArea.x, workArea.x + workArea.width - width),
    y: clamp(preferredY, workArea.y, workArea.y + workArea.height - height),
    width,
    height,
    maximized: preferences.maximized,
  };
}

export async function restoreWindowPreferences(
  port: WindowStatePort,
  preferences: WindowPreferences,
): Promise<boolean> {
  try {
    const workArea = await port.visibleWorkArea();
    await port.apply(clampWindowPreferences(preferences, workArea));
    return true;
  } catch {
    return false;
  }
}

export class TauriWindowStatePort implements WindowStatePort {
  async visibleWorkArea(): Promise<WorkArea> {
    const currentScreen = globalThis.screen as Screen & {
      readonly availLeft?: number;
      readonly availTop?: number;
    };
    if (
      !currentScreen ||
      !Number.isFinite(currentScreen.availWidth) ||
      !Number.isFinite(currentScreen.availHeight) ||
      currentScreen.availWidth <= 0 ||
      currentScreen.availHeight <= 0
    ) {
      throw new Error("Visible work area is unavailable");
    }
    return {
      x: currentScreen.availLeft ?? 0,
      y: currentScreen.availTop ?? 0,
      width: currentScreen.availWidth,
      height: currentScreen.availHeight,
    };
  }

  async apply(preferences: Required<WindowPreferences>): Promise<void> {
    const appWindow = getCurrentWindow();
    if (!preferences.maximized) await appWindow.unmaximize();
    await appWindow.setSize(
      new LogicalSize(preferences.width, preferences.height),
    );
    await appWindow.setPosition(
      new LogicalPosition(preferences.x, preferences.y),
    );
    if (preferences.maximized) await appWindow.maximize();
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

