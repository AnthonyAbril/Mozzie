import * as THREE from "three";
import { useRef, useState, useCallback, useMemo, useEffect, memo } from "react";

import {
  loadLibrary,
  saveLibrary,
  type LibraryEntry,
} from "./utils/libraryStorage";
import { Canvas } from "@react-three/fiber";
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
}: TrackItemProps) {
  return (
    <Reorder.Item
      value={id}
      className={`track-item ${isSelected ? "active" : ""} ${isSelectMode ? "select-mode" : ""}`}
      onClick={() => {
        if (isSelectMode && onCheck) onCheck(id);
        else onSelect(id);
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

function App() {
  const { globalTheme, setGlobalTheme } = useTheme();
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [editingRpm, setEditingRpm] = useState(false);
  const [rpmDraft, setRpmDraft] = useState("");
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const controlsRef = useRef<any>(null);

  const [appMode, setAppMode] = useState<"player" | "playlists">("player");
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);
  const [playlists, setPlaylists] = useState<Playlist[]>(() => loadPlaylists());
  const [playlistModalOpen, setPlaylistModalOpen] = useState(false);
  const [activePlaylistId, setActivePlaylistId] = useState<string | null>(null);
  const [isLoadingPlaylist, setIsLoadingPlaylist] = useState(false);
  const [confirmEmptyInbox, setConfirmEmptyInbox] = useState(false);

  // ── NUEVOS ESTADOS PARA BUSCADOR, FILTROS Y BORRADO ──
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<"name" | "artist" | "date" | "random">("name");
  const [isDeleteMode, setIsDeleteMode] = useState(false);
  const [selectedForDeletion, setSelectedForDeletion] = useState<Set<string>>(new Set());
  const [activeDropdown, setActiveDropdown] = useState<"open" | "filter" | null>(null);
  const [playbackContext, setPlaybackContext] = useState<string[]>([]);

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
    setTrackExtractedColors,
    setTrackThemeMode,
    setTrackCustomThemeColors,
    reorderTracks,
    beginScratch,
    endScratch,
  } = useAudioEngine({
    onTrackEnd: (id) => {
      const s = stateRef.current;
      if (!s) return;
      const mode = s.playMode as "single" | "continuous" | "loop";

      if (mode === "loop") {
        playTrackRef.current?.(id);
        return;
      }

      if (mode === "continuous") {
        const list = s.tracks;
        const idx = list.findIndex((t: any) => t.id === id);
        if (idx < 0 || list.length === 0) return;
        const nextIdx = (idx + 1) % list.length;
        const nextTrack = list[nextIdx];

        setSelectedTrackId(nextTrack.id);

        if (s.singlePlayback) {
          list.forEach((t: any) => {
            if (t.id !== nextTrack.id && t.isPlaying) {
              pauseTrackRef.current?.(t.id);
            }
          });
        }
        playTrackRef.current?.(nextTrack.id);
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
  };

  const effectiveTheme = useMemo(() => {
    if (globalTheme.discThemeMode && selectedTrack) {
      if (selectedTrack.themeMode === "custom" && selectedTrack.customThemeColors) {
        return {
          primary: globalTheme.primary,
          bg1: selectedTrack.customThemeColors[0],
          bg2: selectedTrack.customThemeColors[1],
        };
      }
      if (selectedTrack.themeColors) {
        return {
          primary: globalTheme.primary,
          bg1: selectedTrack.themeColors[0],
          bg2: selectedTrack.themeColors[1],
        };
      }
    }
    return {
      primary: globalTheme.primary,
      bg1: globalTheme.themeColor1,
      bg2: globalTheme.themeColor2,
    };
  }, [globalTheme, selectedTrack]);

  const animatedTheme = useAnimatedTheme(effectiveTheme, 600);

  // ─── LÓGICA DE FILTRADO Y ORDENACIÓN ───
  const displayedTracks = useMemo(() => {
    let result = [...tracks];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((t) => t.name.toLowerCase().includes(q));
    }
    if (sortBy === "name") {
      result.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortBy === "date") {
      result.sort((a, b) => a.file.lastModified - b.file.lastModified);
    }
    // "artist" y "random" se manejan al hacer clic en el menú
    return result;
  }, [tracks, searchQuery, sortBy]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const track of tracks) {
        if (!track.coverUrl) continue;
        const palette = await extractPaletteFromImage(
          track.coverUrl,
          globalTheme.satBoost,
          globalTheme.brightness
        );
        if (cancelled) return;
        setTrackExtractedColors(track.id, palette);
      }
    })();
    return () => { cancelled = true; };
  }, [globalTheme.satBoost, globalTheme.brightness]);

  useEffect(() => {
    const targets = tracks.filter((t) => t.sourcePath && !t.coverUrl && !coverProcessedRef.current.has(t.id));
    if (targets.length === 0) return;
    for (const t of targets) coverProcessedRef.current.add(t.id);
    for (const t of targets) {
      (async () => {
        try {
          const { coverUrl } = await getCoverArt(t.file);
          if (coverUrl) setTrackCover(t.id, coverUrl);
        } catch {}
      })();
    }
  }, [tracks.map((t) => `${t.id}:${t.sourcePath ? "s" : "-"}:${t.coverUrl ? "c" : "-"}`).join("|")]);

  useEffect(() => {
    const targets = tracks.filter((t) => t.coverUrl && !t.themeColors && !paletteProcessedRef.current.has(t.id));
    if (targets.length === 0) return;
    for (const t of targets) paletteProcessedRef.current.add(t.id);
    for (const t of targets) {
      (async () => {
        try {
          const palette = await extractPaletteFromImage(t.coverUrl!, globalTheme.satBoost, globalTheme.brightness);
          setTrackExtractedColors(t.id, palette);
        } catch {}
      })();
    }
  }, [tracks.map((t) => `${t.id}:${t.coverUrl ? "c" : "-"}:${t.themeColors ? "p" : "-"}`).join("|")]);

  const playlistsSignature = useMemo(() => JSON.stringify(playlists.map((p) => `${p.id}|${p.name}|${p.trackPaths.length}`)), [playlists]);
  useEffect(() => { savePlaylists(playlists); }, [playlistsSignature]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat) return;
      const t = e.target as HTMLElement;
      if (t?.tagName === "INPUT" || t?.tagName === "TEXTAREA" || t?.isContentEditable) return;
      e.preventDefault();
      const s = stateRef.current;
      if (s.selectedTrack) toggleTrack(s.selectedTrack.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleTrack]);

  useEffect(() => {
    const pending = tracks.filter((t) => t.themeMode === "custom" && !t.customThemeColors && t.themeColors);
    if (pending.length === 0) return;
    pending.forEach((t) => { setTrackCustomThemeColors(t.id, [...t.themeColors!] as [string, string]); });
  }, [tracks]);

  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    if (!window.mozzie) return;
    restoredRef.current = true;
    (async () => {
      const entries = loadLibrary();
      if (entries.length === 0) return;
      const existing = await Promise.all(entries.map(async (e) => ((await window.mozzie!.exists(e.path)) ? e : null)));
      const valid = existing.filter((e): e is LibraryEntry => e !== null);
      if (valid.length === 0) { saveLibrary([]); return; }
      for (const entry of valid) {
        const res = await window.mozzie!.readFile(entry.path);
        if (!res.ok) continue;
        if (res.data.byteLength > 100 * 1024 * 1024) continue;
        const name = entry.name || entry.path.split(/[\\/]/).pop() || entry.path;
        await addTrackFromArrayBuffer(name, entry.path, res.data, null, entry.path);
      }
    })();
  }, []);

  const librarySignature = useMemo(() => tracks.map((t) => `${t.sourcePath ?? ""}|${t.name}`).join("\n"), [tracks]);
  useEffect(() => {
    const entries: LibraryEntry[] = tracks.filter((t) => t.sourcePath).map((t) => ({ path: t.sourcePath!, name: t.name }));
    saveLibrary(entries);
  }, [librarySignature]);

  const playExclusive = useCallback(
    (id: string) => {
      if (globalTheme.singlePlayback) {
        tracks.forEach((t) => { if (t.id !== id && t.isPlaying) pauseTrack(t.id); });
      }
      playTrack(id);
    },
    [globalTheme.singlePlayback, tracks, pauseTrack, playTrack]
  );

  const loadPathsIntoLibrary = useCallback(
    async (paths: string[], autoPlayFirst: boolean): Promise<string[]> => {
      if (!window.mozzie || paths.length === 0) return [];
      const addedIds: string[] = [];
      for (const p of paths) {
        try {
          const res = await window.mozzie.readFile(p);
          if (!res.ok) continue;
          if (res.data.byteLength > 100 * 1024 * 1024) {
            console.warn(`Omitiendo archivo >100MB: ${p}`);
            continue;
          }
          const name = p.split(/[\\/]/).pop() ?? p;
          const id = await addTrackFromArrayBuffer(name, p, res.data, null, p);
          addedIds.push(id);
        } catch (err) { console.warn("Error:", err); }
      }
      if (autoPlayFirst && addedIds[0]) {
        setSelectedTrackId(addedIds[0]);
        playExclusive(addedIds[0]);
      }
      return addedIds;
    },
    [addTrackFromArrayBuffer, playExclusive]
  );

  // ─── HANDLERS DE LA NUEVA UI ───
  const handleOpenFiles = useCallback(async () => {
    if (!window.mozzie) return;
    setActiveDropdown(null);
    const paths = await window.mozzie.openFiles();
    await loadPathsIntoLibrary(paths, false);
  }, [loadPathsIntoLibrary]);

  const handleOpenFolder = useCallback(async () => {
    if (!window.mozzie) return;
    setActiveDropdown(null);
    const paths = await window.mozzie.openFolder();
    await loadPathsIntoLibrary(paths, false);
  }, [loadPathsIntoLibrary]);

  const handleSortSelect = (type: "name" | "artist" | "date" | "random") => {
    if (type === "random") {
      const shuffled = [...tracks].sort(() => Math.random() - 0.5);
      reorderTracks(shuffled.map((t) => t.id));
      setSortBy("name"); // ← Restablecer el estado visual a "name"
    } else {
      setSortBy(type);
    }
    setActiveDropdown(null);
  };

  const toggleDeleteSelection = (id: string) => {
    setSelectedForDeletion((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleConfirmDelete = () => {
    selectedForDeletion.forEach((id) => removeTrack(id));
    setSelectedForDeletion(new Set());
    setIsDeleteMode(false);
  };

  // ─── RESTO DE HANDLERS ───
  const handleClearAll = () => {
    clearAll(); saveLibrary([]); setSelectedTrackId(null);
    coverProcessedRef.current.clear(); paletteProcessedRef.current.clear();
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

  const handlePlayModeCycle = useCallback(() => {
    const modes: ("single" | "continuous" | "loop")[] = ["single", "continuous", "loop"];
    const idx = modes.indexOf(globalTheme.playMode);
    setGlobalTheme({ playMode: modes[(idx + 1) % modes.length] });
  }, [globalTheme.playMode, setGlobalTheme]);

  const handleRpmChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!selectedTrackId) return;
    setTrackBaseRateSmooth(selectedTrackId, Number(e.target.value) / RPM_BASE, 400);
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
    setTrackBaseRateSmooth(selectedTrackId, Math.max(8, Math.min(100, parsed)) / RPM_BASE, 700);
  };

  const resetRpm = () => {
    if (!selectedTrackId) return;
    setTrackBaseRateSmooth(selectedTrackId, 1, 500);
  };

  const handleEqChange = (band: "low" | "mid" | "high") => (e: React.ChangeEvent<HTMLInputElement>) => {
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

  // ─── CARROUSEL CON CONTEXTO ───
  const handleSwipe = useCallback(
    (direction: "left" | "right") => {
      if (!selectedTrackId || tracks.length === 0) return;
      const context = playbackContext.length > 0 ? playbackContext : tracks.map((t) => t.id);
      const idx = context.indexOf(selectedTrackId);
      if (idx < 0) return;

      const newIdx = direction === "right" ? (idx - 1 + context.length) % context.length : (idx + 1) % context.length;
      const newTrackId = context[newIdx];
      
      setSelectedTrackId(newTrackId);
      if (globalTheme.singlePlayback && selectedTrack?.isPlaying) {
        pauseTrack(selectedTrackId);
        playTrack(newTrackId);
      }
    },
    [tracks, selectedTrackId, playbackContext, globalTheme.singlePlayback, selectedTrack, pauseTrack, playTrack]
  );

  const candidateGroups = useMemo<CandidateGroup[]>(() => {
    const groups: CandidateGroup[] = [];
    const inboxTracks = tracks.filter((t) => t.sourcePath).map((t) => ({ path: t.sourcePath!, name: t.name }));
    if (inboxTracks.length > 0) groups.push({ label: "📥 Bandeja de entrada", tracks: inboxTracks });
    for (const pl of playlists) {
      groups.push({
        label: `🎵 ${pl.name}`,
        tracks: pl.trackPaths.map((p) => ({ path: p, name: p.split(/[\\/]/).pop() ?? p })),
      });
    }
    return groups;
  }, [tracks.map((t) => t.sourcePath).join("|"), playlists.map((p) => `${p.id}|${p.trackPaths.length}`).join("|")]);

  const handleSaveAsPlaylist = () => {
    if (!tracks.some((t) => t.sourcePath) && !playlists.some((p) => p.trackPaths.length > 0)) {
      alert("No hay canciones para incluir en una playlist.");
      return;
    }
    setPlaylistModalOpen(true);
  };

  const initialSelectedPaths = useMemo(() => {
    if (activePlaylistId !== null) return [];
    return tracks.filter((t) => t.sourcePath).map((t) => t.sourcePath!);
  }, [activePlaylistId, tracks.map((t) => t.sourcePath).join("|")]);

  const handlePlayFromPlaylist = async (playlist: Playlist, trackIndex: number) => {
    if (isLoadingPlaylist) return;
    setIsLoadingPlaylist(true);
    try {
      clearAll(); setSelectedTrackId(null);
      coverProcessedRef.current.clear(); paletteProcessedRef.current.clear();
      const ids = await loadPathsIntoLibrary(playlist.trackPaths, false);
      setPlaybackContext(ids); // ← Actualizar contexto
      setActivePlaylistId(playlist.id);
      if (ids[trackIndex]) { setSelectedTrackId(ids[trackIndex]); playExclusive(ids[trackIndex]); }
      setAppMode("player");
    } finally { setIsLoadingPlaylist(false); }
  };

  const handleBackToInbox = useCallback(async () => {
    if (isLoadingPlaylist) return;
    setIsLoadingPlaylist(true);
    try {
      clearAll(); setSelectedTrackId(null); setActivePlaylistId(null); setPlaybackContext([]);
      coverProcessedRef.current.clear(); paletteProcessedRef.current.clear();
      const inbox = loadLibrary();
      if (inbox.length > 0) await loadPathsIntoLibrary(inbox.map((e) => e.path), false);
    } finally { setIsLoadingPlaylist(false); }
  }, [isLoadingPlaylist, clearAll, loadPathsIntoLibrary]);

  const onScratchStart = useCallback(() => {
    if (controlsRef.current) controlsRef.current.enabled = false;
    if (selectedTrackId) { beginScratch(selectedTrackId); setTrackRate(selectedTrackId, 0.001); }
  }, [selectedTrackId, setTrackRate, beginScratch]);

  const onScratchRate = useCallback((rate: number) => {
    if (selectedTrackId) setTrackRate(selectedTrackId, rate);
  }, [selectedTrackId, setTrackRate]);

  const onScratchEnd = useCallback(() => {
    if (controlsRef.current) controlsRef.current.enabled = true;
    if (!selectedTrackId) return;
    endScratch(selectedTrackId);
    const dir = selectedTrack?.direction ?? 1;
    const target = dir * (selectedTrack?.baseRate ?? 1);
    const start = performance.now();
    const tick = () => {
      const t = Math.min((performance.now() - start) / 80, 1);
      setTrackRate(selectedTrackId, (dir > 0 ? 0.001 : -0.001) + (target - (dir > 0 ? 0.001 : -0.001)) * t);
      if (t < 1) requestAnimationFrame(tick);
    };
    tick();
  }, [selectedTrackId, selectedTrack, setTrackRate, endScratch]);

  const handleSelectTrack = useCallback((id: string) => {
    setPlaybackContext(displayedTracks.map((t) => t.id)); // ← Contexto filtrado
    const s = stateRef.current;
    if (s.singlePlayback && s.selectedTrack?.isPlaying && id !== s.selectedTrackId) {
      s.tracks.forEach((t: Track) => { if (t.id !== id && t.isPlaying) pauseTrack(t.id); });
      playTrack(id);
    }
    setSelectedTrackId(id);
  }, [displayedTracks, pauseTrack, playTrack]);

  const handleToggleTrack = useCallback((id: string) => {
    setSelectedTrackId(id);
    toggleTrack(id);
  }, [toggleTrack]);

  return (
    <>
      <div className="titlebar-drag" />
      <div id="app" className={appMode === "playlists" ? "playlist-mode" : ""}>
        <aside id="sidebar">
          <div className="sidebar-view-header">
            {activePlaylistId ? (
              <>
                <span className="view-name">🎵 {playlists.find((p) => p.id === activePlaylistId)?.name ?? "Playlist"}</span>
                <button className="view-inbox-btn" onClick={handleBackToInbox} disabled={isLoadingPlaylist} title="Volver a la bandeja de entrada">📥 Inbox</button>
              </>
            ) : (
              <span className="view-name">📥 Bandeja de entrada</span>
            )}
          </div>
          {appMode === "player" ? (
            <>
                            {/* ── NUEVA BARRA DE HERRAMIENTAS ── */}
              <div className="sidebar-controls">
                {/* 1. Buscador Arriba */}
                {!isDeleteMode && (
                  <div className="sidebar-search">
                    <input
                      type="text"
                      className="search-input"
                      placeholder="Buscar canciones..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                    />
                  </div>
                )}

                {/* 2. Botones Abajo */}
                <div className="sidebar-toolbar">
                  {isDeleteMode ? (
                    <>
                      <button className="toolbar-btn flex-1" onClick={() => { setIsDeleteMode(false); setSelectedForDeletion(new Set()); }}>Cancelar</button>
                      <button className="toolbar-btn danger flex-1" onClick={handleConfirmDelete} disabled={selectedForDeletion.size === 0}>
                        Eliminar ({selectedForDeletion.size})
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="dropdown-container flex-1">
                        <button className="toolbar-btn w-full" onClick={() => setActiveDropdown(activeDropdown === "open" ? null : "open")}>Abrir ▼</button>
                        {activeDropdown === "open" && (
                          <ul className="dropdown-menu">
                            <li onClick={handleOpenFiles}>📁 Abrir archivos</li>
                            <li onClick={handleOpenFolder}>📂 Abrir carpeta</li>
                          </ul>
                        )}
                      </div>

                      <div className="dropdown-container">
                        <button className="toolbar-btn icon-btn" title="Filtrar" onClick={() => setActiveDropdown(activeDropdown === "filter" ? null : "filter")}>▼</button>
                        {activeDropdown === "filter" && (
                          <ul className="dropdown-menu dropdown-right">
                            <li onClick={() => handleSortSelect("name")}>Por nombre ↑</li>
                            <li onClick={() => handleSortSelect("artist")}>Por artista ↑</li>
                            <li onClick={() => handleSortSelect("date")}>Por fecha ↑</li>
                            <li onClick={() => handleSortSelect("random")}>Aleatorio</li>
                          </ul>
                        )}
                      </div>

                      <button className="toolbar-btn icon-btn danger" title="Eliminar canciones" onClick={() => setIsDeleteMode(true)}>✕</button>
                    </>
                  )}
                </div>
              </div>

              {activeDropdown && <div className="dropdown-backdrop" onClick={() => setActiveDropdown(null)} />}

              <Reorder.Group
                axis="y"
                id="track-list"
                values={displayedTracks.map((t) => t.id)}
                onReorder={(newIds) => reorderTracks(newIds as string[])}
              >
                {displayedTracks.length === 0 && (
                  <li className="empty">{searchQuery ? "No se encontraron canciones" : "Sin canciones cargadas"}</li>
                )}
                {displayedTracks.map((track) => (
                  <TrackItem
                    key={track.id}
                    id={track.id}
                    name={track.name}
                    isPlaying={track.isPlaying}
                    isSelected={track.id === selectedTrackId}
                    isSelectMode={isDeleteMode}
                    isChecked={selectedForDeletion.has(track.id)}
                    onSelect={handleSelectTrack}
                    onToggle={handleToggleTrack}
                    onCheck={toggleDeleteSelection}
                  />
                ))}
              </Reorder.Group>

              <div className="sidebar-footer-actions">
                <button className="customize-btn" onClick={() => setAppMode("playlists")}>🎵 Playlists</button>
                <button className="customize-btn" onClick={() => setCustomizeOpen(true)}>⚙️ Personalización</button>
              </div>
            </>
          ) : (
            <>
              <div className="sidebar-mini-3d">
                <Canvas camera={{ position: [0, 14, 18], fov: 45 }}>
                  <ResponsiveCamera baseFov={45} baseAspect={1.5} />
                  <color attach="background" args={[animatedTheme.bg1]} />
                  <ambientLight intensity={0.55} />
                  <directionalLight position={[5, 10, 6]} intensity={1.4} />
                  <directionalLight position={[-6, 5, -7]} intensity={0.7} color={animatedTheme.primary} />
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
                  <OrbitControls ref={controlsRef} makeDefault enableDamping dampingFactor={0.08} enablePan={false} minPolarAngle={0.15} maxPolarAngle={Math.PI / 2.05} minDistance={5} maxDistance={30} mouseButtons={{ LEFT: null, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: null }} />
                </Canvas>
              </div>
              <div className="sidebar-mini-info">
                <div className="section-title">En reproducción</div>
                {selectedTrack ? (
                  <>
                    <div className="mini-info-name">{selectedTrack.name}</div>
                    <div className="mini-info-time">{formatTime(selectedTrack.currentTime)} / {formatTime(selectedTrack.duration)}</div>
                  </>
                ) : <div className="mini-info-empty">Ninguna pista seleccionada</div>}
              </div>
              <div className="sidebar-footer-actions">
                <button className="customize-btn" onClick={() => setAppMode("player")}>◀ Volver al reproductor</button>
              </div>
            </>
          )}
        </aside>

        <main id="main">
          {appMode === "player" ? (
            <>
              <section id="viewport">
                <Canvas camera={{ position: [0, 14, 18], fov: 45 }}>
                  <ResponsiveCamera baseFov={45} baseAspect={1.5} />
                  <color attach="background" args={[animatedTheme.bg1]} />
                  <ambientLight intensity={0.55} />
                  <directionalLight position={[5, 10, 6]} intensity={1.4} />
                  <directionalLight position={[-6, 5, -7]} intensity={0.7} color={animatedTheme.primary} />
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
                  <OrbitControls ref={controlsRef} makeDefault enableDamping dampingFactor={0.08} enablePan={false} minPolarAngle={0.15} maxPolarAngle={Math.PI / 2.05} minDistance={5} maxDistance={30} mouseButtons={{ LEFT: null, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: null }} />
                </Canvas>
              </section>

              <footer id="controls">
                <button id="play-pause" disabled={!selectedTrack} onClick={() => selectedTrack && toggleTrack(selectedTrack.id)}>
                  {selectedTrack?.isPlaying ? "⏸" : "▶"}
                </button>
                <button id="playmode-btn" className={globalTheme.playMode !== "single" ? "active" : ""} onClick={handlePlayModeCycle} title={PLAY_MODE_LABEL[globalTheme.playMode]}>
                  {PLAY_MODE_ICON[globalTheme.playMode]}
                </button>
                <span id="time-current">{formatTime(selectedTrack?.currentTime ?? 0)}</span>
                <input type="range" id="progress" min="0" max="1000" disabled={!selectedTrack} value={selectedTrack?.duration ? (selectedTrack.currentTime / selectedTrack.duration) * 1000 : 0} onChange={handleProgressChange} />
                <span id="time-total">{formatTime(selectedTrack?.duration ?? 0)}</span>
                <input type="range" id="volume" min="0" max="1" step="0.01" disabled={!selectedTrack} value={selectedTrack?.volume ?? 0.8} onChange={handleVolumeChange} />
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
                onDelete={(id) => { setPlaylists((prev) => prev.filter((p) => p.id !== id)); if (selectedPlaylistId === id) setSelectedPlaylistId(null); }}
              />
            </section>
          )}
        </main>
        {appMode === "playlists" && (
          <aside id="playlist-sidebar">
            <PlaylistDetail playlist={playlists.find((p) => p.id === selectedPlaylistId) ?? null} onPlayTrack={handlePlayFromPlaylist} />
          </aside>
        )}
      </div>

      {appMode === "player" && (
        <div id="right-rail">
          <aside id="right-sidebar">
            <div className="section">
              <div className="section-title">Velocidad</div>
              {editingRpm ? (
                <input type="text" className="rpm-input" value={rpmDraft} onChange={(e) => setRpmDraft(e.target.value)} onBlur={commitEditRpm} onKeyDown={(e) => { if (e.key === "Enter") commitEditRpm(); if (e.key === "Escape") setEditingRpm(false); }} autoFocus disabled={!selectedTrack} />
              ) : (
                <div className="rpm-value" onClick={startEditRpm} title="Click para escribir un valor exacto">{rpm.toFixed(2)}</div>
              )}
              <div className="rpm-unit" onClick={resetRpm} title="Click para volver a 33.33 RPM">RPM</div>
              <input type="range" min="8" max="100" step="0.1" value={rpm} disabled={!selectedTrack} onChange={handleRpmChange} />
            </div>

            <div className="section">
              <div className="section-title">Balance</div>
              <div className="slider-row">
                <div className="slider-label"><span>Pan</span><span className="value">{formatPan(pan)}</span></div>
                <input type="range" min="-1" max="1" step="0.01" value={pan} disabled={!selectedTrack} onChange={handlePanChange} />
              </div>
            </div>

            <div className="section">
              <div className="section-title">Dirección</div>
              <button className={`direction-toggle ${selectedTrack?.direction === -1 ? "reverse" : ""}`} onClick={handleDirectionToggle} disabled={!selectedTrack}>
                {selectedTrack?.direction === -1 ? "◀ Retroceder" : "Avanzar ▶"}
              </button>
            </div>

            <div className="section">
              <div className="section-title">Reverb</div>
              <div className="slider-row">
                <div className="slider-label"><span>Mezcla</span><span className="value">{Math.round(reverb * 100)}%</span></div>
                <input type="range" min="0" max="1" step="0.01" value={reverb} disabled={!selectedTrack} onChange={handleReverbChange} />
              </div>
            </div>

            {selectedTrack && (
              <div className="section">
                <div className="section-title">Tema del disco</div>
                <div className="theme-mode-toggle">
                  <button className={selectedTrack.themeMode === "disc" ? "active" : ""} onClick={() => setTrackThemeMode(selectedTrack.id, "disc")} disabled={!selectedTrack.themeColors} title={selectedTrack.themeColors ? "Colores extraídos de la portada" : "Esperando carátula…"}>Disco</button>
                  <button className={selectedTrack.themeMode === "custom" ? "active" : ""} onClick={() => setTrackThemeMode(selectedTrack.id, "custom")}>Personalizado</button>
                </div>
                {selectedTrack.themeMode === "disc" && selectedTrack.themeColors && (
                  <div className="theme-swatches">
                    <div className="swatch" style={{ background: selectedTrack.themeColors[0] }} title={selectedTrack.themeColors[0]} />
                    <div className="swatch" style={{ background: selectedTrack.themeColors[1] }} title={selectedTrack.themeColors[1]} />
                  </div>
                )}
                {selectedTrack.themeMode === "custom" && (
                  <div className="custom-colors">
                    <input type="color" value={selectedTrack.customThemeColors?.[0] ?? "#0e0e12"} onChange={(e) => setTrackCustomThemeColors(selectedTrack.id, [e.target.value, selectedTrack.customThemeColors?.[1] ?? "#15151b"])} />
                    <input type="color" value={selectedTrack.customThemeColors?.[1] ?? "#15151b"} onChange={(e) => setTrackCustomThemeColors(selectedTrack.id, [selectedTrack.customThemeColors?.[0] ?? "#0e0e12", e.target.value])} />
                  </div>
                )}
              </div>
            )}

            <div className="section">
              <div className="section-title">Ecualizador</div>
              <div className="slider-row">
                <div className="slider-label"><span>Bajos</span><span className="value">{eqLow > 0 ? "+" : ""}{eqLow.toFixed(1)} dB</span></div>
                <input type="range" min="-12" max="12" step="0.5" value={eqLow} disabled={!selectedTrack} onChange={handleEqChange("low")} />
              </div>
              <div className="slider-row">
                <div className="slider-label"><span>Medios</span><span className="value">{eqMid > 0 ? "+" : ""}{eqMid.toFixed(1)} dB</span></div>
                <input type="range" min="-12" max="12" step="0.5" value={eqMid} disabled={!selectedTrack} onChange={handleEqChange("mid")} />
              </div>
              <div className="slider-row">
                <div className="slider-label"><span>Agudos</span><span className="value">{eqHigh > 0 ? "+" : ""}{eqHigh.toFixed(1)} dB</span></div>
                <input type="range" min="-12" max="12" step="0.5" value={eqHigh} disabled={!selectedTrack} onChange={handleEqChange("high")} />
              </div>
            </div>
          </aside>
        </div>
      )}

      <CustomizePanel open={customizeOpen} theme={globalTheme} onChange={setGlobalTheme} onClose={() => setCustomizeOpen(false)} />
      <PlaylistModal
        open={playlistModalOpen}
        defaultName="" defaultDescription="" candidateGroups={candidateGroups} initialSelectedPaths={initialSelectedPaths}
        onCancel={() => setPlaylistModalOpen(false)}
        onConfirm={(name, description, selectedPaths) => {
          const firstWithCover = tracks.find((t) => t.sourcePath && selectedPaths.includes(t.sourcePath) && t.coverUrl);
          const coverUrl = firstWithCover?.coverUrl ?? null;
          const playlist = createPlaylist(name, description, selectedPaths, coverUrl);
          setPlaylists((prev) => [...prev, playlist]);
          setPlaylistModalOpen(false); setSelectedPlaylistId(playlist.id);
        }}
      />
      <ConfirmModal
        open={confirmEmptyInbox}
        title="Vaciar bandeja de entrada"
        message="¿Seguro que quieres eliminar todas las canciones de la bandeja de entrada? Esta acción no se puede deshacer."
        confirmLabel="Vaciar" cancelLabel="Cancelar"
        onConfirm={() => { handleClearAll(); setConfirmEmptyInbox(false); }}
        onCancel={() => setConfirmEmptyInbox(false)}
      />
    </>
  );
}

export default App;