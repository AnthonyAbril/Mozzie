import * as THREE from 'three';
import { useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Vinyl } from './components/Vinyl';
import { useAudioPlayer } from './hooks/useAudioPlayer';
import { getCoverArt } from './utils/coverArt';
import './App.css';

function formatTime(seconds: number) {
  if (!isFinite(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function App() {

  const [currentFileName, setCurrentFileName] = useState<string | null>(null);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [loadingCover, setLoadingCover] = useState(false);

  const player = useAudioPlayer();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleOpenFile = () => fileInputRef.current?.click();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setCurrentFileName(file.name);
    setCoverUrl(null);
    await player.loadFile(file);

    // Buscar carátula en segundo plano
    setLoadingCover(true);
    try {
      const { coverUrl } = await getCoverArt(file);
      setCoverUrl(coverUrl);
    } finally {
      setLoadingCover(false);
    }
  };

  const handleProgressChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const t = (Number(e.target.value) / 1000) * player.duration;
    player.seek(t);
  };

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
          {currentFileName ? (
            <li className="active">
              {currentFileName}
              {loadingCover && <span style={{ marginLeft: 6, opacity: 0.6 }}>· buscando carátula…</span>}
            </li>
          ) : (
            <li style={{ opacity: 0.5, cursor: 'default' }}>Sin canción cargada</li>
          )}
        </ul>
      </aside>

      <main id="main">
        <section id="viewport">
          <Canvas camera={{ position: [0, 12, 15], fov: 45 }}>
            <ambientLight intensity={0.5} />
            <directionalLight position={[5, 10, 6]} intensity={1.5} />
            <directionalLight position={[-6, 5, -7]} intensity={0.6} color="#6688ff" />
            <Vinyl isPlaying={player.isPlaying} coverUrl={coverUrl} />
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
          <button id="play-pause" onClick={player.toggle}>
            {player.isPlaying ? '⏸' : '▶'}
          </button>
          <span id="time-current">{formatTime(player.currentTime)}</span>
          <input
            type="range"
            id="progress"
            min="0"
            max="1000"
            value={player.duration ? (player.currentTime / player.duration) * 1000 : 0}
            onChange={handleProgressChange}
          />
          <span id="time-total">{formatTime(player.duration)}</span>
          <input
            type="range"
            id="volume"
            min="0"
            max="1"
            step="0.01"
            value={player.volume}
            onChange={(e) => player.setVolume(Number(e.target.value))}
          />
        </footer>
      </main>
    </div>
  );
}

export default App;