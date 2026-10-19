import * as THREE from "three";
import { useRef, useState, useCallback, useMemo, useEffect, memo } from "react";

import {
  loadLibrary,
  saveLibrary,
  type LibraryEntry,
} from "./utils/libraryStorage";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import {
  ScratchableVinyl,
  ResponsiveCamera,
} from "./components/ScratchableVinyl";
import { useAudioEngine, type Track } from "./hooks/useAudioEngine";
import { getCoverArt } from "./utils/coverArt";

import { useTheme } from "./hooks/useTheme";
import { extractPaletteFromImage } from "./utils/colorExtract";
import { CustomizePanel } from "./components/CustomizePanel";
import { useAnimatedTheme } from "./hooks/useAnimatedTheme";

import { Reorder } from "framer-motion";

import {
  loadPlaylists,
  savePlaylists,
  createPlaylist,
  type Playlist,
} from "./utils/playlistStorage";
import { PlaylistGrid, PlaylistDetail } from "./components/PlaylistManager";
import { PlaylistModal, type CandidateGroup } from "./components/PlaylistModal";
import { ConfirmModal } from "./components/ConfirmModal";
import { DeleteConfirmModal } from "./components/DeleteConfirmModal";
import { DEFAULT_COVER } from "./utils/defaultCover";

import "./App.css";

const RPM_BASE = 33.333;

const PLAY_MODE_LABEL: Record<"single" | "continuous" | "loop", string> = {
  single: "Solo (se detiene al terminar)",
  continuous: "Seguido (pasa a la siguiente pista)",
  loop: "Bucle (se repite indefinidamente)",
};

const PLAY_MODE_ICON: Record<"single" | "continuous" | "loop", string> = {
  single: "⏹",
  continuous: "⏭",
  loop: "🔁",
};

