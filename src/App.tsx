import * as THREE from 'three';
import { useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Vinyl } from './components/Vinyl';
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
  const engine = useAudioEngine();
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedTrack =
    engine.tracks.find((t) => t.id === selectedTrackId) ?? null;

  const handleOpenFile = () => fileInputRef.current?.click();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = ''; // permite volver a elegir el mismo archivo

    // 1. Añadir pista (queda cargada pero en pausa)
    const id = await engine.addTrack(file, null);
    setSelectedTrackId(id);

    // 2. Reproducir automáticamente y buscar carátula en paralelo
    engine.playTrack(id);

    try {
      const { coverUrl } = await getCoverArt(file);
      if (coverUrl) engine.setTrackCover(id, coverUrl);
    } catch (err) {
      console.warn('No se pudo obtener la carátula:', err);
    }
  };

  const handleProgressChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!selectedTrack) return;
    const t = (Number(e.target.value) / 1000) * selectedTrack.duration;
    engine.seekTrack(selectedTrack.id, t);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!selectedTrack) return;
    engine.setTrackVolume(selectedTrack.id, Number(e.target.value));
  };

  return (
    <div id="app">
      <aside id="sidebar">
        <button id="open-folder" onClick={handleOpenFile}>
          📁 Abrir archivo
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />

        <ul id="track-list">
          {engine.tracks.length === 0 && (
            <li className="empty">Sin canciones cargadas</li>
          )}
          {engine.tracks.map((track) => (
            <li
              key={track.id}
              className={track.id === selectedTrackId ? 'active' : ''}
              onClick={() => setSelectedTrackId(track.id)}
              title={track.name}
            >
              <span className="track-name">{track.name}</span>
              {track.isPlaying && (
                <span className="track-status" aria-label="sonando">
                  ▶
                </span>
              )}
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
            <Vinyl
              isPlaying={selectedTrack?.isPlaying ?? false}
              coverUrl={selectedTrack?.coverUrl ?? null}
            />
            <OrbitControls
              enableDamping
              dampingFactor={0.08}
              enablePan={false}
              minPolarAngle={0.15}
              maxPolarAngle={Math.PI / 2.05}
              minDistance={5}
              maxDistance={30}
              mouseButtons={{
                LEFT: null,
                MIDDLE: THREE.MOUSE.DOLLY,
                RIGHT: THREE.MOUSE.ROTATE,
              }}
            />
          </Canvas>
        </section>

        <footer id="controls">
          <button
            id="play-pause"
            disabled={!selectedTrack}
            onClick={() => selectedTrack && engine.toggleTrack(selectedTrack.id)}
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