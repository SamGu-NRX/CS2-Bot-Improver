import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  api,
  isMissingCommand,
  toAppError,
  type AppConfig,
  type AppError,
  type AimValue,
  type BotItemKey,
  type BotItemsState,
  type DifficultyInfo,
  type DifficultyLevel,
  type DirectoryInfo,
  type DropKnivesState,
  type FilesReport,
  type GameMode,
  type ModeInfo,
  type NadesValue,
  type PlayerCosmetics,
  type PlayerCosmeticsState,
  type PresetsState,
} from "../lib/api";

type Store = {
  ready: boolean;
  config: AppConfig | null;
  directory: DirectoryInfo | null;
  files: FilesReport | null;
  difficulty: DifficultyInfo | null;
  mode: ModeInfo | null;
  botItems: BotItemsState | null;
  presets: PresetsState | null;
  /** Per-section "changed while CS2 running, pending restart" flags. Persisted,
   *  so each yellow light survives a full close/reopen of the panel. */
  aimPending: boolean;
  nadesPending: boolean;
  modePending: boolean;
  difficultyPending: boolean;
  dropKnivesPending: boolean;
  /** Per Bot Item "changed while CS2 running, pending restart" flags — each
   *  toggle has its own yellow light; the panel's header light is yellow if any
   *  one of them is. */
  botItemsPending: Record<BotItemKey, boolean>;
  dropKnives: DropKnivesState | null;
  cosmetics: PlayerCosmeticsState | null;
  /** The running ui.exe has no player-cosmetics commands (older backend). */
  cosmeticsUnsupported: boolean;
  cosmeticsPending: boolean;
  csgoPath: string | null;
  /** Last global error (for the error modal). */
  error: AppError | null;
  clearError: () => void;
  reportError: (e: unknown) => void;
  refreshDirectory: () => Promise<DirectoryInfo | null>;
  refreshFiles: () => Promise<void>;
  refreshDifficulty: () => Promise<void>;
  refreshAll: (silent?: boolean) => Promise<void>;
  updateConfig: (patch: Partial<AppConfig>) => Promise<void>;
  chooseDirectory: (path: string) => Promise<void>;
  applyDifficulty: (level: DifficultyLevel) => Promise<DifficultyInfo | null>;
  applyMode: (mode: GameMode) => Promise<ModeInfo | null>;
  applyBotItem: (item: BotItemKey, on: boolean) => Promise<BotItemsState | null>;
  applyAim: (value: AimValue) => Promise<PresetsState | null>;
  applyNades: (value: NadesValue) => Promise<PresetsState | null>;
  applyDropKnives: (
    bindKey: string,
    selected: number[]
  ) => Promise<DropKnivesState | null>;
  /** Saves a partial change on top of the latest requested values. */
  applyCosmetics: (patch: Partial<PlayerCosmetics>) => Promise<PlayerCosmeticsState | null>;
};

/** A boolean flag persisted in localStorage so it survives a full close/reopen
 *  of the panel (used for the per-section "changed while CS2 running" lights). */
function usePersistedFlag(key: string): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState<boolean>(() => localStorage.getItem(key) === "1");
  const set = useCallback(
    (v: boolean) => {
      setValue(v);
      try {
        localStorage.setItem(key, v ? "1" : "0");
      } catch {
        /* localStorage unavailable — fall back to in-memory only */
      }
    },
    [key]
  );
  return [value, set];
}

const BOT_ITEM_KEYS: BotItemKey[] = ["skins", "profiles", "agents", "music"];

function emptyBotItemFlags(): Record<BotItemKey, boolean> {
  return { skins: false, profiles: false, agents: false, music: false };
}

/** Like usePersistedFlag, but a per-key map (one yellow light per Bot Item)
 *  stored as a single JSON entry so all four survive a close/reopen together. */
