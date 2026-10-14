import { useRef, useState, useCallback, useEffect } from 'react';

export type EQBand = 'low' | 'mid' | 'high';

export interface Track {
  id: string;
  name: string;
  file: File;
  coverUrl: string | null;
  duration: number;
  currentTime: number;
  isPlaying: boolean;
  volume: number;
  baseRate: number;
  eq: { low: number; mid: number; high: number };
}

interface TrackInternal {
  buffer: AudioBuffer;
  source: AudioBufferSourceNode | null;
  gain: GainNode;
  lowShelf: BiquadFilterNode;
  midPeak: BiquadFilterNode;
  highShelf: BiquadFilterNode;
  positionAtLastUpdate: number;
  ctxTimeAtLastUpdate: number;
  currentRate: number;
  baseRate: number;
  isScratching: boolean;   // ← nuevo
}

export function useAudioEngine() {
  const ctxRef = useRef<AudioContext | null>(null);
  const internalsRef = useRef<Map<string, TrackInternal>>(new Map());
  const baseRateAnimationsRef = useRef<Map<string, number>>(new Map());
  const [tracks, setTracks] = useState<Track[]>([]);

  const getCtx = useCallback(() => {
    if (!ctxRef.current) ctxRef.current = new AudioContext();
    return ctxRef.current;
  }, []);

  const patchTrack = useCallback(
    (id: string, patch: Partial<Track> | ((t: Track) => Partial<Track>)) => {
      setTracks((prev) =>
        prev.map((t) => {
          if (t.id !== id) return t;
          const p = typeof patch === 'function' ? patch(t) : patch;
          return { ...t, ...p };
        })
      );
    },
    []
  );

  const freezePosition = useCallback(
    (internal: TrackInternal, ctx: AudioContext) => {
      const elapsed = ctx.currentTime - internal.ctxTimeAtLastUpdate;
      internal.positionAtLastUpdate += elapsed * internal.currentRate;
      internal.ctxTimeAtLastUpdate = ctx.currentTime;
    },
    []
  );

  const getPosition = useCallback(
    (internal: TrackInternal, ctx: AudioContext) => {
      const elapsed = ctx.currentTime - internal.ctxTimeAtLastUpdate;
      return internal.positionAtLastUpdate + elapsed * internal.currentRate;
    },
    []
  );

  const createSource = useCallback(
    (internal: TrackInternal, ctx: AudioContext, offset: number) => {
      const source = ctx.createBufferSource();
      source.buffer = internal.buffer;
      source.playbackRate.value = internal.currentRate || internal.baseRate;
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

      // Cadena: gain → lowShelf → midPeak → highShelf → destination
      const gain = ctx.createGain();
      gain.gain.value = 0.8;

      const lowShelf = ctx.createBiquadFilter();
      lowShelf.type = 'lowshelf';
      lowShelf.frequency.value = 200;
      lowShelf.gain.value = 0;

      const midPeak = ctx.createBiquadFilter();
      midPeak.type = 'peaking';
      midPeak.frequency.value = 1000;
      midPeak.Q.value = 0.7;
      midPeak.gain.value = 0;

      const highShelf = ctx.createBiquadFilter();
      highShelf.type = 'highshelf';
      highShelf.frequency.value = 3500;
      highShelf.gain.value = 0;

      gain.connect(lowShelf);
      lowShelf.connect(midPeak);
      midPeak.connect(highShelf);
      highShelf.connect(ctx.destination);

      const id = crypto.randomUUID();
      internalsRef.current.set(id, {
        buffer,
        source: null,
        gain,
        lowShelf,
        midPeak,
        highShelf,
        positionAtLastUpdate: 0,
        ctxTimeAtLastUpdate: ctx.currentTime,
        currentRate: 1,
        baseRate: 1,
        isScratching: false
      });

      setTracks((prev) => [
        ...prev,
        {
          id,
          name: file.name,
          file,
          coverUrl,
          duration: buffer.duration,
          currentTime: 0,
          isPlaying: false,
          volume: 0.8,
          baseRate: 1,
          eq: { low: 0, mid: 0, high: 0 },
        },
      ]);
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

        // ── Si la posición está al final (o muy cerca), reiniciar desde 0
        if (
        internal.positionAtLastUpdate >= internal.buffer.duration - 0.03 ||
        internal.positionAtLastUpdate < 0
        ) {
        internal.positionAtLastUpdate = 0;
        internal.ctxTimeAtLastUpdate = ctx.currentTime;
        patchTrack(id, { currentTime: 0 });
        }

        internal.currentRate = internal.baseRate;
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
      patchTrack(id, {
        isPlaying: false,
        currentTime: internal.positionAtLastUpdate,
      });
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
      if (internal.source) {
        internal.source.onended = null;
        internal.source.stop();
        internal.source.disconnect();
        internal.source = null;
      }
      if (wasPlaying) {
        createSource(internal, ctx, time);
      } else {
        internal.positionAtLastUpdate = time;
        internal.ctxTimeAtLastUpdate = ctx.currentTime;
      }
      patchTrack(id, { currentTime: time });
      if (time >= internal.buffer.duration - 0.03) {
        internal.positionAtLastUpdate = internal.buffer.duration - 0.03;
        internal.ctxTimeAtLastUpdate = ctx.currentTime;
       }
    },
    [getCtx, createSource, patchTrack]
  );

  // ---------- Scratch rate ----------
  const setTrackRate = useCallback(
    (id: string, rate: number) => {
      const ctx = getCtx();
      const internal = internalsRef.current.get(id);
      if (!internal) return;

      freezePosition(internal, ctx);
      internal.currentRate = rate;

      if (internal.source) {
        internal.source.playbackRate.cancelScheduledValues(ctx.currentTime);
        internal.source.playbackRate.value = rate;
      }
    },
    [getCtx, freezePosition]
  );

  // ---------- Base rate (RPM) ----------
  const setTrackBaseRate = useCallback(
    (id: string, baseRate: number) => {
        const ctx = getCtx();
        const internal = internalsRef.current.get(id);
        if (!internal) return;
        internal.baseRate = baseRate;
        patchTrack(id, { baseRate });

        // Si suena y NO estamos haciendo scratch, aplicar al audio ya
        if (internal.source && !internal.isScratching) {
        freezePosition(internal, ctx);
        internal.currentRate = baseRate;
        internal.source.playbackRate.value = baseRate;
        }
    },
    [getCtx, freezePosition, patchTrack]
    );

    /** Interpola baseRate suavemente hacia un target (easeOutCubic) */
  const setTrackBaseRateSmooth = useCallback(
    (id: string, target: number, duration = 500) => {
        const internal = internalsRef.current.get(id);
        if (!internal) return;

        // Cancelar animación anterior de la misma pista
        const prev = baseRateAnimationsRef.current.get(id);
        if (prev !== undefined) cancelAnimationFrame(prev);

        const from = internal.baseRate;
        const startTime = performance.now();

        const tick = () => {
        const t = Math.min((performance.now() - startTime) / duration, 1);
        const eased = 1 - Math.pow(1 - t, 3);
        const current = from + (target - from) * eased;
        setTrackBaseRate(id, current);
        if (t < 1) {
            baseRateAnimationsRef.current.set(id, requestAnimationFrame(tick));
        } else {
            baseRateAnimationsRef.current.delete(id);
        }
        };
        tick();
    },
    [setTrackBaseRate]
    );

    const beginScratch = useCallback((id: string) => {
    const internal = internalsRef.current.get(id);
    if (internal) internal.isScratching = true;
    }, []);

    const endScratch = useCallback((id: string) => {
    const internal = internalsRef.current.get(id);
    if (internal) internal.isScratching = false;
    }, []);

  // ---------- EQ ----------
  const setTrackEQ = useCallback(
    (id: string, band: EQBand, value: number) => {
      const ctx = getCtx();
      const internal = internalsRef.current.get(id);
      if (!internal) return;
      const node =
        band === 'low'
          ? internal.lowShelf
          : band === 'mid'
          ? internal.midPeak
          : internal.highShelf;
      node.gain.setTargetAtTime(value, ctx.currentTime, 0.01);
      patchTrack(id, (t) => ({ eq: { ...t.eq, [band]: value } }));
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

            const pos = getPosition(internal, ctx);

            // ── Detección de fin de pista (con margen de 30ms)
            if (pos >= t.duration - 0.03) {
                freezePosition(internal, ctx);
                internal.source.onended = null;
                try {
                internal.source.stop();
                } catch {
                /* ya parado */
                }
                internal.source.disconnect();
                internal.source = null;
                internal.positionAtLastUpdate = 0;
                internal.ctxTimeAtLastUpdate = ctx.currentTime;
                changed = true;
                return { ...t, isPlaying: false, currentTime: 0 };
            }

            const newPos = Math.max(pos, 0);
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
    }, [getPosition, freezePosition]);

  return {
    tracks,
    addTrack,
    playTrack,
    pauseTrack,
    toggleTrack,
    seekTrack,
    setTrackRate,
    setTrackBaseRate,
    setTrackBaseRateSmooth,
    setTrackEQ,
    setTrackVolume,
    setTrackCover,
    beginScratch,
    endScratch,
    };
}