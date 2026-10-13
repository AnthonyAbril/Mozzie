import { useRef, useState, useCallback, useEffect } from 'react';

export function useAudioPlayer() {
  const audioCtxRef = useRef<AudioContext | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const bufferRef = useRef<AudioBuffer | null>(null);
  const startedAtRef = useRef(0);
  const pausedOffsetRef = useRef(0);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.8);

  // Inicializa el contexto de audio una sola vez
  const getCtx = useCallback(() => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
      gainRef.current = audioCtxRef.current.createGain();
      gainRef.current.gain.value = volume;
      gainRef.current.connect(audioCtxRef.current.destination);
    }
    return audioCtxRef.current;
  }, [volume]);

  // Cargar un archivo de audio
  const loadFile = useCallback(async (file: File) => {
    const ctx = getCtx();
    const arrayBuffer = await file.arrayBuffer();
    const decoded = await ctx.decodeAudioData(arrayBuffer);
    bufferRef.current = decoded;
    pausedOffsetRef.current = 0;
    setDuration(decoded.duration);
    setCurrentTime(0);
    setIsPlaying(false);
  }, [getCtx]);

  // Play
  const play = useCallback(() => {
    if (!bufferRef.current) return;
    const ctx = getCtx();
    if (ctx.state === 'suspended') ctx.resume();

    const source = ctx.createBufferSource();
    source.buffer = bufferRef.current;
    source.playbackRate.value = 1;
    source.connect(gainRef.current!);
    source.start(0, pausedOffsetRef.current);
    sourceRef.current = source;
    startedAtRef.current = ctx.currentTime - pausedOffsetRef.current;
    setIsPlaying(true);

    source.onended = () => {
      if (sourceRef.current === source) {
        setIsPlaying(false);
        pausedOffsetRef.current = 0;
        setCurrentTime(0);
      }
    };
  }, [getCtx]);

  // Pause
  const pause = useCallback(() => {
    const ctx = getCtx();
    if (!sourceRef.current) return;
    const elapsed = ctx.currentTime - startedAtRef.current;
    pausedOffsetRef.current = elapsed;
    sourceRef.current.onended = null;
    sourceRef.current.stop();
    sourceRef.current.disconnect();
    sourceRef.current = null;
    setIsPlaying(false);
    setCurrentTime(elapsed);
    }, [getCtx]);

  // Toggle play/pause
  const toggle = useCallback(() => {
    if (isPlaying) pause();
    else play();
  }, [isPlaying, play, pause]);

  // Cambiar volumen
  useEffect(() => {
    if (gainRef.current) {
      gainRef.current.gain.setTargetAtTime(volume, audioCtxRef.current!.currentTime, 0.01);
    }
  }, [volume]);

  // Actualizar currentTime mientras suena
  useEffect(() => {
    if (!isPlaying) return;
    let rafId: number;
    const tick = () => {
      const ctx = audioCtxRef.current;
      if (ctx && bufferRef.current) {
        const t = Math.min(ctx.currentTime - startedAtRef.current, bufferRef.current.duration);
        setCurrentTime(t);
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying]);

  // Buscar (seek)
  const seek = useCallback((time: number) => {
    const ctx = getCtx();
    if (!bufferRef.current) return;

    if (isPlaying && sourceRef.current) {
        // Parar el source actual sin tocar pausedOffset
        sourceRef.current.onended = null;
        sourceRef.current.stop();
        sourceRef.current.disconnect();
        sourceRef.current = null;

        // Crear uno nuevo desde el nuevo tiempo
        const source = ctx.createBufferSource();
        source.buffer = bufferRef.current;
        source.playbackRate.value = 1;
        source.connect(gainRef.current!);
        source.start(0, time);
        sourceRef.current = source;
        startedAtRef.current = ctx.currentTime - time;
    } else {
        pausedOffsetRef.current = time;
        setCurrentTime(time);
    }
    }, [isPlaying, getCtx]);

  return { isPlaying, currentTime, duration, volume, setVolume, loadFile, play, pause, toggle, seek };
}