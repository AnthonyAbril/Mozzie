import * as THREE from 'three';
import { useRef, useState, useCallback } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { ScratchableVinyl } from './components/ScratchableVinyl';
import { useAudioEngine } from './hooks/useAudioEngine';
import { getCoverArt } from './utils/coverArt';
import './App.css';

const RPM_BASE = 33.333;

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
    setTrackBaseRateSmooth,
    setTrackEQ,
    setTrackPan,       // ← nuevo
    setTrackReverb,    // ← nuevo
    setTrackVolume,
    setTrackCover,
    beginScratch,
    endScratch,
  } = useAudioEngine();

  const [editingRpm, setEditingRpm] = useState(false);
  const [rpmDraft, setRpmDraft] = useState('');

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

  const handleRpmChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!selectedTrackId) return;
    const newRpm = Number(e.target.value);
    setTrackBaseRateSmooth(selectedTrackId, newRpm / RPM_BASE, 400);
  };

  const startEditRpm = () => {
    if (!selectedTrack) return;
    setRpmDraft(rpm.toFixed(2));
    setEditingRpm(true);
  };

  const commitEditRpm = () => {
    setEditingRpm(false);
    if (!selectedTrackId) return;
    const parsed = parseFloat(rpmDraft.replace(',', '.'));
    if (isNaN(parsed)) return;
    const clamped = Math.max(8, Math.min(100, parsed));
    setTrackBaseRateSmooth(selectedTrackId, clamped / RPM_BASE, 700);
  };

  const resetRpm = () => {
    if (!selectedTrackId) return;
    setTrackBaseRateSmooth(selectedTrackId, 1, 500);
  };

  const handleEqChange =
    (band: 'low' | 'mid' | 'high') =>
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
    if (Math.abs(v) < 0.02) return 'C';
    const side = v < 0 ? 'L' : 'R';
    return `${side}${Math.round(Math.abs(v) * 100)}`;
  };

  const handleSwipe = useCallback(
    (direction: 'left' | 'right') => {
      if (!selectedTrackId) return;
      const idx = tracks.findIndex((t) => t.id === selectedTrackId);
      if (idx < 0) return;
      const newIdx =
        direction === 'right'
          ? Math.max(0, idx - 1)
          : Math.min(tracks.length - 1, idx + 1);
      if (newIdx !== idx) setSelectedTrackId(tracks[newIdx].id);
    },
    [tracks, selectedTrackId]
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
    [selectedTrackId, setTrackRate]
  );

  const onScratchEnd = useCallback(() => {
    if (controlsRef.current) controlsRef.current.enabled = true;
    if (!selectedTrackId) return;
    endScratch(selectedTrackId);
    const target = selectedTrack?.baseRate ?? 1;
    const id = selectedTrackId;
    const start = performance.now();
    const dur = 80;
    const tick = () => {
      const t = Math.min((performance.now() - start) / dur, 1);
      const rate = 0.001 + (target - 0.001) * t;
      setTrackRate(id, rate);
      if (t < 1) requestAnimationFrame(tick);
    };
    tick();
  }, [selectedTrackId, selectedTrack, setTrackRate, endScratch]);

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

      {/* ── Rail derecho desplegable ── */}
      <div id="right-rail">
        <aside id="right-sidebar">
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
                  {eqLow > 0 ? '+' : ''}
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
                onChange={handleEqChange('low')}
              />
            </div>

            <div className="slider-row">
              <div className="slider-label">
                <span>Medios</span>
                <span className="value">
                  {eqMid > 0 ? '+' : ''}
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
                onChange={handleEqChange('mid')}
              />
            </div>

            <div className="slider-row">
              <div className="slider-label">
                <span>Agudos</span>
                <span className="value">
                  {eqHigh > 0 ? '+' : ''}
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
                onChange={handleEqChange('high')}
              />
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}

export default App;