function usePersistedFlagMap(
  key: string
): [
  Record<BotItemKey, boolean>,
  (item: BotItemKey, v: boolean) => void,
  () => void
] {
  const [map, setMap] = useState<Record<BotItemKey, boolean>>(() => {
    const base = emptyBotItemFlags();
    try {
      const raw = JSON.parse(localStorage.getItem(key) || "{}");
      for (const k of BOT_ITEM_KEYS) if (raw[k] === true) base[k] = true;
    } catch {
      /* missing or legacy value — start all-false */
    }
    return base;
  });
  const persist = useCallback(
    (next: Record<BotItemKey, boolean>) => {
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* localStorage unavailable — in-memory only */
      }
    },
    [key]
  );
  const setOne = useCallback(
    (item: BotItemKey, v: boolean) =>
      setMap((prev) => {
        const next = { ...prev, [item]: v };
        persist(next);
        return next;
      }),
    [persist]
  );
  const clearAll = useCallback(() => {
    const next = emptyBotItemFlags();
    persist(next);
    setMap(next);
  }, [persist]);
  return [map, setOne, clearAll];
}

const Ctx = createContext<Store | null>(null);

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore must be used within AppStateProvider");
  return s;
}

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [directory, setDirectory] = useState<DirectoryInfo | null>(null);
  const [files, setFiles] = useState<FilesReport | null>(null);
  const [difficulty, setDifficulty] = useState<DifficultyInfo | null>(null);
  const [mode, setMode] = useState<ModeInfo | null>(null);
  const [botItems, setBotItems] = useState<BotItemsState | null>(null);
  const [presets, setPresets] = useState<PresetsState | null>(null);
  // Per-section "changed while CS2 running, pending restart" flags. Persisted in
  // localStorage so each light survives a full close/reopen of the panel while
  // CS2 keeps running (the boot refreshAll clears them once CS2 is not running).
  const [aimPending, setAimPending] = usePersistedFlag("cs2bi.aimPending");
  const [nadesPending, setNadesPending] = usePersistedFlag("cs2bi.nadesPending");
  const [modePending, setModePending] = usePersistedFlag("cs2bi.modePending");
  const [difficultyPending, setDifficultyPending] = usePersistedFlag("cs2bi.difficultyPending");
  const [dropKnivesPending, setDropKnivesPending] =
    usePersistedFlag("cs2bi.dropKnivesPending");
  const [botItemsPending, setBotItemPending, clearBotItemsPending] =
    usePersistedFlagMap("cs2bi.botItemsPending");
  const [dropKnives, setDropKnives] = useState<DropKnivesState | null>(null);
  const [cosmetics, setCosmetics] = useState<PlayerCosmeticsState | null>(null);
  const [cosmeticsPending, setCosmeticsPending] = usePersistedFlag("cs2bi.cosmeticsPending");
  // A backend without the cosmetics commands won't gain them while the panel is
  // open, so after the first "Command ... not found" the poll stops asking.
  const [cosmeticsUnsupported, setCosmeticsUnsupported] = useState(false);
  const cosmeticsUnsupportedRef = useRef(false);
  // Writes run one at a time, each built on the newest requested values, so two
  // quick edits can't undo each other. `cosmeticsEpoch` bumps on every write;
  // a poll that started before a write is dropped instead of painting old values.
  const cosmeticsRef = useRef<PlayerCosmeticsState | null>(null);
  const cosmeticsIntentRef = useRef<PlayerCosmetics | null>(null);
  const cosmeticsWrites = useRef({ chain: Promise.resolve() as Promise<unknown>, inFlight: 0 });
  const cosmeticsEpoch = useRef(0);
  const showCosmetics = useCallback((info: PlayerCosmeticsState | null) => {
    cosmeticsRef.current = info;
    setCosmetics(info);
  }, []);
  const [error, setError] = useState<AppError | null>(null);
  const configRef = useRef<AppConfig | null>(null);
  configRef.current = config;

  const reportError = useCallback((e: unknown) => setError(toAppError(e)), []);
  const clearError = useCallback(() => setError(null), []);

  const refreshFiles = useCallback(async () => {
    const csgo = directory?.valid ? directory.selected : null;
    if (!csgo) {
      setFiles(null);
      return;
    }
    try {
      setFiles(await api.validateFiles(csgo));
    } catch (e) {
      setFiles(null);
      reportError(e);
    }
  }, [directory, reportError]);

  const refreshDifficulty = useCallback(async () => {
    const csgo = directory?.valid ? directory.selected : null;
    if (!csgo) {
      setDifficulty(null);
      return;
    }
    try {
      setDifficulty(await api.getDifficulty(csgo));
    } catch (e) {
      setDifficulty(null);
      reportError(e);
    }
  }, [directory, reportError]);

  const applyDifficulty = useCallback(
    async (level: DifficultyLevel) => {
      const csgo = directory?.valid ? directory.selected : null;
      if (!csgo) return null;
      try {
        const info = await api.setDifficulty(csgo, level);
        setDifficulty(info);
        setDifficultyPending(info.cs2_running);
        return info;
      } catch (e) {
        reportError(e);
        return null;
      }
    },
    [directory, reportError]
  );

  const applyDropKnives = useCallback(
    async (bindKey: string, selected: number[]) => {
      const csgo = directory?.valid ? directory.selected : null;
      if (!csgo) return null;
      try {
        const info = await api.setDropKnives(csgo, bindKey, selected);
        setDropKnives(info);
        setDropKnivesPending(info.cs2_running);
        return info;
      } catch (e) {
        reportError(e);
        return null;
      }
    },
    [directory, reportError]
  );

  const markCosmeticsUnsupported = useCallback(() => {
    cosmeticsUnsupportedRef.current = true;
    setCosmeticsUnsupported(true);
    showCosmetics(null);
    setCosmeticsPending(false);
  }, [showCosmetics]);

  // Fetched apart from refreshAll's Promise.all so an older backend that lacks
  // get_player_cosmetics leaves every other section working.
  const loadCosmetics = useCallback(
    async (csgo: string, silent: boolean) => {
      if (cosmeticsUnsupportedRef.current) return;
      const epoch = cosmeticsEpoch.current;
      const stale = () =>
        epoch !== cosmeticsEpoch.current || cosmeticsWrites.current.inFlight > 0;
      try {
        const info = await api.getPlayerCosmetics(csgo);
        if (stale()) return;
        showCosmetics(info);
        if (!info.cs2_running) setCosmeticsPending(false);
      } catch (e) {
        if (isMissingCommand(e)) {
          markCosmeticsUnsupported();
          return;
        }
        if (silent || stale()) return;
        showCosmetics(null);
        setCosmeticsPending(false);
        reportError(e);
      }
    },
    [markCosmeticsUnsupported, reportError, showCosmetics]
  );

  const applyCosmetics = useCallback(
    async (patch: Partial<PlayerCosmetics>) => {
      const csgo = directory?.valid ? directory.selected : null;
      if (!csgo || cosmeticsUnsupportedRef.current) return null;
      const writes = cosmeticsWrites.current;
      const shown = cosmeticsRef.current;
      const base: PlayerCosmetics | null =
        writes.inFlight > 0 && cosmeticsIntentRef.current
          ? cosmeticsIntentRef.current
          : shown && {
              dropped_knife_skins: shown.dropped_knife_skins,
              dropped_knife_premium: shown.dropped_knife_premium,
              music_kit: shown.music_kit,
            };
      // Nothing read yet: there is no full set of values to write.
      if (!base) return null;
      const next = { ...base, ...patch };
      cosmeticsIntentRef.current = next;
      cosmeticsEpoch.current++;
      writes.inFlight++;
      const write = () => api.setPlayerCosmetics(csgo, next);
      const request = writes.chain.then(write, write);
      writes.chain = request.catch(() => undefined);
      try {
        const info = await request;
        // A newer queued write will report the final state; skip this one.
        if (writes.inFlight === 1) showCosmetics(info);
        setCosmeticsPending(info.cs2_running);
        return info;
      } catch (e) {
        if (isMissingCommand(e)) markCosmeticsUnsupported();
        else reportError(e);
        return null;
      } finally {
        writes.inFlight--;
      }
    },
    [directory, markCosmeticsUnsupported, reportError, showCosmetics]
  );

  const applyAim = useCallback(
    async (value: AimValue) => {
      const csgo = directory?.valid ? directory.selected : null;
      if (!csgo) return null;
      try {
        const info = await api.setAim(csgo, value);
        setPresets(info);
        // Yellow (pending restart) only if the change was made while running.
        setAimPending(info.cs2_running);
        return info;
      } catch (e) {
        reportError(e);
        return null;
      }
    },
    [directory, reportError]
  );

  const applyNades = useCallback(
    async (value: NadesValue) => {
      const csgo = directory?.valid ? directory.selected : null;
      if (!csgo) return null;
      try {
        const info = await api.setNades(csgo, value);
        setPresets(info);
        setNadesPending(info.cs2_running);
        return info;
      } catch (e) {
        reportError(e);
        return null;
      }
    },
    [directory, reportError]
  );

  const applyBotItem = useCallback(
    async (item: BotItemKey, on: boolean) => {
      const csgo = directory?.valid ? directory.selected : null;
      if (!csgo) return null;
      try {
        const info = await api.setBotItem(csgo, item, on);
        setBotItems(info);
        // Only this item's light goes yellow, and only if changed while running.
        setBotItemPending(item, info.cs2_running);
        return info;
      } catch (e) {
        reportError(e);
        return null;
      }
    },
    [directory, reportError]
  );

  const applyMode = useCallback(
    async (m: GameMode) => {
      const csgo = directory?.valid ? directory.selected : null;
      if (!csgo) return null;
      try {
        const info = await api.setMode(csgo, m);
        setMode(info);
        setModePending(info.cs2_running);
        return info;
      } catch (e) {
        reportError(e);
        return null;
      }
    },
    [directory, reportError]
  );

  const refreshDirectory = useCallback(async () => {
    try {
      const info = await api.detectDirectories();
      setDirectory(info);
      return info;
    } catch (e) {
      reportError(e);
      return null;
    }
  }, [reportError]);

  const refreshAll = useCallback(async (silent = false) => {
    const info = await refreshDirectory();
    const csgo = info?.valid ? info.selected : null;
    if (csgo) {
      const cosmeticsLoad = loadCosmetics(csgo, silent);
      try {
        const [f, d, m, b, p, k] = await Promise.all([
          api.validateFiles(csgo),
          api.getDifficulty(csgo),
          api.getMode(csgo),
          api.getBotItems(csgo),
          api.getPresets(csgo),
          api.getDropKnives(csgo),
        ]);
        setFiles(f);
        setDifficulty(d);
        setMode(m);
        setBotItems(b);
        setPresets(p);
        setDropKnives(k);
        // Once CS2 is no longer running, any pending change has taken effect —
        // clear that section's flag (each command reports its own cs2_running).
        if (!p.cs2_running) {
          setAimPending(false);
          setNadesPending(false);
        }
        if (!d.cs2_running) setDifficultyPending(false);
        if (!m.cs2_running) setModePending(false);
        if (!b.cs2_running) clearBotItemsPending();
        if (!k.cs2_running) setDropKnivesPending(false);
      } catch (e) {
        // Background poll: a transient read error shouldn't blank the UI or pop a
        // modal — keep the last good state and wait for the next tick.
        if (silent) {
          await cosmeticsLoad;
          return;
        }
        setFiles(null);
        setDifficulty(null);
        setMode(null);
        setBotItems(null);
        setPresets(null);
        setDropKnives(null);
        setAimPending(false);
        setNadesPending(false);
        setModePending(false);
        setDifficultyPending(false);
        clearBotItemsPending();
        setDropKnivesPending(false);
        reportError(e);
      }
      await cosmeticsLoad;
    } else {
      setFiles(null);
      setDifficulty(null);
      setMode(null);
      setBotItems(null);
      setPresets(null);
      setDropKnives(null);
      cosmeticsEpoch.current++;
      showCosmetics(null);
      setAimPending(false);
      setNadesPending(false);
      setModePending(false);
      setDifficultyPending(false);
      clearBotItemsPending();
      setDropKnivesPending(false);
      setCosmeticsPending(false);
    }
  }, [refreshDirectory, loadCosmetics, reportError, showCosmetics]);

  const updateConfig = useCallback(
    async (patch: Partial<AppConfig>) => {
      const base = configRef.current;
      if (!base) return;
      const next = { ...base, ...patch };
      setConfig(next);
      try {
        await api.saveConfig(next);
      } catch (e) {
        reportError(e);
      }
    },
    [reportError]
  );

  const chooseDirectory = useCallback(
    async (path: string) => {
      try {
        const info = await api.selectDirectory(path);
        setDirectory(info);
        const csgo = info.valid ? info.selected : null;
        setFiles(csgo ? await api.validateFiles(csgo) : null);
      } catch (e) {
        reportError(e);
      }
    },
    [reportError]
  );

  // Global safety net: surface any unexpected error/rejection as a modal so the
  // UI never fails silently.
  useEffect(() => {
    const onErr = (e: ErrorEvent) => {
      if (e.error) reportError(e.error);
    };
    const onRej = (e: PromiseRejectionEvent) => reportError(e.reason);
    window.addEventListener("error", onErr);
    window.addEventListener("unhandledrejection", onRej);
    return () => {
      window.removeEventListener("error", onErr);
      window.removeEventListener("unhandledrejection", onRej);
    };
  }, [reportError]);

  // Boot: load config then detect dir + validate files.
  useEffect(() => {
    (async () => {
      try {
        const cfg = await api.getConfig();
        setConfig(cfg);
      } catch (e) {
        reportError(e);
      }
      // Enforce the launch-option rule: disk follows the remembered -insecure.
      try {
        await api.reconcileLaunchOptions();
      } catch (e) {
        reportError(e);
      }
      const info = await refreshDirectory();
      const csgo = info?.valid ? info.selected : null;
      if (csgo) {
        try {
          await api.cleanupBackups(csgo);
        } catch {
          /* best-effort cleanup of legacy .bak files */
        }
        try {
          // Bring CounterStrikeSharp's core.json FollowCS2ServerGuidelines in
          // line with the current Skins state on every launch.
          await api.reconcileCoreJson(csgo);
        } catch {
          /* best-effort: core.json / core.example.json may be absent */
        }
      }
      await refreshAll();
      setReady(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live updates: while the panel is open and visible, re-scan every 0.5s so all
  // indicator lights and buttons reflect the current on-disk / CS2-running state
  // without the user reopening the panel. Silent (never pops an error modal),
  // non-overlapping (skips a tick if the previous scan is still in flight), and
  // paused while the window is hidden/minimized to avoid needless work.
  const pollingRef = useRef(false);
  useEffect(() => {
    if (!ready) return;
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      if (pollingRef.current) return;
      pollingRef.current = true;
      try {
        await refreshAll(true);
      } finally {
        pollingRef.current = false;
      }
    };
    const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, [ready, refreshAll]);

  const value: Store = {
    ready,
    config,
    directory,
    files,
    difficulty,
    mode,
    botItems,
    presets,
    aimPending,
    nadesPending,
    modePending,
    difficultyPending,
    dropKnivesPending,
    botItemsPending,
    dropKnives,
    cosmetics,
    cosmeticsUnsupported,
    cosmeticsPending,
    csgoPath: directory?.valid ? directory.selected : null,
    error,
    clearError,
    reportError,
    refreshDirectory,
    refreshFiles,
    refreshDifficulty,
    refreshAll,
    updateConfig,
    chooseDirectory,
    applyDifficulty,
    applyMode,
    applyBotItem,
    applyAim,
    applyNades,
    applyDropKnives,
    applyCosmetics,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
