import { useRef, useState, useCallback, useEffect } from 'react';

export interface Track {
  id: string;
  name: string;
  file: File;
  coverUrl: string | null;
  duration: number;
  currentTime: number;
  isPlaying: boolean;
  volume: number;
}

interface TrackInternal {
  buffer: AudioBuffer;
  source: AudioBufferSourceNode | null;
  gain: GainNode;
  startedAt: number;
  pausedOffset: number;
}

export function useAudioEngine() {
  const ctxRef = useRef<AudioContext | null>(null);
  const internalsRef = useRef<Map<string, TrackInternal>>(new Map());
  const [tracks, setTracks] = useState<Track[]>([]);

  const getCtx = useCallback(() => {
    if (!ctxRef.current) ctxRef.current = new AudioContext();
    return ctxRef.current;
  }, []);

  const patchTrack = useCallback((id: string, patch: Partial<Track>) => {
    setTracks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  // ---------- Añadir pista ----------
  const addTrack = useCallback(
    async (file: File, coverUrl: string | null = null): Promise<string> => {
      const ctx = getCtx();
      const arrayBuffer = await file.arrayBuffer();
      const buffer = await ctx.decodeAudioData(arrayBuffer);

      const gain = ctx.createGain();
      gain.gain.value = 0.8;
      gain.connect(ctx.destination);

      const id = crypto.randomUUID();
      internalsRef.current.set(id, {
        buffer,
        source: null,
        gain,
        startedAt: 0,
        pausedOffset: 0,
      });

      const newTrack: Track = {
        id,
        name: file.name,
        file,
        coverUrl,
        duration: buffer.duration,
        currentTime: 0,
        isPlaying: false,
        volume: 0.8,
      };
      setTracks((prev) => [...prev, newTrack]);
      return id;
    },
    [getCtx]
  );

  // ---------- Play / Pause ----------
  const playTrack = useCallback(
    (id: string) => {
      const ctx = getCtx();
      const internal = internalsRef.current.get(id);
      if (!internal || internal.source) return;
      if (ctx.state === 'suspended') ctx.resume();

      const source = ctx.createBufferSource();
      source.buffer = internal.buffer;
      source.connect(internal.gain);
      source.start(0, internal.pausedOffset);
      internal.source = source;
      internal.startedAt = ctx.currentTime - internal.pausedOffset;

      source.onended = () => {
        if (internal.source === source) {
          internal.source = null;
          internal.pausedOffset = 0;
          patchTrack(id, { isPlaying: false, currentTime: 0 });
        }
      };

      patchTrack(id, { isPlaying: true });
    },
    [getCtx, patchTrack]
  );

  const pauseTrack = useCallback(
    (id: string) => {
      const ctx = getCtx();
      const internal = internalsRef.current.get(id);
      if (!internal || !internal.source) return;

      const elapsed = ctx.currentTime - internal.startedAt;
      internal.pausedOffset = elapsed;
      internal.source.onended = null;
      internal.source.stop();
      internal.source.disconnect();
      internal.source = null;

      patchTrack(id, { isPlaying: false, currentTime: elapsed });
    },
    [getCtx, patchTrack]
  );

  const toggleTrack = useCallback(
    (id: string) => {
      const internal = internalsRef.current.get(id);
      if (!internal) return;
      if (internal.source) pauseTrack(id);
      else playTrack(id);
    },
    [playTrack, pauseTrack]
  );

  // ---------- Seek ----------
  const seekTrack = useCallback(
    (id: string, time: number) => {
      const ctx = getCtx();
      const internal = internalsRef.current.get(id);
      if (!internal) return;

      if (internal.source) {
        internal.source.onended = null;
        internal.source.stop();
        internal.source.disconnect();
        internal.source = null;

        const source = ctx.createBufferSource();
        source.buffer = internal.buffer;
        source.connect(internal.gain);
        source.start(0, time);
        internal.source = source;
        internal.startedAt = ctx.currentTime - time;
        internal.pausedOffset = time;

        source.onended = () => {
          if (internal.source === source) {
            internal.source = null;
            internal.pausedOffset = 0;
            patchTrack(id, { isPlaying: false, currentTime: 0 });
          }
        };
      } else {
        internal.pausedOffset = time;
      }
      patchTrack(id, { currentTime: time });
    },
    [getCtx, patchTrack]
  );

  // ---------- Volumen ----------
  const setTrackVolume = useCallback(
    (id: string, volume: number) => {
      const ctx = getCtx();
      const internal = internalsRef.current.get(id);
      if (!internal) return;
      internal.gain.gain.setTargetAtTime(volume, ctx.currentTime, 0.01);
      patchTrack(id, { volume });
    },
    [getCtx, patchTrack]
  );

  // ---------- Carátula ----------
  const setTrackCover = useCallback(
    (id: string, coverUrl: string | null) => {
      patchTrack(id, { coverUrl });
    },
    [patchTrack]
  );

  // ---------- Eliminar ----------
  const removeTrack = useCallback((id: string) => {
    const internal = internalsRef.current.get(id);
    if (internal) {
      if (internal.source) {
        internal.source.onended = null;
        internal.source.stop();
        internal.source.disconnect();
      }
      internal.gain.disconnect();
      internalsRef.current.delete(id);
    }
    setTracks((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // ---------- Refresco de currentTime ----------
  useEffect(() => {
    let rafId: number;
    const tick = () => {
      const ctx = ctxRef.current;
      if (ctx) {
        setTracks((prev) => {
          let changed = false;
          const next = prev.map((t) => {
            const internal = internalsRef.current.get(t.id);
            if (!internal || !internal.source) return t;
            const newTime = Math.min(
              ctx.currentTime - internal.startedAt,
              t.duration
            );
            if (Math.abs(newTime - t.currentTime) > 0.05) {
              changed = true;
              return { ...t, currentTime: newTime };
            }
            return t;
          });
          return changed ? next : prev;
        });
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  return {
    tracks,
    addTrack,
    playTrack,
    pauseTrack,
    toggleTrack,
    seekTrack,
    setTrackVolume,
    setTrackCover,
    removeTrack,
  };
}