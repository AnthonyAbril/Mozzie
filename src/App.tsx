import * as THREE from 'three';
import { useRef, useState, useCallback } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { ScratchableVinyl } from './components/ScratchableVinyl';
import { useAudioEngine } from './hooks/useAudioEngine';
import { getCoverArt } from './utils/coverArt';
import './App.css';

function formatTime(seconds: number) {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function App() {
  const {
    tracks,
    addTrack,
    toggleTrack,
    playTrack,
    seekTrack,
    setTrackRate,
    setTrackVolume,
    setTrackCover,
  } = useAudioEngine();

  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const controlsRef = useRef<any>(null);

  const selectedTrack = tracks.find((t) => t.id === selectedTrackId) ?? null;

  const handleOpenFile = () => fileInputRef.current?.click();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    const id = await addTrack(file, null);
    setSelectedTrackId(id);
    playTrack(id);

    try {
      const { coverUrl } = await getCoverArt(file);
      if (coverUrl) setTrackCover(id, coverUrl);
    } catch (err) {
      console.warn('Carátula no disponible:', err);
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

  const handleSwipe = useCallback(
    (direction: 'left' | 'right') => {
      if (!selectedTrackId) return;
      const idx = tracks.findIndex((t) => t.id === selectedTrackId);
      if (idx < 0) return;
      const newIdx =
        direction === 'right'
          ? Math.max(0, idx - 1)      // drag derecha → anterior
          : Math.min(tracks.length - 1, idx + 1); // drag izq → siguiente
      if (newIdx !== idx) setSelectedTrackId(tracks[newIdx].id);
    },
    [tracks, selectedTrackId]
  );

  // -------- Scratch --------
  const onScratchStart = useCallback(() => {
    if (controlsRef.current) controlsRef.current.enabled = false;
    // No usar 0 exacto: Chromium se queda mudo al pasar a negativo
    if (selectedTrackId) setTrackRate(selectedTrackId, 0.001);
  }, [selectedTrackId, setTrackRate]);

  const onScratchRate = useCallback(
    (rate: number) => {
      if (selectedTrackId) setTrackRate(selectedTrackId, rate);
    },
    [selectedTrackId, setTrackRate]
  );

  const onScratchEnd = useCallback(() => {
    if (controlsRef.current) controlsRef.current.enabled = true;
    if (!selectedTrackId) return;
    // Ramp suave de vuelta a 1x en 80 ms
    const id = selectedTrackId;
    const start = performance.now();
    const from = 1; // queremos llegar a 1
    const dur = 80;
    const tick = () => {
      const t = Math.min((performance.now() - start) / dur, 1);
      // Ramp lineal de 0.001 → 1 (o del valor actual si prefieres)
      const rate = 0.001 + (from - 0.001) * t;
      setTrackRate(id, rate);
      if (t < 1) requestAnimationFrame(tick);
    };
    tick();
  }, [selectedTrackId, setTrackRate]);

  return (
    <div id="app">
      <aside id="sidebar">
        <button id="open-folder" onClick={handleOpenFile}>📁 Abrir archivo</button>
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />
        <ul id="track-list">
          {tracks.length === 0 && (
            <li className="empty">Sin canciones cargadas</li>
          )}
          {tracks.map((track) => (
            <li
              key={track.id}
              className={track.id === selectedTrackId ? 'active' : ''}
              onClick={() => setSelectedTrackId(track.id)}
              title={track.name}
            >
              <span className="track-name">{track.name}</span>
              {track.isPlaying && <span className="track-status">▶</span>}
            </li>
          ))}
        </ul>
      </aside>

      <main id="main">
        <section id="viewport">
          <Canvas camera={{ position: [0, 14, 18], fov: 45 }}>
            <ambientLight intensity={0.5} />
            <directionalLight position={[5, 10, 6]} intensity={1.5} />
            <directionalLight
              position={[-6, 5, -7]}
              intensity={0.6}
              color="#6688ff"
            />

            <ScratchableVinyl
              isPlaying={selectedTrack?.isPlaying ?? false}
              coverUrl={selectedTrack?.coverUrl ?? null}
              onScratchStart={onScratchStart}
              onScratchRate={onScratchRate}
              onScratchEnd={onScratchEnd}
              onSwipe={handleSwipe}
            />

            <OrbitControls
              ref={controlsRef}
              enableDamping
              dampingFactor={0.08}
              enablePan={false}
              minPolarAngle={0.15}
              maxPolarAngle={Math.PI / 2.05}
              minDistance={5}
              maxDistance={30}
              mouseButtons={{
                LEFT: null,                   // reservado para scratch
                MIDDLE: THREE.MOUSE.ROTATE,   // cámara con la rueda
                RIGHT: null,                  // reservado para swipe
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
            {selectedTrack?.isPlaying ? '⏸' : '▶'}
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
  );
}

export default App;