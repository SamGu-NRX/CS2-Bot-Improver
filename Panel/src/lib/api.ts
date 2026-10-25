import { invoke } from "@tauri-apps/api/core";

/** Mirrors Rust `AppError` (error.rs). Codes are stable & not localized. */
export type AppError = {
  code: string;
  category: string;
  detail: string;
};

export function isAppError(e: unknown): e is AppError {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    "category" in e &&
    typeof (e as AppError).code === "string"
  );
}

/** True when the backend has no handler for the invoked command. Tauri 2
 *  rejects with the plain string "Command <name> not found" (tauri
 *  webview/mod.rs), so an older ui.exe can be told apart from a real failure. */
export function isMissingCommand(e: unknown): boolean {
  return typeof e === "string" && /^Command \S+ not found$/.test(e);
}

/** Normalize any thrown value into an AppError so the UI always has a code. */
export function toAppError(e: unknown): AppError {
  if (isAppError(e)) return e;
  return {
    code: "E1099",
    category: "internal",
    detail: typeof e === "string" ? e : JSON.stringify(e),
  };
}

// ---- DTOs (mirror src-tauri) ----
export type DirectoryInfo = {
  candidates: string[];
  selected: string | null;
  valid: boolean;
  needs_choice: boolean;
  steam_found: boolean;
};

export type FilesReport = {
  ok: boolean;
  total: number;
  present: number;
  missing: string[];
  /** Wrong folder the plugin was extracted into, if detected. */
  misplaced: string | null;
};

export type DifficultyLevel = "Low" | "Medium" | "High";

export type DifficultyInfo = {
  current: DifficultyLevel | null;
  available: DifficultyLevel[];
  active_present: boolean;
  cs2_running: boolean;
};

export type BotItemKey = "skins" | "profiles" | "agents" | "music";

export type BotItemsState = {
  skins: boolean;
  profiles: boolean;
  agents: boolean;
  music: boolean;
  cfg_present: boolean;
  cs2_running: boolean;
};

export type AimValue = "head" | "mixed" | "body";
export type NadesValue = "max" | "more" | "normal" | "off";

export type PresetsState = {
  aim: AimValue | null;
  nades: NadesValue | null;
  cfg_present: boolean;
  cs2_running: boolean;
};

export type DropKnivesState = {
  bind_key: string;
  selected: number[];
  cfg_present: boolean;
  cs2_running: boolean;
};

/** The human player's BotRandomizer cosmetics, one field per server convar. */
export type PlayerCosmetics = {
  /** br_dropped_knife_skins: random finishes on knives spawned by subclass_create. */
  dropped_knife_skins: boolean;
  /** br_dropped_knife_premium: favor expensive finishes (only read when skins are on). */
  dropped_knife_premium: boolean;
  /** br_player_music_kit: 0 = off, -1 = random per map, >0 = music kit definition ID. */
  music_kit: number;
};

export const MUSIC_KIT_OFF = 0;
export const MUSIC_KIT_RANDOM = -1;

export type PlayerCosmeticsState = PlayerCosmetics & {
  cfg_present: boolean;
  cs2_running: boolean;
};

export type GameMode = "online" | "bots";

export type ModeInfo = {
  current: GameMode | null;
  online_present: boolean;
  bots_present: boolean;
  insecure: boolean;
  user_count: number;
  cs2_running: boolean;
  // CS2 running and the on-disk gameinfo.gi doesn't match the remembered mode
  // (the boot-time apply was skipped) — show the mode control yellow.
  pending: boolean;
};

export type LaunchResult = {
  options: string;
  insecure: boolean;
};

export type BotItems = {
  skins: boolean;
  profiles: boolean;
  agents: boolean;
  music: boolean;
};

export type AppConfig = {
  language: string | null;
  difficulty: string | null;
  mode: string | null;
  insecure: boolean;
  bot_items: BotItems;
  aim: string | null;
  nades: string | null;
  drop_knife_bind: string;
  drop_knife_subclasses: number[];
  csgo_path: string | null;
  first_run_done: boolean;
};

// ---- Command wrappers ----
export const api = {
  getConfig: () => invoke<AppConfig>("get_config"),
  saveConfig: (config: AppConfig) => invoke<void>("save_config", { config }),
  detectDirectories: () => invoke<DirectoryInfo>("detect_directories"),
  selectDirectory: (path: string) =>
    invoke<DirectoryInfo>("select_directory", { path }),
  cleanupBackups: (csgo: string) => invoke<number>("cleanup_backups", { csgo }),
  validateFiles: (csgo: string) => invoke<FilesReport>("validate_files", { csgo }),
  getDifficulty: (csgo: string) => invoke<DifficultyInfo>("get_difficulty", { csgo }),
  setDifficulty: (csgo: string, level: DifficultyLevel) =>
    invoke<DifficultyInfo>("set_difficulty", { csgo, level }),
  getMode: (csgo: string) => invoke<ModeInfo>("get_mode", { csgo }),
  setMode: (csgo: string, mode: GameMode) =>
    invoke<ModeInfo>("set_mode", { csgo, mode }),
  reconcileLaunchOptions: () => invoke<number>("reconcile_launch_options"),
  launchCs2: () => invoke<LaunchResult>("launch_cs2"),
  reconcileCoreJson: (csgo: string) => invoke<void>("reconcile_core_json", { csgo }),
  getBotItems: (csgo: string) => invoke<BotItemsState>("get_bot_items", { csgo }),
  setBotItem: (csgo: string, item: BotItemKey, on: boolean) =>
    invoke<BotItemsState>("set_bot_item", { csgo, item, on }),
  getPresets: (csgo: string) => invoke<PresetsState>("get_presets", { csgo }),
  setAim: (csgo: string, value: AimValue) =>
    invoke<PresetsState>("set_aim", { csgo, value }),
  setNades: (csgo: string, value: NadesValue) =>
    invoke<PresetsState>("set_nades", { csgo, value }),
  getDropKnives: (csgo: string) =>
    invoke<DropKnivesState>("get_drop_knives", { csgo }),
  setDropKnives: (csgo: string, bindKey: string, selected: number[]) =>
    invoke<DropKnivesState>("set_drop_knives", { csgo, bindKey, selected }),
  getPlayerCosmetics: (csgo: string) =>
    invoke<PlayerCosmeticsState>("get_player_cosmetics", { csgo }),
  setPlayerCosmetics: (csgo: string, cosmetics: PlayerCosmetics) =>
    invoke<PlayerCosmeticsState>("set_player_cosmetics", { csgo, cosmetics }),
};
