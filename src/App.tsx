import * as THREE from "three";
import { useRef, useState, useCallback, useMemo, useEffect, memo } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { ScratchableVinyl } from "./components/ScratchableVinyl";
import { useAudioEngine, type Track } from "./hooks/useAudioEngine";
import { getCoverArt } from "./utils/coverArt";

import { useTheme } from "./hooks/useTheme";
import { extractPaletteFromImage } from "./utils/colorExtract";
import { CustomizePanel } from "./components/CustomizePanel";
import { useAnimatedTheme } from "./hooks/useAnimatedTheme";

import { Reorder } from "framer-motion";

import "./App.css";

const RPM_BASE = 33.333;

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
  onSelect: (id: string) => void; // ← recibe id
  onToggle: (id: string) => void; // ← recibe id
}

const TrackItem = memo(function TrackItem({
  id,
  name,
  isPlaying,
  isSelected,
  onSelect,
  onToggle,
}: TrackItemProps) {
  return (
    <Reorder.Item
      value={id}
      className={`track-item ${isSelected ? "active" : ""}`}
      onClick={() => onSelect(id)}
      title={name}
      whileDrag={{
        scale: 1.03,
        boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
        cursor: "grabbing",
        zIndex: 10,
      }}
    >
      <span className="track-name">{name}</span>
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
    </Reorder.Item>
  );
});

