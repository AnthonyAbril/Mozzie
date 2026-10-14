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
  positionAtLastUpdate: number;
  ctxTimeAtLastUpdate: number;
  currentRate: number;
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

  /** Congela la posición actual usando el rate actual */
  const freezePosition = useCallback((internal: TrackInternal, ctx: AudioContext) => {
    const elapsed = ctx.currentTime - internal.ctxTimeAtLastUpdate;
    internal.positionAtLastUpdate += elapsed * internal.currentRate;
    internal.ctxTimeAtLastUpdate = ctx.currentTime;
  }, []);

  const getPosition = useCallback((internal: TrackInternal, ctx: AudioContext) => {
    const elapsed = ctx.currentTime - internal.ctxTimeAtLastUpdate;
    return internal.positionAtLastUpdate + elapsed * internal.currentRate;
  }, []);

  const createSource = useCallback(
    (internal: TrackInternal, ctx: AudioContext, offset: number) => {
      const source = ctx.createBufferSource();
      source.buffer = internal.buffer;
      source.playbackRate.value = internal.currentRate || 1;
      source.connect(internal.gain);
      source.start(0, Math.max(0, offset));
      internal.source = source;
      internal.positionAtLastUpdate = offset;
      internal.ctxTimeAtLastUpdate = ctx.currentTime;
      return source;
    },
    []
  );

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
        positionAtLastUpdate: 0,
        ctxTimeAtLastUpdate: ctx.currentTime,
        currentRate: 1,
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

  // ---------- Play ----------
  const playTrack = useCallback(
    (id: string) => {
      const ctx = getCtx();
      const internal = internalsRef.current.get(id);
      if (!internal || internal.source) return;
      if (ctx.state === 'suspended') ctx.resume();

      internal.currentRate = 1;
      const source = createSource(internal, ctx, internal.positionAtLastUpdate);
      patchTrack(id, { isPlaying: true });

      source.onended = () => {
        if (internal.source === source) {
          internal.source = null;
          internal.positionAtLastUpdate = 0;
          internal.ctxTimeAtLastUpdate = ctx.currentTime;
          patchTrack(id, { isPlaying: false, currentTime: 0 });
        }
      };
    },
    [getCtx, createSource, patchTrack]
  );

  // ---------- Pause ----------
  const pauseTrack = useCallback(
    (id: string) => {
      const ctx = getCtx();
      const internal = internalsRef.current.get(id);
      if (!internal || !internal.source) return;

      freezePosition(internal, ctx);
      internal.source.onended = null;
      internal.source.stop();
      internal.source.disconnect();
      internal.source = null;
      patchTrack(id, { isPlaying: false, currentTime: internal.positionAtLastUpdate });
    },
    [getCtx, freezePosition, patchTrack]
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

      const wasPlaying = !!internal.source;
      const rate = internal.currentRate;
      if (internal.source) {
        internal.source.onended = null;
        internal.source.stop();
        internal.source.disconnect();
        internal.source = null;
      }
      internal.currentRate = rate;
      if (wasPlaying) {
        createSource(internal, ctx, time);
      } else {
        internal.positionAtLastUpdate = time;
        internal.ctxTimeAtLastUpdate = ctx.currentTime;
      }
      patchTrack(id, { currentTime: time });
    },
    [getCtx, createSource, patchTrack]
  );

  // ---------- Scratch: cambiar rate dinámicamente ----------
  const setTrackRate = useCallback(
    (id: string, rate: number) => {
        const ctx = getCtx();
        const internal = internalsRef.current.get(id);
        if (!internal) return;

        const prevRate = internal.currentRate;
        const signChanged = (prevRate > 0 && rate < 0) || (prevRate < 0 && rate >= 0);

        freezePosition(internal, ctx);
        internal.currentRate = rate;

        if (!internal.source) return;

        if (signChanged) {
        const pos = Math.max(0, internal.positionAtLastUpdate);
        internal.source.onended = null;
        try { internal.source.stop(); } catch { /* noop */ }
        internal.source.disconnect();

        const source = ctx.createBufferSource();
        source.buffer = internal.buffer;
        source.playbackRate.value = rate;
        source.connect(internal.gain);
        source.start(0, pos);
        internal.source = source;
        internal.positionAtLastUpdate = pos;
        internal.ctxTimeAtLastUpdate = ctx.currentTime;

        const sourceRef = source;
        source.onended = () => {
            if (internal.source === sourceRef) {
            internal.source = null;
            internal.positionAtLastUpdate = 0;
            internal.ctxTimeAtLastUpdate = ctx.currentTime;
            patchTrack(id, { isPlaying: false, currentTime: 0 });
            }
        };
        } else {
        internal.source.playbackRate.value = rate;
        }
    },
    [getCtx, freezePosition, patchTrack]
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

  const setTrackCover = useCallback(
    (id: string, coverUrl: string | null) => {
      patchTrack(id, { coverUrl });
    },
    [patchTrack]
  );

  // ---------- Rastreo de posición ----------
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
            const newPos = Math.min(
              Math.max(getPosition(internal, ctx), 0),
              t.duration
            );
            if (Math.abs(newPos - t.currentTime) > 0.05) {
              changed = true;
              return { ...t, currentTime: newPos };
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
  }, [getPosition]);

  return {
    tracks,
    addTrack,
    playTrack,
    pauseTrack,
    toggleTrack,
    seekTrack,
    setTrackRate,
    setTrackVolume,
    setTrackCover,
  };
}