function formatTime(seconds: number) {
  if (!isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// ─── Hash SHA-256 (fallback a FNV-1a si no hay SubtleCrypto) ───
async function hashArrayBuffer(buffer: ArrayBuffer): Promise<string> {
  try {
    if (typeof crypto !== "undefined" && crypto.subtle) {
      const hash = await crypto.subtle.digest("SHA-256", buffer);
      return Array.from(new Uint8Array(hash))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    }
  } catch {
    /* fallback abajo */
  }
  const bytes = new Uint8Array(buffer);
  let h = 0x811c9dc5;
  const step = Math.max(1, Math.floor(bytes.length / 16384));
  for (let i = 0; i < bytes.length; i += step) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

// ─── Persistencia de carpetas abiertas ───
const OPENED_FOLDERS_KEY = "mozzie:openedFolders";

function loadOpenedFolders(): string[] {
  try {
    const raw = localStorage.getItem(OPENED_FOLDERS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

interface TrackItemProps {
  id: string;
  name: string;
  isPlaying: boolean;
  isSelected: boolean;
  isSelectMode?: boolean;
  isChecked?: boolean;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onCheck?: (id: string) => void;
  onRequestDelete?: (id: string) => void;
}

const TrackItem = memo(function TrackItem({
  id,
  name,
  isPlaying,
  isSelected,
  isSelectMode,
  isChecked,
  onSelect,
  onToggle,
  onCheck,
  onRequestDelete,
}: TrackItemProps) {
  return (
    <Reorder.Item
      value={id}
      className={`track-item ${isSelected ? "active" : ""} ${isSelectMode ? "select-mode" : ""}`}
      onClick={() => {
        if (isSelectMode && onCheck) onCheck(id);
        else onSelect(id);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        if (!isSelectMode && onRequestDelete) onRequestDelete(id);
      }}
      onPointerDown={(e) => {
        // e.button === 2 significa click derecho
        if (e.button === 2) {
          e.preventDefault();
          e.stopPropagation();
          if (!isSelectMode && onRequestDelete) onRequestDelete(id);
        }
      }}
      title={name}
      whileDrag={{
        scale: 1.03,
        boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
        cursor: "grabbing",
        zIndex: 10,
      }}
    >
      {isSelectMode && (
        <input
          type="checkbox"
          className="track-checkbox"
          checked={isChecked}
          onChange={() => onCheck && onCheck(id)}
          onClick={(e) => e.stopPropagation()}
        />
      )}
      <span className="track-name">{name}</span>
      {!isSelectMode && (
        <button
          className={`track-status-btn ${isPlaying ? "playing" : "paused"}`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onToggle(id);
          }}
          aria-label={isPlaying ? "Pausar" : "Reproducir"}
        >
          {isPlaying ? "▶" : "⏸"}
        </button>
      )}
    </Reorder.Item>
  );
});

function ReactiveLights({
  baseIntensity,
  isPlaying,
  getVolume,
  active,
  smoothing,
}: any) {
  const lightRef = useRef<THREE.AmbientLight>(null);
  const currentIntensity = useRef(baseIntensity);

  useFrame(() => {
    if (!lightRef.current) return;
    const target =
      active && isPlaying ? baseIntensity + getVolume() * 2.5 : baseIntensity;

    // Interpolación suave
    currentIntensity.current += (target - currentIntensity.current) * smoothing;
    lightRef.current.intensity = currentIntensity.current;
  });

  return <ambientLight ref={lightRef} intensity={baseIntensity} />;
}

function App() {
  const { globalTheme, setGlobalTheme } = useTheme();
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [editingRpm, setEditingRpm] = useState(false);
  const [rpmDraft, setRpmDraft] = useState("");
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const controlsRef = useRef<any>(null);

  const [appMode, setAppMode] = useState<"player" | "playlists">("player");
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(
    null,
  );
  const [playlists, setPlaylists] = useState<Playlist[]>(() => loadPlaylists());
  const [playlistModalOpen, setPlaylistModalOpen] = useState(false);
  const [playlistModalPreselect, setPlaylistModalPreselect] = useState<
    string[] | null
  >(null);
  const [activePlaylistId, setActivePlaylistId] = useState<string | null>(null);
  const [isLoadingPlaylist, setIsLoadingPlaylist] = useState(false);
  const [confirmEmptyInbox, setConfirmEmptyInbox] = useState(false);
  const [isRefreshingCovers, setIsRefreshingCovers] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<"name" | "artist" | "date" | "manual">(
    "name",
  );
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [activeDropdown, setActiveDropdown] = useState<
    "open" | "filter" | null
  >(null);
  const [playbackContext, setPlaybackContext] = useState<string[]>([]);

  const [coverGallery, setCoverGallery] = useState<{
    trackId: string;
    covers: string[];
  } | null>(null);
  
  const [coverSearchName, setCoverSearchName] = useState("");
  const [coverSearchArtist, setCoverSearchArtist] = useState(""); // ← NUEVO

  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedForAction, setSelectedForAction] = useState<Set<string>>(
    new Set(),
  );

  const [pendingDelete, setPendingDelete] = useState<string[] | null>(null);
  const dontAskDeleteRef = useRef(false);
  const prePinSettingsRef = useRef<any>(null);

  const prevTrackIdRef = useRef<string | null>(null);

  const [loadProgress, setLoadProgress] = useState<{
    loaded: number;
    total: number;
  } | null>(null);
  const loadProgressTimerRef = useRef<number | null>(null);
  const [openedFolders, setOpenedFolders] = useState<string[]>(() =>
    loadOpenedFolders(),
  );
  useEffect(() => {
    try {
      localStorage.setItem(OPENED_FOLDERS_KEY, JSON.stringify(openedFolders));
    } catch {}
  }, [openedFolders.join("|")]);

  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () =>
      document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch((err) => {
        console.warn("No se pudo activar pantalla completa:", err);
      });
    } else {
      document.exitFullscreen();
    }
  }, []);

  const stateRef = useRef<any>(null);
  const playTrackRef = useRef<((id: string) => void) | null>(null);
  const pauseTrackRef = useRef<((id: string) => void) | null>(null);
  const coverProcessedRef = useRef(new Set<string>());
  const paletteProcessedRef = useRef(new Set<string>());

  const {
    tracks,
    addTrackFromArrayBuffer,
    clearAll,
    removeTrack,
    toggleTrack,
    playTrack,
    pauseTrack,
    seekTrack,
    setTrackRate,
    setTrackBaseRateSmooth,
    setTrackDirection,
    setTrackEQ,
    setTrackPan,
    setTrackReverb,
    setTrackVolume,
    setTrackCover,
    setTrackBaseRate, // <--- AÑADIR ESTO
    setTrackExtractedColors,
    setTrackThemeMode,
    setTrackCustomThemeColors,
    reorderTracks,
    beginScratch,
    endScratch,
    getAnalyserVolume,
    setTrackAvailableCovers,
    } = useAudioEngine({
    onTrackEnd: (id) => {
      const s = stateRef.current;
      if (!s) return;
      const mode = s.playMode as "single" | "continuous" | "loop";

      if (mode === "loop") {
        setTimeout(() => playTrackRef.current?.(id), 0);
        return;
      }

      if (mode === "continuous") {
        // Usar el contexto o la lista actual de canciones
        const list = s.playbackContext.length > 0 ? s.playbackContext : s.tracks.map((t) => t.id);

        const idx = list.indexOf(id);
        if (idx < 0 || list.length === 0) return;

        const nextIdx = (idx + 1) % list.length;
        const nextTrackId = list[nextIdx];

        setSelectedTrackId(nextTrackId);

        if (s.singlePlayback) {
          s.tracks.forEach((t) => {
            if (t.id !== nextTrackId && t.isPlaying) {
              pauseTrackRef.current?.(t.id);
            }
          });
        }
        
        setTimeout(() => {
          playTrackRef.current?.(nextTrackId);
        }, 0);
        return;
      }
    },
  });

  playTrackRef.current = playTrack;
  pauseTrackRef.current = pauseTrack;

  const selectedTrack = tracks.find((t) => t.id === selectedTrackId) ?? null;

  const rpm = (selectedTrack?.baseRate ?? 1) * RPM_BASE;
  const eqLow = selectedTrack?.eq.low ?? 0;
  const eqMid = selectedTrack?.eq.mid ?? 0;
  const eqHigh = selectedTrack?.eq.high ?? 0;
  const pan = selectedTrack?.pan ?? 0;
  const reverb = selectedTrack?.reverb ?? 0;

  stateRef.current = {
    tracks,
    selectedTrackId,
    selectedTrack,
    singlePlayback: globalTheme.singlePlayback,
    playMode: globalTheme.playMode,
    playbackContext, 
    isLoading: isLoadingPlaylist || loadProgress !== null, // ✅ NUEVO
  };

  // ✅ LÓGICA LIMPIA Y CORREGIDA
  const effectiveTheme = useMemo(() => {
    let primary = globalTheme.primary;
    let bg1 = globalTheme.themeColor1;
    let panel = globalTheme.themeColor2;
    let bg2 = globalTheme.themeColor2;

    if (globalTheme.discThemeMode && selectedTrack) {
      const diskColors =
        selectedTrack.themeMode === "custom" && selectedTrack.customThemeColors
          ? selectedTrack.customThemeColors
          : selectedTrack.themeColors;

      const auto1 = diskColors?.[0] || globalTheme.themeColor1;
      const auto2 = diskColors?.[1] || globalTheme.themeColor2;
      const auto3 = diskColors?.[2] || globalTheme.themeColor2;

      if (globalTheme.primarySource === "auto1") primary = auto1;
      if (globalTheme.primarySource === "auto2") primary = auto2;
      if (globalTheme.primarySource === "auto3") primary = auto3;
      if (globalTheme.primarySource === "color1")
        primary = globalTheme.themeColor1;
      if (globalTheme.primarySource === "color2")
        primary = globalTheme.themeColor2;

      if (globalTheme.bgSource === "auto1") bg1 = auto1;
      if (globalTheme.bgSource === "auto2") bg1 = auto2;
      if (globalTheme.bgSource === "auto3") bg1 = auto3;
      if (globalTheme.bgSource === "color1") bg1 = globalTheme.themeColor1;
      if (globalTheme.bgSource === "color2") bg1 = globalTheme.themeColor2;

      panel = auto3;

      if (globalTheme.gradientColorSource === "auto1") bg2 = auto1;
      if (globalTheme.gradientColorSource === "auto2") bg2 = auto2;
      if (globalTheme.gradientColorSource === "auto3") bg2 = auto3;
      if (globalTheme.gradientColorSource === "color1")
        bg2 = globalTheme.themeColor1;
      if (globalTheme.gradientColorSource === "color2")
        bg2 = globalTheme.themeColor2;
      if (globalTheme.gradientColorSource === "custom")
        bg2 = globalTheme.gradientColor2;
    }

    return { primary, bg1, bg2, panel };
  }, [globalTheme, selectedTrack]);

  const animatedTheme = useAnimatedTheme(effectiveTheme, 600);

  const displayedTracks = useMemo(() => {
    let result = [...tracks];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((t) => t.name.toLowerCase().includes(q));
    }

    if (sortBy === "manual") return result;

    const dir = sortDir === "asc" ? 1 : -1;
    if (sortBy === "name" || sortBy === "artist") {
      result.sort((a, b) => dir * a.name.localeCompare(b.name));
    } else if (sortBy === "date") {
      result.sort((a, b) => dir * (a.file.lastModified - b.file.lastModified));
    }
    return result;
  }, [tracks, searchQuery, sortBy, sortDir]);

  const allVisibleSelected = useMemo(
    () =>
      displayedTracks.length > 0 &&
      displayedTracks.every((t) => selectedForAction.has(t.id)),
    [displayedTracks, selectedForAction],
  );
  const someVisibleSelected = useMemo(
    () =>
      !allVisibleSelected &&
      displayedTracks.some((t) => selectedForAction.has(t.id)),
    [allVisibleSelected, displayedTracks, selectedForAction],
  );

  const toggleSelectAll = useCallback(() => {
    setSelectedForAction((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        displayedTracks.forEach((t) => next.delete(t.id));
      } else {
        displayedTracks.forEach((t) => next.add(t.id));
      }
      return next;
    });
  }, [allVisibleSelected, displayedTracks]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "F11") {
        e.preventDefault();
        toggleFullscreen();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [toggleFullscreen]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const track of tracks) {
        if (!track.coverUrl) continue;
        const palette = await extractPaletteFromImage(
          track.coverUrl,
          globalTheme.satBoost,
          globalTheme.brightness,
          globalTheme.grayscalePalette,
          globalTheme.grayscaleDarkness, // <--- AÑADIDO
        );
        if (cancelled) return;
        setTrackExtractedColors(track.id, palette);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    globalTheme.satBoost,
    globalTheme.brightness,
    globalTheme.grayscalePalette,
    globalTheme.grayscaleDarkness, // <--- AÑADIDO
  ]);

  useEffect(() => {
    const targets = tracks.filter(
      (t) =>
        t.sourcePath && !t.coverUrl && !coverProcessedRef.current.has(t.id),
    );
    if (targets.length === 0) return;
    for (const t of targets) coverProcessedRef.current.add(t.id);
    for (const t of targets) {
      (async () => {
        try {
          const { covers } = await getCoverArt(t.file);
          if (covers.length > 0) {
            setTrackCover(t.id, covers[0]);
            setTrackAvailableCovers(t.id, covers);
          }
        } catch {}
      })();
    }
  }, [
    tracks
      .map(
        (t) => `${t.id}:${t.sourcePath ? "s" : "-"}:${t.coverUrl ? "c" : "-"}`,
      )
      .join("|"),
  ]);

  useEffect(() => {
    const targets = tracks.filter(
      (t) =>
        t.coverUrl && !t.themeColors && !paletteProcessedRef.current.has(t.id),
    );
    if (targets.length === 0) return;
    for (const t of targets) paletteProcessedRef.current.add(t.id);
    for (const t of targets) {
      (async () => {
        try {
          const palette = await extractPaletteFromImage(
            t.coverUrl!,
            globalTheme.satBoost,
            globalTheme.brightness,
            globalTheme.grayscalePalette,
            globalTheme.grayscaleDarkness, // <--- AÑADIDO
          );
          setTrackExtractedColors(t.id, palette);
        } catch {}
      })();
    }
  }, [
    tracks
      .map(
        (t) => `${t.id}:${t.coverUrl ? "c" : "-"}:${t.themeColors ? "p" : "-"}`,
      )
      .join("|"),
    globalTheme.grayscalePalette,
    globalTheme.grayscaleDarkness, // <--- AÑADIDO
  ]);

  const playlistsSignature = useMemo(
    () =>
      JSON.stringify(
        playlists.map((p) => `${p.id}|${p.name}|${p.trackPaths.length}`),
      ),
    [playlists],
  );
  useEffect(() => {
    savePlaylists(playlists);
  }, [playlistsSignature]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat) return;
      const t = e.target as HTMLElement;
      if (
        t?.tagName === "INPUT" ||
        t?.tagName === "TEXTAREA" ||
        t?.isContentEditable
      )
        return;
      e.preventDefault();
      const s = stateRef.current;
      if (s.selectedTrack) toggleTrack(s.selectedTrack.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleTrack]);

  useEffect(() => {
    const pending = tracks.filter(
      (t) => t.themeMode === "custom" && !t.customThemeColors && t.themeColors,
    );
    if (pending.length === 0) return;
    // ✅ Corregido el casteo de tipos a 3 colores
    pending.forEach((t) => {
      setTrackCustomThemeColors(t.id, [...t.themeColors!] as [
        string,
        string,
        string,
      ]);
    });
  }, [tracks]);

  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    if (!window.mozzie) return;
    restoredRef.current = true;
    (async () => {
      const entries = loadLibrary();
      if (entries.length === 0) return;
      const existing = await Promise.all(
        entries.map(async (e) =>
          (await window.mozzie!.exists(e.path)) ? e : null,
        ),
      );
      const valid = existing.filter((e): e is LibraryEntry => e !== null);
      if (valid.length === 0) {
        saveLibrary([]);
        return;
      }

      setLoadProgress({ loaded: 0, total: valid.length });
      for (let i = 0; i < valid.length; i++) {
        const entry = valid[i];
        try {
          const res = await window.mozzie!.readFile(entry.path);
          if (res.ok && res.data.byteLength <= 100 * 1024 * 1024) {
            const name =
              entry.name || entry.path.split(/[\\/]/).pop() || entry.path;
            const hash = await hashArrayBuffer(res.data);
            await addTrackFromArrayBuffer(
              name,
              entry.path,
              res.data,
              null,
              entry.path,
              hash,
            );
          }
        } catch {
          /* skip */
        }
        setLoadProgress({ loaded: i + 1, total: valid.length });
      }

      loadProgressTimerRef.current = window.setTimeout(() => {
        setLoadProgress(null);
        loadProgressTimerRef.current = null;
      }, 600);
    })();
  }, []);

  const librarySignature = useMemo(
    () => tracks.map((t) => `${t.sourcePath ?? ""}|${t.name}`).join("\n"),
    [tracks],
  );
  useEffect(() => {
    const entries: LibraryEntry[] = tracks
      .filter((t) => t.sourcePath)
      .map((t) => ({ path: t.sourcePath!, name: t.name }));
    saveLibrary(entries);
  }, [librarySignature]);

  // ✅ Sincroniza el contexto de reproducción a medida que se cargan nuevas canciones
  // (solo si el usuario no ha aplicado un filtro de búsqueda manual)
  useEffect(() => {
    if (!searchQuery.trim()) {
      setPlaybackContext(tracks.map((t) => t.id));
    }
  }, [tracks, searchQuery]);

  const playExclusive = useCallback(
    (id: string) => {
      if (globalTheme.singlePlayback) {
        tracks.forEach((t) => {
          if (t.id !== id && t.isPlaying) pauseTrack(t.id);
        });
      }
      playTrack(id);
    },
    [globalTheme.singlePlayback, tracks, pauseTrack, playTrack],
  );

  type LoadMode = "replace" | "reopen";

  const loadPathsIntoLibrary = useCallback(
    async (
      paths: string[],
      autoPlayFirst: boolean,
      mode: LoadMode = "replace",
    ): Promise<string[]> => {
      if (!window.mozzie || paths.length === 0) return [];

      if (loadProgressTimerRef.current !== null) {
        window.clearTimeout(loadProgressTimerRef.current);
        loadProgressTimerRef.current = null;
      }
      setLoadProgress({ loaded: 0, total: paths.length });

      const snapshot = (stateRef.current?.tracks ?? []) as Track[];
      const existingByPath = new Map<string, Track>();
      const existingByName = new Map<string, Track>();
      for (const t of snapshot) {
        if (t.sourcePath) existingByPath.set(t.sourcePath, t);
        existingByName.set(t.name, t);
      }

      const addedIds: (string | null)[] = new Array(paths.length).fill(null);
      const addedNamesInBatch = new Map<string, string>();
      let loadedCount = 0;

      const processPath = async (p: string, index: number) => {
        try {
          const res = await window.mozzie.readFile(p);
          if (!res.ok) return;
          if (res.data.byteLength > 100 * 1024 * 1024) {
            console.warn(`Omitiendo archivo >100MB: ${p}`);
            return;
          }
          const name = p.split(/[\\/]/).pop() ?? p;
          const hash = await hashArrayBuffer(res.data);

          let toRemove: Track | null = null;
          if (mode === "reopen") {
            const existing = existingByPath.get(p);
            if (existing) {
              if (existing.contentHash && existing.contentHash === hash) return;
              toRemove = existing;
            }
          } else {
            const existing = existingByName.get(name);
            if (existing) toRemove = existing;
          }

          if (toRemove) {
            removeTrack(toRemove.id);
            existingByName.delete(toRemove.name);
            if (toRemove.sourcePath) existingByPath.delete(toRemove.sourcePath);
          }

          const priorInBatch = addedNamesInBatch.get(name);
          if (priorInBatch) {
            removeTrack(priorInBatch);
          }

          const id = await addTrackFromArrayBuffer(name, p, res.data, null, p, hash);
          addedIds[index] = id;
          addedNamesInBatch.set(name, id);
        } catch (err) {
          console.warn("Error procesando archivo:", err);
        } finally {
          loadedCount++;
          setLoadProgress({ loaded: loadedCount, total: paths.length });
        }
      };

      // ✅ PROCESAMIENTO CONCURRENTE: Leemos 3 archivos a la vez
      const queue = paths.map((p, i) => ({ p, i }));
      const CONCURRENCY_LIMIT = 3;
      const workers = Array(Math.min(CONCURRENCY_LIMIT, paths.length))
        .fill(null)
        .map(async () => {
          while (queue.length > 0) {
            const task = queue.shift();
            if (task) await processPath(task.p, task.i);
          }
        });

      await Promise.all(workers);

      loadProgressTimerRef.current = window.setTimeout(() => {
        setLoadProgress(null);
        loadProgressTimerRef.current = null;
      }, 600);

      const validIds = addedIds.filter((id): id is string => id !== null);

      if (autoPlayFirst && validIds[0]) {
        setSelectedTrackId(validIds[0]);
        playExclusive(validIds[0]);
      }
      return validIds;
    },
    [addTrackFromArrayBuffer, removeTrack, playExclusive],
  );

  const handleOpenFiles = useCallback(async () => {
    if (!window.mozzie) return;
    setActiveDropdown(null);
    const paths = await window.mozzie.openFiles();
    await loadPathsIntoLibrary(paths, false, "replace");
  }, [loadPathsIntoLibrary]);

  const handleOpenFolder = useCallback(async () => {
    if (!window.mozzie) return;
    setActiveDropdown(null);

    const result = await window.mozzie.openFolder();
    if (!result) return;

    const folderNorm = result.folder.replace(/\\/g, "/");
    const isReopen = openedFolders.some(
      (f) => f.replace(/\\/g, "/") === folderNorm,
    );

    if (!isReopen) {
      setOpenedFolders((prev) => [...prev, folderNorm]);
    }

    if (result.files.length === 0) return;

    const mode: LoadMode = isReopen ? "reopen" : "replace";
    await loadPathsIntoLibrary(result.files, false, mode);
  }, [loadPathsIntoLibrary, openedFolders]);

  const handleReload = useCallback(async () => {
    if (!window.mozzie) return;
    setActiveDropdown(null);

    if (openedFolders.length === 0) {
      alert(
        "No hay carpetas abiertas para recargar. Usa 'Abrir carpeta' primero.",
      );
      return;
    }

    const allFiles: string[] = [];
    for (const folder of openedFolders) {
      try {
        const files = await window.mozzie.scanFolder(folder);
        if (Array.isArray(files)) allFiles.push(...files);
      } catch (err) {
        console.warn("No se pudo escanear carpeta:", folder, err);
      }
    }

    if (allFiles.length === 0) {
      alert("No se encontraron archivos de audio en las carpetas abiertas.");
      return;
    }

    await loadPathsIntoLibrary(allFiles, false, "reopen");
  }, [openedFolders, loadPathsIntoLibrary]);

  const handleSortSelect = (type: "name" | "artist" | "date") => {
    if (sortBy === type) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(type);
      setSortDir("asc");
    }
  };

  const handleShuffle = () => {
    const shuffled = [...tracks].sort(() => Math.random() - 0.5);
    reorderTracks(shuffled.map((t) => t.id));
    setSortBy("manual");
    setActiveDropdown(null);
  };

  const enterSelectMode = () => {
    setIsSelectMode(true);
    setSelectedForAction(new Set());
  };

  const exitSelectMode = () => {
    setIsSelectMode(false);
    setSelectedForAction(new Set());
  };

  const toggleSelection = (id: string) => {
    setSelectedForAction((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const deleteTracks = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      ids.forEach((id) => removeTrack(id));
      setSelectedTrackId((prev) => (prev && ids.includes(prev) ? null : prev));
    },
    [removeTrack],
  );

  const requestDeleteTracks = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      if (dontAskDeleteRef.current) {
        deleteTracks(ids);
        return;
      }
      setPendingDelete(ids);
    },
    [deleteTracks],
  );

  const handleConfirmPendingDelete = (dontAskAgain: boolean) => {
    if (dontAskAgain) dontAskDeleteRef.current = true;
    if (pendingDelete) deleteTracks(pendingDelete);
    setPendingDelete(null);
    exitSelectMode();
  };

  const handleConfirmDeleteSelected = () => {
    if (selectedForAction.size === 0) return;
    requestDeleteTracks(Array.from(selectedForAction));
  };

  const handleCreatePlaylistFromSelection = () => {
    const paths = tracks
      .filter((t) => selectedForAction.has(t.id) && t.sourcePath)
      .map((t) => t.sourcePath!);
    if (paths.length === 0) {
      alert(
        "Las canciones seleccionadas no están asociadas a archivos del disco.",
      );
      return;
    }
    setPlaylistModalPreselect(paths);
    setPlaylistModalOpen(true);
  };

  const handleClearAll = () => {
    clearAll();
    saveLibrary([]);
    setSelectedTrackId(null);
    coverProcessedRef.current.clear();
    paletteProcessedRef.current.clear();
  };

  const handleProgressChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!selectedTrack) return;
    const t = (Number(e.target.value) / 1000) * selectedTrack.duration;
    seekTrack(selectedTrack.id, t);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!selectedTrack) return;
    setTrackVolume(selectedTrack.id, Number(e.target.value));
  };

  const togglePinSettings = () => {
    if (globalTheme.pinnedSettings) {
      // ✅ Al desfijar: restauramos los ajustes previos
      if (selectedTrackId && prePinSettingsRef.current) {
        const p = prePinSettingsRef.current;
        setTrackBaseRate(selectedTrackId, p.rpm);
        setTrackEQ(selectedTrackId, "low", p.eq.low);
        setTrackEQ(selectedTrackId, "mid", p.eq.mid);
        setTrackEQ(selectedTrackId, "high", p.eq.high);
        setTrackPan(selectedTrackId, p.pan);
        setTrackReverb(selectedTrackId, p.reverb);
        setTrackVolume(selectedTrackId, p.volume);
      }
      prePinSettingsRef.current = null;
      // Actualizamos el tema (solo el estado, sin efectos secundarios)
      setGlobalTheme({ pinnedSettings: false, pinnedPreset: null });
    } else {
      // ✅ Al fijar: guardamos los ajustes actuales
      if (selectedTrack) {
        prePinSettingsRef.current = {
          rpm: selectedTrack.baseRate,
          eq: { ...selectedTrack.eq },
          pan: selectedTrack.pan,
          reverb: selectedTrack.reverb,
          volume: selectedTrack.volume,
        };
        // Actualizamos el tema
        setGlobalTheme({
          pinnedSettings: true,
          pinnedPreset: {
            rpm: selectedTrack.baseRate,
            eq: { ...selectedTrack.eq },
            pan: selectedTrack.pan,
            reverb: selectedTrack.reverb,
            volume: selectedTrack.volume,
          },
        });
      }
    }
  };

  useEffect(() => {
    if (
      globalTheme.pinnedSettings &&
      globalTheme.pinnedPreset &&
      selectedTrackId
    ) {
      const p = globalTheme.pinnedPreset;
      // ✅ Usamos setTrackBaseRate (instantáneo) en lugar de Smooth
      setTrackBaseRate(selectedTrackId, p.rpm);
      setTrackEQ(selectedTrackId, "low", p.eq.low);
      setTrackEQ(selectedTrackId, "mid", p.eq.mid);
      setTrackEQ(selectedTrackId, "high", p.eq.high);
      setTrackPan(selectedTrackId, p.pan);
      setTrackReverb(selectedTrackId, p.reverb);
      setTrackVolume(selectedTrackId, p.volume ?? 0.8); // <--- AÑADIDO
    }
  }, [
    selectedTrackId,
    globalTheme.pinnedSettings,
    globalTheme.pinnedPreset,
    setTrackBaseRate, // <--- AQUÍ ESTABA EL ERROR
    setTrackEQ,
    setTrackPan,
    setTrackReverb,
    setTrackVolume,
  ]);

    // Sincronizar los cambios manuales (sliders) con el preset fijado
    // Sincronizar los cambios manuales (sliders) con el preset fijado
  useEffect(() => {
    if (
      globalTheme.pinnedSettings &&
      selectedTrack &&
      prevTrackIdRef.current === selectedTrack.id
    ) {
      // Usamos un temporizador para no saturar el localStorage mientras se arrastra el slider
      const timer = setTimeout(() => {
        setGlobalTheme({
          pinnedPreset: {
            rpm: selectedTrack.baseRate,
            eq: { ...selectedTrack.eq },
            pan: selectedTrack.pan,
            reverb: selectedTrack.reverb,
            volume: selectedTrack.volume,
          },
        });
      }, 300); // Espera 300ms después de que el usuario suelte el slider

      return () => clearTimeout(timer);
    }
    prevTrackIdRef.current = selectedTrack?.id ?? null;
  }, [
    selectedTrack?.id,
    selectedTrack?.baseRate,
    selectedTrack?.eq.low,
    selectedTrack?.eq.mid,
    selectedTrack?.eq.high,
    selectedTrack?.pan,
    selectedTrack?.reverb,
    selectedTrack?.volume,
    globalTheme.pinnedSettings,
    setGlobalTheme,
  ]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "F11" && globalTheme.enableF11Fullscreen) {
        e.preventDefault();
        if (!document.fullscreenElement)
          document.documentElement.requestFullscreen();
        else document.exitFullscreen();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [globalTheme.enableF11Fullscreen]);

  const isAnyPlaying = tracks.some((t) => t.isPlaying);
  useEffect(() => {
    if (!window.mozzie) return;
    if (isAnyPlaying && globalTheme.blockSleep) window.mozzie.blockSleep();
    else window.mozzie.unblockSleep();
  }, [isAnyPlaying, globalTheme.blockSleep]);

  const handlePlayModeCycle = useCallback(() => {
    const modes: ("single" | "continuous" | "loop")[] = [
      "single",
      "continuous",
      "loop",
    ];
    const idx = modes.indexOf(globalTheme.playMode);
    setGlobalTheme({ playMode: modes[(idx + 1) % modes.length] });
  }, [globalTheme.playMode, setGlobalTheme]);

  const handleRpmChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!selectedTrackId) return;
    setTrackBaseRateSmooth(
      selectedTrackId,
      Number(e.target.value) / RPM_BASE,
      400,
    );
  };

  const handleDirectionToggle = () => {
    if (!selectedTrackId || !selectedTrack) return;
    setTrackDirection(selectedTrackId, selectedTrack.direction === 1 ? -1 : 1);
  };

  const startEditRpm = () => {
    if (!selectedTrack) return;
    setRpmDraft(rpm.toFixed(2));
    setEditingRpm(true);
  };

  const commitEditRpm = () => {
    setEditingRpm(false);
    if (!selectedTrackId) return;
    const parsed = parseFloat(rpmDraft.replace(",", "."));
    if (isNaN(parsed)) return;
    setTrackBaseRateSmooth(
      selectedTrackId,
      Math.max(8, Math.min(100, parsed)) / RPM_BASE,
      700,
    );
  };

  const resetRpm = () => {
    if (!selectedTrackId) return;
    setTrackBaseRateSmooth(selectedTrackId, 1, 500);
  };

  const handleEqChange =
    (band: "low" | "mid" | "high") =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!selectedTrackId) return;
      setTrackEQ(selectedTrackId, band, Number(e.target.value));
    };

  const handlePanChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!selectedTrackId) return;
    setTrackPan(selectedTrackId, Number(e.target.value));
  };

  const handleReverbChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!selectedTrackId) return;
    setTrackReverb(selectedTrackId, Number(e.target.value));
  };

  const formatPan = (v: number) => {
    if (Math.abs(v) < 0.02) return "C";
    return `${v < 0 ? "L" : "R"}${Math.round(Math.abs(v) * 100)}`;
  };

  const handleSwipe = useCallback(
    (direction: "left" | "right") => {
      // ✅ NUEVO: Ignorar swipe mientras el programa está cargando
      if (stateRef.current?.isLoading) return;
      if (!selectedTrackId || tracks.length === 0) return;
      const context =
        playbackContext.length > 0 ? playbackContext : tracks.map((t) => t.id);
      const idx = context.indexOf(selectedTrackId);
      if (idx < 0) return;

      const newIdx =
        direction === "right"
          ? (idx - 1 + context.length) % context.length
          : (idx + 1) % context.length;
      const newTrackId = context[newIdx];

      setSelectedTrackId(newTrackId);
      if (globalTheme.singlePlayback && selectedTrack?.isPlaying) {
        pauseTrack(selectedTrackId);
        playTrack(newTrackId);
      }
    },
    [
      tracks,
      selectedTrackId,
      playbackContext,
      globalTheme.singlePlayback,
      selectedTrack,
      pauseTrack,
      playTrack,
    ],
  );

  const candidateGroups = useMemo<CandidateGroup[]>(() => {
    const groups: CandidateGroup[] = [];
    const inboxTracks = tracks
      .filter((t) => t.sourcePath)
      .map((t) => ({ path: t.sourcePath!, name: t.name }));
    if (inboxTracks.length > 0)
      groups.push({ label: "📥 Bandeja de entrada", tracks: inboxTracks });
    for (const pl of playlists) {
      groups.push({
        label: `🎵 ${pl.name}`,
        tracks: pl.trackPaths.map((p) => ({
          path: p,
          name: p.split(/[\\/]/).pop() ?? p,
        })),
      });
    }
    return groups;
  }, [
    tracks.map((t) => t.sourcePath).join("|"),
    playlists.map((p) => `${p.id}|${p.trackPaths.length}`).join("|"),
  ]);

  const handleSaveAsPlaylist = () => {
    if (
      !tracks.some((t) => t.sourcePath) &&
      !playlists.some((p) => p.trackPaths.length > 0)
    ) {
      alert("No hay canciones para incluir en una playlist.");
      return;
    }
    setPlaylistModalPreselect(null);
    setPlaylistModalOpen(true);
  };

  const initialSelectedPaths = useMemo(() => {
    if (playlistModalPreselect) return playlistModalPreselect;
    if (activePlaylistId !== null) return [];
    return tracks.filter((t) => t.sourcePath).map((t) => t.sourcePath!);
  }, [
    playlistModalPreselect,
    activePlaylistId,
    tracks.map((t) => t.sourcePath).join("|"),
  ]);

  const handlePlayFromPlaylist = async (
    playlist: Playlist,
    trackIndex: number,
  ) => {
    if (isLoadingPlaylist) return;
    setIsLoadingPlaylist(true);
    try {
      clearAll();
      setSelectedTrackId(null);
      coverProcessedRef.current.clear();
      paletteProcessedRef.current.clear();
      const ids = await loadPathsIntoLibrary(playlist.trackPaths, false);
      setPlaybackContext(ids);
      setActivePlaylistId(playlist.id);
      if (ids[trackIndex]) {
        setSelectedTrackId(ids[trackIndex]);
        playExclusive(ids[trackIndex]);
      }
      setAppMode("player");
    } finally {
      setIsLoadingPlaylist(false);
    }
  };

  const handleBackToInbox = useCallback(async () => {
    if (isLoadingPlaylist) return;
    setIsLoadingPlaylist(true);
    try {
      clearAll();
      setSelectedTrackId(null);
      setActivePlaylistId(null);
      setPlaybackContext([]);
      coverProcessedRef.current.clear();
      paletteProcessedRef.current.clear();
      const inbox = loadLibrary();
      if (inbox.length > 0)
        await loadPathsIntoLibrary(
          inbox.map((e) => e.path),
          false,
        );
    } finally {
      setIsLoadingPlaylist(false);
    }
  }, [isLoadingPlaylist, clearAll, loadPathsIntoLibrary]);

  const onScratchStart = useCallback(() => {
    if (controlsRef.current) controlsRef.current.enabled = false;
    if (selectedTrackId) {
      beginScratch(selectedTrackId);
      setTrackRate(selectedTrackId, 0.001);
    }
  }, [selectedTrackId, setTrackRate, beginScratch]);

  const onScratchRate = useCallback(
    (rate: number) => {
      if (selectedTrackId) setTrackRate(selectedTrackId, rate);
    },
    [selectedTrackId, setTrackRate],
  );

  const onScratchEnd = useCallback(() => {
    if (controlsRef.current) controlsRef.current.enabled = true;
    if (!selectedTrackId) return;
    endScratch(selectedTrackId);
    const dir = selectedTrack?.direction ?? 1;
    const target = dir * (selectedTrack?.baseRate ?? 1);
    const start = performance.now();
    const tick = () => {
      const t = Math.min((performance.now() - start) / 80, 1);
      setTrackRate(
        selectedTrackId,
        (dir > 0 ? 0.001 : -0.001) + (target - (dir > 0 ? 0.001 : -0.001)) * t,
      );
      if (t < 1) requestAnimationFrame(tick);
    };
    tick();
  }, [selectedTrackId, selectedTrack, setTrackRate, endScratch]);

  const handleSelectTrack = useCallback(
    (id: string) => {
      setPlaybackContext(displayedTracks.map((t) => t.id));
      const s = stateRef.current;
      if (
        s.singlePlayback &&
        s.selectedTrack?.isPlaying &&
        id !== s.selectedTrackId
      ) {
        s.tracks.forEach((t: Track) => {
          if (t.id !== id && t.isPlaying) pauseTrack(t.id);
        });
        playTrack(id);
      }
      setSelectedTrackId(id);
    },
    [displayedTracks, pauseTrack, playTrack],
  );

  const handleToggleTrack = useCallback(
    (id: string) => {
      setSelectedTrackId(id);
      toggleTrack(id);
    },
    [toggleTrack],
  );

  const handleReorder = useCallback(
    (newIds: string[]) => {
      if (sortBy !== "manual") setSortBy("manual");

      if (!searchQuery.trim()) {
        reorderTracks(newIds);
        return;
      }

      const visibleIds = displayedTracks.map((t) => t.id);
      const visiblePositions: number[] = [];
      tracks.forEach((t, i) => {
        if (visibleIds.includes(t.id)) visiblePositions.push(i);
      });

      const reordered = [...tracks];
      newIds.forEach((newId, k) => {
        const pos = visiblePositions[k];
        const newTrack = tracks.find((t) => t.id === newId);
        if (newTrack && pos !== undefined) reordered[pos] = newTrack;
      });

      reorderTracks(reordered.map((t) => t.id));
    },
    [tracks, displayedTracks, searchQuery, sortBy, reorderTracks],
  );

  const pendingDeleteInfo = useMemo(() => {
    if (!pendingDelete || pendingDelete.length === 0) return null;
    if (pendingDelete.length === 1) {
      const t = tracks.find((tr) => tr.id === pendingDelete[0]);
      return {
        title: "Eliminar canción",
        message: `¿Seguro que quieres eliminar "${t?.name ?? "esta canción"}" de la biblioteca? Esta acción no se puede deshacer.`,
      };
    }
    return {
      title: `Eliminar ${pendingDelete.length} canciones`,
      message: `¿Seguro que quieres eliminar ${pendingDelete.length} canciones de la biblioteca? Esta acción no se puede deshacer.`,
    };
  }, [pendingDelete, tracks]);

  const bgRef = useRef<HTMLDivElement>(null);
  const miniBgRef = useRef<HTMLDivElement>(null);
  const currentBrightness = useRef(1);

  useEffect(() => {
    let raf: number;
    const tick = () => {
      const target =
        globalTheme.reactiveLights && selectedTrack?.isPlaying
          ? 0.8 + getAnalyserVolume() * 0.5
          : 1;

      currentBrightness.current +=
        (target - currentBrightness.current) * globalTheme.lightSmoothing;

      const filter = `brightness(${currentBrightness.current})`;
      if (bgRef.current) bgRef.current.style.filter = filter;
      if (miniBgRef.current) miniBgRef.current.style.filter = filter;

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [
    globalTheme.reactiveLights,
    selectedTrack?.isPlaying,
    globalTheme.lightSmoothing,
    getAnalyserVolume,
  ]);

  const handleRefreshCovers = async () => {
    if (!coverGallery || isRefreshingCovers) return;
    setIsRefreshingCovers(true);
    try {
      const track = tracks.find((t) => t.id === coverGallery.trackId);
      if (track) {
        const { covers } = await getCoverArt(track.file, coverSearchName, coverSearchArtist);
        if (covers.length > 0) {
          setTrackAvailableCovers(track.id, covers);
          setCoverGallery({ trackId: track.id, covers });
        }
      }
    } catch (err) {
      console.error("Error al refrescar carátulas", err);
    } finally {
      setIsRefreshingCovers(false);
    }
  };

  return (
    <>
      <div className="titlebar-drag" />
      <div id="app" className={appMode === "playlists" ? "playlist-mode" : ""}>
        <aside id="sidebar">
          <div className="sidebar-view-header">
            {loadProgress && loadProgress.total > 0 && (
              <div
                className="load-progress-bg"
                style={{
                  width: `${(loadProgress.loaded / loadProgress.total) * 100}%`,
                }}
              />
            )}
            {activePlaylistId ? (
              <>
                <span className="view-name">
                  🎵{" "}
                  {playlists.find((p) => p.id === activePlaylistId)?.name ??
                    "Playlist"}
                </span>
                <button
                  className="view-inbox-btn"
                  onClick={handleBackToInbox}
                  disabled={isLoadingPlaylist}
                  title="Volver a la bandeja de entrada"
                >
                  📥 Inbox
                </button>
              </>
            ) : (
              <span className="view-name">📥 Bandeja de entrada</span>
            )}
          </div>
          {appMode === "player" ? (
            <>
              <div className="sidebar-controls">
                <div className="sidebar-search-row">
                  <input
                    type="text"
                    className="search-input"
                    placeholder="Buscar canciones..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                  <div className="dropdown-container">
                    <button
                      className="toolbar-btn icon-btn"
                      title="Filtrar"
                      onClick={() =>
                        setActiveDropdown(
                          activeDropdown === "filter" ? null : "filter",
                        )
                      }
                    >
                      ▼
                    </button>
                    {activeDropdown === "filter" && (
                      <ul className="dropdown-menu dropdown-right">
                        <li
                          onClick={() => handleSortSelect("name")}
                          className={sortBy === "name" ? "active" : ""}
                        >
                          Por nombre
                          {sortBy === "name"
                            ? sortDir === "asc"
                              ? " ↑"
                              : " ↓"
                            : ""}
                        </li>
                        <li
                          onClick={() => handleSortSelect("artist")}
                          className={sortBy === "artist" ? "active" : ""}
                        >
                          Por artista
                          {sortBy === "artist"
                            ? sortDir === "asc"
                              ? " ↑"
                              : " ↓"
                            : ""}
                        </li>
                        <li
                          onClick={() => handleSortSelect("date")}
                          className={sortBy === "date" ? "active" : ""}
                        >
                          Por fecha
                          {sortBy === "date"
                            ? sortDir === "asc"
                              ? " ↑"
                              : " ↓"
                            : ""}
                        </li>
                        <li onClick={handleShuffle}>Aleatorio</li>
                      </ul>
                    )}
                  </div>
                </div>

                <div className="sidebar-toolbar">
                  {isSelectMode ? (
                    <>
                      <button
                        className="toolbar-btn flex-1"
                        onClick={exitSelectMode}
                        title="Cancelar selección"
                      >
                        Cancelar
                      </button>
                      <button
                        className="toolbar-btn flex-1"
                        onClick={handleCreatePlaylistFromSelection}
                        disabled={selectedForAction.size === 0}
                        title="Crear playlist"
                      >
                        🎵 Playlist
                      </button>
                      <button
                        className="toolbar-btn danger flex-1"
                        onClick={handleConfirmDeleteSelected}
                        disabled={selectedForAction.size === 0}
                        title="Eliminar canciones"
                      >
                        Eliminar
                        {selectedForAction.size > 0
                          ? ` (${selectedForAction.size})`
                          : ""}
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="dropdown-container flex-1">
                        <button
                          className="toolbar-btn w-full"
                          onClick={() =>
                            setActiveDropdown(
                              activeDropdown === "open" ? null : "open",
                            )
                          }
                        >
                          Abrir ▼
                        </button>
                        {activeDropdown === "open" && (
                          <ul className="dropdown-menu">
                            <li onClick={handleOpenFiles}>📁 Abrir archivos</li>
                            <li onClick={handleOpenFolder}>📂 Abrir carpeta</li>
                            <li onClick={handleReload}>↻ Recargar carpetas</li>
                          </ul>
                        )}
                      </div>
                      <button
                        className="toolbar-btn icon-btn"
                        title="Seleccionar canciones"
                        onClick={enterSelectMode}
                        disabled={displayedTracks.length === 0}
                      >
                        ☑
                      </button>
                    </>
                  )}
                </div>
              </div>

              {activeDropdown && (
                <div
                  className="dropdown-backdrop"
                  onClick={() => setActiveDropdown(null)}
                />
              )}

              {isSelectMode && displayedTracks.length > 0 && (
                <label className="select-all-row">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someVisibleSelected;
                    }}
                    onChange={toggleSelectAll}
                  />
                  <span>
                    {allVisibleSelected
                      ? "Deseleccionar todo"
                      : "Seleccionar todo"}
                    {displayedTracks.length < tracks.length
                      ? ` (${displayedTracks.length} de ${tracks.length})`
                      : ` (${displayedTracks.length})`}
                  </span>
                </label>
              )}

              <Reorder.Group
                axis="y"
                id="track-list"
                values={displayedTracks.map((t) => t.id)}
                onReorder={handleReorder}
              >
                {displayedTracks.length === 0 && (
                  <li className="empty">
                    {searchQuery
                      ? "No se encontraron canciones"
                      : "Sin canciones cargadas"}
                  </li>
                )}
                {displayedTracks.map((track) => (
                  <TrackItem
                    key={track.id}
                    id={track.id}
                    name={track.name}
                    isPlaying={track.isPlaying}
                    isSelected={track.id === selectedTrackId}
                    isSelectMode={isSelectMode}
                    isChecked={selectedForAction.has(track.id)}
                    onSelect={handleSelectTrack}
                    onToggle={handleToggleTrack}
                    onCheck={toggleSelection}
                    onRequestDelete={(id) => requestDeleteTracks([id])}
                  />
                ))}
              </Reorder.Group>

              <div className="sidebar-footer-actions">
                <button
                  className="customize-btn"
                  onClick={() => setAppMode("playlists")}
                >
                  🎵 Playlists
                </button>
                <button
                  className="customize-btn"
                  onClick={() => setCustomizeOpen(true)}
                >
                  ⚙️ Personalización
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="sidebar-mini-3d" style={{ position: "relative" }}>
                <div
                  ref={miniBgRef}
                  style={{
                    position: "absolute",
                    inset: 0,
                    background: globalTheme.bgGradient
                      ? `linear-gradient(135deg, ${animatedTheme.bg1}, ${animatedTheme.bg2})`
                      : animatedTheme.bg1,
                    transition: "background 0.5s ease",
                    zIndex: 0,
                  }}
                />
                <Canvas
                  camera={{ position: [0, 14, 18], fov: 45 }}
                  gl={{ alpha: true }}
                  style={{ position: "relative", zIndex: 1 }}
                >
                  {globalTheme.reactiveLights && selectedTrack?.isPlaying ? (
                    <ReactiveLights
                      baseIntensity={0.55}
                      isPlaying={true}
                      getVolume={getAnalyserVolume}
                      active={true}
                      smoothing={globalTheme.lightSmoothing} // <--- AÑADIR ESTO
                    />
                  ) : (
                    <ambientLight intensity={0.55} />
                  )}
                  <ResponsiveCamera baseFov={45} baseAspect={1.5} />
                  <directionalLight position={[5, 10, 6]} intensity={1.4} />
                  <directionalLight
                    position={[-6, 5, -7]}
                    intensity={0.7}
                    color={animatedTheme.primary}
                  />
                  <ScratchableVinyl
                    isPlaying={selectedTrack?.isPlaying ?? false}
                    coverUrl={selectedTrack?.coverUrl ?? DEFAULT_COVER}
                    baseRate={selectedTrack?.baseRate ?? 1}
                    direction={selectedTrack?.direction ?? 1}
                    spinDirection={globalTheme.vinylSpinDirection}
                    onScratchStart={onScratchStart}
                    onScratchRate={onScratchRate}
                    onScratchEnd={onScratchEnd}
                    onSwipe={handleSwipe}
                  />
                  <OrbitControls
                    ref={controlsRef}
                    makeDefault
                    enableDamping
                    dampingFactor={0.08}
                    enablePan={false}
                    minPolarAngle={0.15}
                    maxPolarAngle={Math.PI - 0.1}
                    minDistance={5}
                    maxDistance={30}
                    mouseButtons={{
                      LEFT: null,
                      MIDDLE: THREE.MOUSE.ROTATE,
                      RIGHT: null,
                    }}
                  />
                </Canvas>
              </div>
              <div className="sidebar-mini-info">
                <div className="section-title">En reproducción</div>
                {selectedTrack ? (
                  <>
                    <div className="mini-info-name">{selectedTrack.name}</div>
                    <div className="mini-info-time">
                      {formatTime(selectedTrack.currentTime)} /{" "}
                      {formatTime(selectedTrack.duration)}
                    </div>
                  </>
                ) : (
                  <div className="mini-info-empty">
                    Ninguna pista seleccionada
                  </div>
                )}
              </div>
              <div className="sidebar-footer-actions">
                <button
                  className="customize-btn"
                  onClick={() => setAppMode("player")}
                >
                  ◀ Volver al reproductor
                </button>
              </div>
            </>
          )}
        </aside>

        <main id="main">
          {appMode === "player" ? (
            <>
              <section id="viewport" style={{ position: "relative" }}>
                <div
                  ref={bgRef}
                  style={{
                    position: "absolute",
                    inset: 0,
                    background: globalTheme.bgGradient
                      ? `linear-gradient(135deg, ${animatedTheme.bg1}, ${animatedTheme.bg2})`
                      : animatedTheme.bg1,
                    transition: "background 0.5s ease",
                    zIndex: 0,
                  }}
                />
                <Canvas
                  camera={{ position: [0, 14, 18], fov: 45 }}
                  gl={{ alpha: true }}
                  style={{ position: "relative", zIndex: 1 }}
                >
                  <ResponsiveCamera baseFov={45} baseAspect={1.5} />
                  {globalTheme.reactiveLights && selectedTrack?.isPlaying ? (
                    <ReactiveLights
                      baseIntensity={0.55}
                      isPlaying={true}
                      getVolume={getAnalyserVolume}
                      active={true}
                      smoothing={globalTheme.lightSmoothing} // <--- AÑADIR ESTO
                    />
                  ) : (
                    <ambientLight intensity={0.55} />
                  )}
                  <directionalLight position={[5, 10, 6]} intensity={1.4} />
                  <directionalLight
                    position={[-6, 5, -7]}
                    intensity={0.7}
                    color={animatedTheme.primary}
                  />
                  <ScratchableVinyl
                    isPlaying={selectedTrack?.isPlaying ?? false}
                    coverUrl={selectedTrack?.coverUrl ?? DEFAULT_COVER}
                    baseRate={selectedTrack?.baseRate ?? 1}
                    direction={selectedTrack?.direction ?? 1}
                    spinDirection={globalTheme.vinylSpinDirection}
                    onScratchStart={onScratchStart}
                    onScratchRate={onScratchRate}
                    onScratchEnd={onScratchEnd}
                    onSwipe={handleSwipe}
                  />
                  <OrbitControls
                    ref={controlsRef}
                    makeDefault
                    enableDamping
                    dampingFactor={0.08}
                    enablePan={false}
                    minPolarAngle={0.1}
                    maxPolarAngle={Math.PI - 0.1}
                    minDistance={5}
                    maxDistance={30}
                    mouseButtons={{
                      LEFT: null,
                      MIDDLE: THREE.MOUSE.ROTATE,
                      RIGHT: null,
                    }}
                  />
                </Canvas>
              </section>

              <footer id="controls">
                <button
                  id="play-pause"
                  disabled={!selectedTrack}
                  onClick={() => selectedTrack && toggleTrack(selectedTrack.id)}
                >
                  {selectedTrack?.isPlaying ? "⏸" : "▶"}
                </button>
                <button
                  id="playmode-btn"
                  className={globalTheme.playMode !== "single" ? "active" : ""}
                  onClick={handlePlayModeCycle}
                  title={PLAY_MODE_LABEL[globalTheme.playMode]}
                >
                  {PLAY_MODE_ICON[globalTheme.playMode]}
                </button>
                <span id="time-current">
                  {formatTime(selectedTrack?.currentTime ?? 0)}
                </span>
                <input
                  type="range"
                  id="progress"
                  min="0"
                  max="1000"
                  disabled={!selectedTrack}
                  value={
                    selectedTrack?.duration
                      ? (selectedTrack.currentTime / selectedTrack.duration) *
                        1000
                      : 0
                  }
                  onChange={handleProgressChange}
                />
                <span id="time-total">
                  {formatTime(selectedTrack?.duration ?? 0)}
                </span>
                <input
                  type="range"
                  id="volume"
                  min="0"
                  max="1"
                  step="0.01"
                  disabled={!selectedTrack}
                  value={selectedTrack?.volume ?? 0.8}
                  onChange={handleVolumeChange}
                />
              </footer>
            </>
          ) : (
            <section id="playlist-view">
              <PlaylistGrid
                playlists={playlists}
                selectedId={selectedPlaylistId}
                isLoading={isLoadingPlaylist}
                onSelect={setSelectedPlaylistId}
                onCreateFromCurrent={handleSaveAsPlaylist}
                onDelete={(id) => {
                  setPlaylists((prev) => prev.filter((p) => p.id !== id));
                  if (selectedPlaylistId === id) setSelectedPlaylistId(null);
                }}
              />
            </section>
          )}
        </main>
        {appMode === "playlists" && (
          <aside id="playlist-sidebar">
            <PlaylistDetail
              playlist={
                playlists.find((p) => p.id === selectedPlaylistId) ?? null
              }
              onPlayTrack={handlePlayFromPlaylist}
            />
          </aside>
        )}
      </div>

      {appMode === "player" && (
        <div id="right-rail">
          <aside id="right-sidebar">
            {selectedTrack && (
              <div className="section">
                <div className="section-title">Carátula</div>
                  <div
                    className="cover-preview-container"
                    onClick={() => {
                      if (!selectedTrack) return;
                      setCoverSearchName(selectedTrack.name.replace(/\.[^.]+$/, ""));
                      // Intenta obtener el artista de los tags, si no está disponible, déjalo vacío
                      setCoverSearchArtist(""); 
                      setCoverGallery({
                        trackId: selectedTrack.id,
                        covers: selectedTrack.availableCovers || [],
                      });
                    }}
                  >
                  <img
                    src={selectedTrack.coverUrl ?? DEFAULT_COVER}
                    alt="Carátula actual"
                    className="cover-preview-img"
                  />
                  <div className="cover-preview-overlay">
                    <span>Cambiar Carátula</span>
                  </div>
                </div>
              </div>
            )}

            {/* ✅ MOVIDO AQUÍ: Tema del disco justo debajo de la carátula */}
            {selectedTrack && (
              <div className="section">
                <div className="section-title">Tema del disco</div>
                <div className="theme-mode-toggle">
                  <button
                    className={
                      selectedTrack.themeMode === "disc" ? "active" : ""
                    }
                    onClick={() => setTrackThemeMode(selectedTrack.id, "disc")}
                    disabled={!selectedTrack.themeColors}
                    title={
                      selectedTrack.themeColors
                        ? "Colores extraídos de la portada"
                        : "Esperando carátula…"
                    }
                  >
                    Disco
                  </button>
                  <button
                    className={
                      selectedTrack.themeMode === "custom" ? "active" : ""
                    }
                    onClick={() =>
                      setTrackThemeMode(selectedTrack.id, "custom")
                    }
                  >
                    Personalizado
                  </button>
                </div>
                {selectedTrack.themeMode === "disc" &&
                  selectedTrack.themeColors && (
                    <div className="theme-swatches">
                      <div
                        className="swatch"
                        style={{ background: selectedTrack.themeColors[0] }}
                        title={selectedTrack.themeColors[0]}
                      />
                      <div
                        className="swatch"
                        style={{ background: selectedTrack.themeColors[1] }}
                        title={selectedTrack.themeColors[1]}
                      />
                      {globalTheme.bgGradient && (
                        <div
                          className="swatch"
                          style={{ background: selectedTrack.themeColors[2] }}
                          title={selectedTrack.themeColors[2]}
                        />
                      )}
                    </div>
                  )}
                {selectedTrack.themeMode === "custom" && (
                  <div className="custom-colors">
                    <input
                      type="color"
                      value={selectedTrack.customThemeColors?.[0] ?? "#0e0e12"}
                      onChange={(e) =>
                        setTrackCustomThemeColors(selectedTrack.id, [
                          e.target.value,
                          selectedTrack.customThemeColors?.[1] ?? "#15151b",
                          selectedTrack.customThemeColors?.[2] ?? "#222222",
                        ])
                      }
                    />
                    <input
                      type="color"
                      value={selectedTrack.customThemeColors?.[1] ?? "#15151b"}
                      onChange={(e) =>
                        setTrackCustomThemeColors(selectedTrack.id, [
                          selectedTrack.customThemeColors?.[0] ?? "#0e0e12",
                          e.target.value,
                          selectedTrack.customThemeColors?.[2] ?? "#222222",
                        ])
                      }
                    />
                    {globalTheme.bgGradient && (
                      <input
                        type="color"
                        value={
                          selectedTrack.customThemeColors?.[2] ?? "#222222"
                        }
                        onChange={(e) =>
                          setTrackCustomThemeColors(selectedTrack.id, [
                            selectedTrack.customThemeColors?.[0] ?? "#0e0e12",
                            selectedTrack.customThemeColors?.[1] ?? "#15151b",
                            e.target.value,
                          ])
                        }
                      />
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="section">
              <div
                className="section-title"
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span>Velocidad</span>
                {/* ✅ SWITCH CON LABEL */}
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span
                    style={{
                      fontSize: "11px",
                      color: "var(--text-dim)",
                      textTransform: "none",
                      letterSpacing: "normal",
                    }}
                  >
                    Fijar ajustes
                  </span>
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={globalTheme.pinnedSettings}
                      onChange={togglePinSettings}
                    />
                    <span className="slider round"></span>
                  </label>
                </div>
              </div>
              {editingRpm ? (
                <input
                  type="text"
                  className="rpm-input"
                  value={rpmDraft}
                  onChange={(e) => setRpmDraft(e.target.value)}
                  onBlur={commitEditRpm}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitEditRpm();
                    if (e.key === "Escape") setEditingRpm(false);
                  }}
                  autoFocus
                  disabled={!selectedTrack}
                />
              ) : (
                <div
                  className="rpm-value"
                  onClick={startEditRpm}
                  title="Click para escribir un valor exacto"
                >
                  {rpm.toFixed(2)}
                </div>
              )}
              <div
                className="rpm-unit"
                onClick={resetRpm}
                title="Click para volver a 33.33 RPM"
              >
                RPM
              </div>
              <input
                type="range"
                min="8"
                max="100"
                step="0.1"
                value={rpm}
                disabled={!selectedTrack}
                onChange={handleRpmChange}
              />
            </div>

            <div className="section">
              <div className="section-title">Reverb</div>
              <div className="slider-row">
                <div className="slider-label">
                  <span>Mezcla</span>
                  <span className="value">{Math.round(reverb * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={reverb}
                  disabled={!selectedTrack}
                  onChange={handleReverbChange}
                />
              </div>
            </div>

            <div className="section">
              <div className="section-title">Ecualizador</div>
              <div className="slider-row">
                <div className="slider-label">
                  <span>Bajos</span>
                  <span className="value">
                    {eqLow > 0 ? "+" : ""}
                    {eqLow.toFixed(1)} dB
                  </span>
                </div>
                <input
                  type="range"
                  min="-12"
                  max="12"
                  step="0.5"
                  value={eqLow}
                  disabled={!selectedTrack}
                  onChange={handleEqChange("low")}
                />
              </div>
              <div className="slider-row">
                <div className="slider-label">
                  <span>Medios</span>
                  <span className="value">
                    {eqMid > 0 ? "+" : ""}
                    {eqMid.toFixed(1)} dB
                  </span>
                </div>
                <input
                  type="range"
                  min="-12"
                  max="12"
                  step="0.5"
                  value={eqMid}
                  disabled={!selectedTrack}
                  onChange={handleEqChange("mid")}
                />
              </div>
              <div className="slider-row">
                <div className="slider-label">
                  <span>Agudos</span>
                  <span className="value">
                    {eqHigh > 0 ? "+" : ""}
                    {eqHigh.toFixed(1)} dB
                  </span>
                </div>
                <input
                  type="range"
                  min="-12"
                  max="12"
                  step="0.5"
                  value={eqHigh}
                  disabled={!selectedTrack}
                  onChange={handleEqChange("high")}
                />
              </div>
            </div>

            <div className="section">
              <div className="section-title">Balance y Dirección</div>
              <div className="slider-row">
                <div className="slider-label">
                  <span>Pan</span>
                  <span className="value">{formatPan(pan)}</span>
                </div>
                <input
                  type="range"
                  min="-1"
                  max="1"
                  step="0.01"
                  value={pan}
                  disabled={!selectedTrack}
                  onChange={handlePanChange}
                />
              </div>
              <button
                className={`direction-toggle ${selectedTrack?.direction === -1 ? "reverse" : ""}`}
                onClick={handleDirectionToggle}
                disabled={!selectedTrack}
              >
                {selectedTrack?.direction === -1 ? "◀ Retroceder" : "Avanzar ▶"}
              </button>
            </div>
          </aside>
        </div>
      )}

      {coverGallery && (
        <div className="modal-backdrop" onClick={() => setCoverGallery(null)}>
          <div
            className="modal modal-wide"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2>Seleccionar Carátula</h2>
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <input
                  type="text"
                  className="search-input"
                  placeholder="Nombre..."
                  value={coverSearchName}
                  onChange={(e) => setCoverSearchName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleRefreshCovers()}
                  style={{ width: "140px", padding: "6px 10px", fontSize: "12px" }}
                  title="Nombre de la canción o disco"
                />
                <input
                  type="text"
                  className="search-input"
                  placeholder="Artista..."
                  value={coverSearchArtist}
                  onChange={(e) => setCoverSearchArtist(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleRefreshCovers()}
                  style={{ width: "130px", padding: "6px 10px", fontSize: "12px" }}
                  title="Nombre del artista (opcional)"
                />
                <button
                  className="toolbar-btn icon-btn"
                  onClick={handleRefreshCovers}
                  disabled={isRefreshingCovers}
                  title="Buscar carátulas con estos datos"
                >
                  {isRefreshingCovers ? "⏳" : "↻"}
                </button>
                <button className="modal-close" onClick={() => setCoverGallery(null)}>✕</button>
              </div>
            </div>
            <div
              className="modal-body"
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, 1fr)",
                gap: "10px",
              }}
            >
              {coverGallery.covers.map((url, i) => (
                <img
                  key={i}
                  src={url}
                  title={url}
                  style={{
                    width: "100%",
                    aspectRatio: 1,
                    objectFit: "cover",
                    cursor: "pointer",
                    borderRadius: "8px",
                    border:
                      selectedTrack?.coverUrl === url
                        ? "2px solid var(--primary)"
                        : "2px solid transparent",
                  }}
                  // ✅ Si la imagen de MusicBrainz no existe (404), la ocultamos
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                  onClick={async () => {
                    // 1. Actualizar la carátula
                    paletteProcessedRef.current.delete(coverGallery.trackId);
                    setTrackCover(coverGallery.trackId, url);
                    setCoverGallery(null);

                    // 2. Extraer los nuevos colores de inmediato
                    try {
                      const palette = await extractPaletteFromImage(
                        url,
                        globalTheme.satBoost,
                        globalTheme.brightness,
                        globalTheme.grayscalePalette,
                        globalTheme.grayscaleDarkness
                      );
                      setTrackExtractedColors(coverGallery.trackId, palette);
                    } catch (err) {
                      console.warn("No se pudo extraer la paleta de la nueva carátula", err);
                    }
                  }}
                />
              ))}
            </div>
            <div
              className="playlist-modal-actions"
              style={{ padding: "0 22px 20px" }}
            >
              <label className="modal-btn-primary">
                Subir archivo...
                <input
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      const url = URL.createObjectURL(file);
                      paletteProcessedRef.current.delete(coverGallery.trackId);
                      setTrackCover(coverGallery.trackId, url);
                      
                      const currentCovers = tracks.find((t) => t.id === coverGallery.trackId)?.availableCovers || [];
                      setTrackAvailableCovers(coverGallery.trackId, [url, ...currentCovers]);
                      setCoverGallery(null);

                      // Forzar extracción
                      try {
                        const palette = await extractPaletteFromImage(
                          url,
                          globalTheme.satBoost,
                          globalTheme.brightness,
                          globalTheme.grayscalePalette,
                          globalTheme.grayscaleDarkness
                        );
                        setTrackExtractedColors(coverGallery.trackId, palette);
                      } catch (err) {
                        console.warn("No se pudo extraer la paleta", err);
                      }
                    }
                  }}
                />
              </label>
            </div>
          </div>
        </div>
      )}

      <CustomizePanel
        open={customizeOpen}
        theme={globalTheme}
        onChange={setGlobalTheme}
        onClose={() => setCustomizeOpen(false)}
        isFullscreen={isFullscreen}
        onToggleFullscreen={toggleFullscreen}
      />

      <PlaylistModal
        open={playlistModalOpen}
        defaultName=""
        defaultDescription=""
        candidateGroups={candidateGroups}
        initialSelectedPaths={initialSelectedPaths}
        onCancel={() => {
          setPlaylistModalOpen(false);
          setPlaylistModalPreselect(null);
        }}
        onConfirm={(name, description, selectedPaths) => {
          const firstWithCover = tracks.find(
            (t) =>
              t.sourcePath &&
              selectedPaths.includes(t.sourcePath) &&
              t.coverUrl,
          );
          const coverUrl = firstWithCover?.coverUrl ?? null;
          const playlist = createPlaylist(
            name,
            description,
            selectedPaths,
            coverUrl,
          );
          setPlaylists((prev) => [...prev, playlist]);
          setPlaylistModalOpen(false);
          setPlaylistModalPreselect(null);
          setSelectedPlaylistId(playlist.id);
          if (isSelectMode) exitSelectMode();
        }}
      />

      <ConfirmModal
        open={confirmEmptyInbox}
        title="Vaciar bandeja de entrada"
        message="¿Seguro que quieres eliminar todas las canciones de la bandeja de entrada? Esta acción no se puede deshacer."
        confirmLabel="Vaciar"
        cancelLabel="Cancelar"
        onConfirm={() => {
          handleClearAll();
          setConfirmEmptyInbox(false);
        }}
        onCancel={() => setConfirmEmptyInbox(false)}
      />

      <DeleteConfirmModal
        open={pendingDeleteInfo !== null}
        title={pendingDeleteInfo?.title ?? ""}
        message={pendingDeleteInfo?.message ?? ""}
        onConfirm={handleConfirmPendingDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </>
  );
}

export default App;