function App() {
  const {
    tracks,
    addTrack,
    toggleTrack,
    playTrack,
    pauseTrack, // ← asegúrate de que está
    seekTrack,
    setTrackRate,
    setTrackBaseRateSmooth,
    setTrackDirection, // ← nuevo
    setTrackEQ,
    setTrackPan,
    setTrackReverb,
    setTrackVolume,
    setTrackCover,
    setTrackExtractedColors, // ← nuevo
    setTrackThemeMode, // ← nuevo
    setTrackCustomThemeColors, // ← nuevo
    reorderTracks,
    beginScratch,
    endScratch,
  } = useAudioEngine();

  const { globalTheme, setGlobalTheme } = useTheme();
  const [customizeOpen, setCustomizeOpen] = useState(false);

  const [editingRpm, setEditingRpm] = useState(false);
  const [rpmDraft, setRpmDraft] = useState("");

  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const controlsRef = useRef<any>(null);

  const selectedTrack = tracks.find((t) => t.id === selectedTrackId) ?? null;

  const rpm = (selectedTrack?.baseRate ?? 1) * RPM_BASE;
  const eqLow = selectedTrack?.eq.low ?? 0;
  const eqMid = selectedTrack?.eq.mid ?? 0;
  const eqHigh = selectedTrack?.eq.high ?? 0;

  const pan = selectedTrack?.pan ?? 0;
  const reverb = selectedTrack?.reverb ?? 0;

  const effectiveTheme = useMemo(() => {
    if (globalTheme.discThemeMode && selectedTrack) {
      if (
        selectedTrack.themeMode === "custom" &&
        selectedTrack.customThemeColors
      ) {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    globalTheme.discThemeMode,
    globalTheme.primary,
    globalTheme.themeColor1,
    globalTheme.themeColor2,
    selectedTrack?.themeMode,
    selectedTrack?.themeColors?.[0],
    selectedTrack?.themeColors?.[1],
    selectedTrack?.customThemeColors?.[0],
    selectedTrack?.customThemeColors?.[1],
  ]);

  const animatedTheme = useAnimatedTheme(effectiveTheme, 600);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const track of tracks) {
        if (!track.coverUrl) continue;
        const palette = await extractPaletteFromImage(
          track.coverUrl,
          globalTheme.satBoost,
          globalTheme.brightness, // ← nuevo
        );
        if (cancelled) return;
        setTrackExtractedColors(track.id, palette);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Solo re-extrae cuando el boost cambia
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [globalTheme.satBoost, globalTheme.brightness]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat) return;
      const t = e.target as HTMLElement;
      // No interferir con inputs de texto
      if (
        t?.tagName === 'INPUT' ||
        t?.tagName === 'TEXTAREA' ||
        t?.isContentEditable
      ) {
        return;
      }
      e.preventDefault();
      const s = stateRef.current;
      if (s.selectedTrack) toggleTrack(s.selectedTrack.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleTrack]);

  useEffect(() => {
    const pending = tracks.filter(
      (t) => t.themeMode === "custom" && !t.customThemeColors && t.themeColors,
    );
    if (pending.length === 0) return;
    pending.forEach((t) => {
      setTrackCustomThemeColors(t.id, [...t.themeColors!] as [string, string]);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks]);

  const handleOpenFile = () => fileInputRef.current?.click();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    const id = await addTrack(file, null);
    setSelectedTrackId(id);
    playExclusive(id);

    try {
      const { coverUrl } = await getCoverArt(file);
      if (coverUrl) {
        setTrackCover(id, coverUrl);
        const palette = await extractPaletteFromImage(
          coverUrl,
          globalTheme.satBoost,
          globalTheme.brightness, // ← nuevo
        );
        setTrackExtractedColors(id, palette);
      }
    } catch (err) {
      console.warn("Carátula no disponible:", err);
    }
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

  const handleRpmChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!selectedTrackId) return;
    const newRpm = Number(e.target.value);
    setTrackBaseRateSmooth(selectedTrackId, newRpm / RPM_BASE, 400);
  };

  const handleDirectionToggle = () => {
    if (!selectedTrackId || !selectedTrack) return;
    const newDir: 1 | -1 = selectedTrack.direction === 1 ? -1 : 1;
    setTrackDirection(selectedTrackId, newDir);
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
    const clamped = Math.max(8, Math.min(100, parsed));
    setTrackBaseRateSmooth(selectedTrackId, clamped / RPM_BASE, 700);
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

  /** Formatea el pan: L50 / C / R50 */
  const formatPan = (v: number) => {
    if (Math.abs(v) < 0.02) return "C";
    const side = v < 0 ? "L" : "R";
    return `${side}${Math.round(Math.abs(v) * 100)}`;
  };

  const handleSwipe = useCallback(
    (direction: "left" | "right") => {
      if (!selectedTrackId || tracks.length === 0) return;
      const idx = tracks.findIndex((t) => t.id === selectedTrackId);
      if (idx < 0) return;
      const newIdx =
        direction === "right"
          ? (idx - 1 + tracks.length) % tracks.length
          : (idx + 1) % tracks.length;
      if (newIdx === idx) return;

      const wasPlaying = tracks[idx].isPlaying;
      const newTrack = tracks[newIdx];

      if (globalTheme.singlePlayback) {
        if (wasPlaying) {
          pauseTrack(tracks[idx].id);
          playTrack(newTrack.id);
        }
      }
      setSelectedTrackId(newTrack.id);
    },
    [
      tracks,
      selectedTrackId,
      globalTheme.singlePlayback,
      pauseTrack,
      playTrack,
    ],
  );

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

  // -------- Scratch --------
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
    const id = selectedTrackId;
    const start = performance.now();
    const dur = 80;
    const tick = () => {
      const t = Math.min((performance.now() - start) / dur, 1);
      const rate =
        (dir > 0 ? 0.001 : -0.001) + (target - (dir > 0 ? 0.001 : -0.001)) * t;
      setTrackRate(id, rate);
      if (t < 1) requestAnimationFrame(tick);
    };
    tick();
  }, [selectedTrackId, selectedTrack, setTrackRate, endScratch]);

  // En App(), arriba del return:
  const stateRef = useRef<any>(null);
  stateRef.current = {
    tracks,
    selectedTrackId,
    selectedTrack,
    singlePlayback: globalTheme.singlePlayback,
  };

  const handleSelectTrack = useCallback(
    (id: string) => {
      const s = stateRef.current;
      if (
        s.singlePlayback &&
        s.selectedTrack?.isPlaying &&
        id !== s.selectedTrackId
      ) {
        // Para todas y arranca la nueva
        s.tracks.forEach((t: Track) => {
          if (t.id !== id && t.isPlaying) pauseTrack(t.id);
        });
        playTrack(id);
      }
      setSelectedTrackId(id);
    },
    [pauseTrack, playTrack],
  ); // ambas son estables en el hook

  const handleToggleTrack = useCallback(
    (id: string) => {
      toggleTrack(id);
    },
    [toggleTrack],
  );

  return (
    <>
      <div id="app">
        <aside id="sidebar">
          <button id="open-folder" onClick={handleOpenFile}>
            📁 Abrir archivo
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
            style={{ display: "none" }}
            onChange={handleFileChange}
          />
          <Reorder.Group
            axis="y"
            id="track-list"
            values={tracks.map((t) => t.id)}
            onReorder={(newIds) => reorderTracks(newIds as string[])}
          >
            {tracks.length === 0 && (
              <li className="empty">Sin canciones cargadas</li>
            )}
            {tracks.map((track) => (
              <TrackItem
                key={track.id}
                id={track.id}
                name={track.name}
                isPlaying={track.isPlaying}
                isSelected={track.id === selectedTrackId}
                onSelect={handleSelectTrack}
                onToggle={handleToggleTrack}
              />
            ))}
          </Reorder.Group>
          <button
            className="customize-btn"
            onClick={() => setCustomizeOpen(true)}
          >
            ⚙️ Personalización
          </button>
        </aside>

        <main id="main">
          <section id="viewport">
            <Canvas camera={{ position: [0, 14, 18], fov: 45 }}>
              <color attach="background" args={[animatedTheme.bg1]} />
              <ambientLight intensity={0.55} />
              <directionalLight position={[5, 10, 6]} intensity={1.4} />
              <directionalLight
                position={[-6, 5, -7]}
                intensity={0.7}
                color={animatedTheme.primary}
              />

              <ScratchableVinyl
                isPlaying={selectedTrack?.isPlaying ?? false}
                coverUrl={selectedTrack?.coverUrl ?? null}
                baseRate={selectedTrack?.baseRate ?? 1}
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
                maxPolarAngle={Math.PI / 2.05}
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
                  ? (selectedTrack.currentTime / selectedTrack.duration) * 1000
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
        </main>
      </div>

      {/* ── Rail derecho desplegable ── */}
      <div id="right-rail">
        <aside id="right-sidebar">
          <div className="section">
            <div className="section-title">Velocidad</div>

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
            <div className="section-title">Balance</div>

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
          </div>

          <div className="section">
            <div className="section-title">Dirección</div>

            <button
              className={`direction-toggle ${selectedTrack?.direction === -1 ? "reverse" : ""}`}
              onClick={handleDirectionToggle}
              disabled={!selectedTrack}
            >
              {selectedTrack?.direction === -1 ? "◀ Retroceder" : "Avanzar ▶"}
            </button>
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

          {selectedTrack && (
            <div className="section">
              <div className="section-title">Tema del disco</div>

              <div className="theme-mode-toggle">
                <button
                  className={selectedTrack.themeMode === "disc" ? "active" : ""}
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
                  onClick={() => setTrackThemeMode(selectedTrack.id, "custom")}
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
                      ])
                    }
                  />
                </div>
              )}
            </div>
          )}

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
        </aside>
      </div>
      <CustomizePanel
        open={customizeOpen}
        theme={globalTheme}
        onChange={setGlobalTheme}
        onClose={() => setCustomizeOpen(false)}
      />
    </>
  );
}

export default App;
