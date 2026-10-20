import { useRef, useState, useCallback, useEffect } from "react";
import { loadAllDiscThemes, saveDiscTheme } from "../utils/themeStorage";

export type EQBand = "low" | "mid" | "high";
export type PlayMode = "single" | "continuous" | "loop";

interface EngineOptions {
  onTrackEnd?: (trackId: string) => void;
}

export interface Track {
  id: string;
  stableKey: string;
  name: string;
  file: File;
  sourcePath: string | null;
  coverUrl: string | null;
  availableCovers: string[]; // ← NUEVO
  duration: number;
  currentTime: number;
  isPlaying: boolean;
  volume: number;
  baseRate: number;
  direction: 1 | -1;
  eq: { low: number; mid: number; high: number };
  pan: number;
  reverb: number;
  themeColors: [string, string, string] | null; // <--- Ahora es de 3
  themeMode: "disc" | "custom";
  customThemeColors: [string, string, string] | null; // <--- Ahora acepta 3
  contentHash: string;
}

interface TrackInternal {
  buffer: AudioBuffer | null; // ✅ Ahora puede ser null si se ha purgado
  rawArrayBuffer: ArrayBuffer | null; // ✅ Ahora puede ser null
  sourcePath: string | null; // ✅ AÑADIR ESTO
  reversedBuffer: AudioBuffer | null;
  source: AudioBufferSourceNode | null;
  sourceIsReversed: boolean;
  gain: GainNode;
  lowShelf: BiquadFilterNode;
  midPeak: BiquadFilterNode;
  highShelf: BiquadFilterNode;
  panner: StereoPannerNode;
  dryGain: GainNode;
  wetGain: GainNode;
  convolver: ConvolverNode;
  positionAtLastUpdate: number;
  ctxTimeAtLastUpdate: number;
  currentRate: number;
  baseRate: number;
  direction: 1 | -1;
  isScratching: boolean;
}

const MIN_ABS_RATE = 0.001;
const END_MARGIN = 0.03;

function createImpulseResponse(ctx: AudioContext, duration = 2.2, decay = 2.4) {
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * duration);
  const impulse = ctx.createBuffer(2, length, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return impulse;
}

export function useAudioEngine(options: EngineOptions = {}) {
  const onTrackEndRef = useRef(options.onTrackEnd);
  onTrackEndRef.current = options.onTrackEnd;

  const ctxRef = useRef<AudioContext | null>(null);
  const internalsRef = useRef<Map<string, TrackInternal>>(new Map());
  const baseRateAnimationsRef = useRef<Map<string, number>>(new Map());
  const impulseRef = useRef<AudioBuffer | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const analyserRef = useRef<AnalyserNode | null>(null);

  const getCtx = useCallback(() => {
    if (!ctxRef.current) {
      ctxRef.current = new AudioContext();
      analyserRef.current = ctxRef.current.createAnalyser();
      analyserRef.current.fftSize = 256;
      analyserRef.current.connect(ctxRef.current.destination);
    }
    return ctxRef.current;
  }, []);

  const getImpulse = useCallback((ctx: AudioContext) => {
    if (!impulseRef.current) impulseRef.current = createImpulseResponse(ctx);
    return impulseRef.current;
  }, []);

  const patchTrack = useCallback(
    (id: string, patch: Partial<Track> | ((t: Track) => Partial<Track>)) => {
      setTracks((prev) =>
        prev.map((t) => {
          if (t.id !== id) return t;
          const p = typeof patch === "function" ? patch(t) : patch;
          return { ...t, ...p };
        }),
      );
    },
    [],
  );

  const freezePosition = useCallback(
    (internal: TrackInternal, ctx: AudioContext) => {
      const elapsed = ctx.currentTime - internal.ctxTimeAtLastUpdate;
      internal.positionAtLastUpdate += elapsed * internal.currentRate;
      internal.ctxTimeAtLastUpdate = ctx.currentTime;
    },
    [],
  );

  const getPosition = useCallback(
    (internal: TrackInternal, ctx: AudioContext) => {
      const elapsed = ctx.currentTime - internal.ctxTimeAtLastUpdate;
      return internal.positionAtLastUpdate + elapsed * internal.currentRate;
    },
    [],
  );

  const getOrCreateReversedBuffer = useCallback(
    (internal: TrackInternal, ctx: AudioContext): AudioBuffer => {
      if (internal.reversedBuffer) return internal.reversedBuffer;
      const normal = internal.buffer;
      const len = normal.length;
      const reversed = ctx.createBuffer(
        normal.numberOfChannels,
        len,
        normal.sampleRate,
      );
      for (let ch = 0; ch < normal.numberOfChannels; ch++) {
        const src = normal.getChannelData(ch);
        const dst = reversed.getChannelData(ch);
        for (let i = 0; i < len; i++) dst[i] = src[len - 1 - i];
      }
      internal.reversedBuffer = reversed;
      return reversed;
    },
    [],
  );

  const startSourceAt = useCallback(
    (
      internal: TrackInternal,
      ctx: AudioContext,
      position: number,
      isReversed: boolean,
    ): AudioBufferSourceNode | null => {
      const buffer = isReversed
        ? getOrCreateReversedBuffer(internal, ctx)
        : internal.buffer;

      const trackDuration = internal.buffer.duration;
      const clamped = Math.max(0, Math.min(position, trackDuration));

      let offset = isReversed ? trackDuration - clamped : clamped;
      offset = Math.max(0, Math.min(offset, buffer.duration - 0.005));

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = Math.max(
        Math.abs(internal.currentRate),
        MIN_ABS_RATE,
      );
      source.connect(internal.gain);
      source.start(0, offset);

      internal.source = source;
      internal.sourceIsReversed = isReversed;
      internal.positionAtLastUpdate = clamped;
      internal.ctxTimeAtLastUpdate = ctx.currentTime;
      return source;
    },
    [getOrCreateReversedBuffer],
  );

  const attachOnended = useCallback(
    (
      source: AudioBufferSourceNode,
      internal: TrackInternal,
      id: string,
      ctx: AudioContext,
    ) => {
      source.onended = () => {
        // Si el bucle de seguridad ya lo limpió, no hacemos nada
        if (internal.source !== source) return;

        if (internal.isScratching) {
          const trackDur = internal.buffer.duration;
          const pos = internal.positionAtLastUpdate;
          if (pos <= 0) internal.positionAtLastUpdate = 0;
          else if (pos >= trackDur) internal.positionAtLastUpdate = trackDur;
          internal.ctxTimeAtLastUpdate = ctx.currentTime;
          internal.source = null;
          return;
        }

        internal.source = null;
        internal.positionAtLastUpdate = 0;
        internal.ctxTimeAtLastUpdate = ctx.currentTime;
        patchTrack(id, { isPlaying: false, currentTime: 0 });
        
        // ✅ Retraso milimétrico para asegurar que React actualiza la UI
        setTimeout(() => {
          onTrackEndRef.current?.(id);
        }, 0);
      };
    },
    [patchTrack],
  );

  const addTrackFromArrayBuffer = useCallback(
    async (
      name: string,
      stableKey: string,
      arrayBuffer: ArrayBuffer,
      coverUrl: string | null = null,
      sourcePath: string | null = null,
      contentHash: string = "",
    ): Promise<string> => {
      const ctx = getCtx();

      // ✅ NUEVO: Decodificamos temporalmente solo para obtener la duración
      const tempBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
      const duration = tempBuffer.duration;

      const gain = ctx.createGain();
      gain.gain.value = 0.8;

      const lowShelf = ctx.createBiquadFilter();
      lowShelf.type = "lowshelf";
      lowShelf.frequency.value = 200;
      lowShelf.gain.value = 0;

      const midPeak = ctx.createBiquadFilter();
      midPeak.type = "peaking";
      midPeak.frequency.value = 1000;
      midPeak.Q.value = 0.7;
      midPeak.gain.value = 0;

      const highShelf = ctx.createBiquadFilter();
      highShelf.type = "highshelf";
      highShelf.frequency.value = 3500;
      highShelf.gain.value = 0;

      const panner = ctx.createStereoPanner();
      panner.pan.value = 0;

      const dryGain = ctx.createGain();
      dryGain.gain.value = 1;

      const wetGain = ctx.createGain();
      wetGain.gain.value = 0;

      const convolver = ctx.createConvolver();
      convolver.buffer = getImpulse(ctx);

      const storedTheme = loadAllDiscThemes()[stableKey];

      gain.connect(lowShelf);
      lowShelf.connect(midPeak);
      midPeak.connect(highShelf);
      highShelf.connect(panner);
      panner.connect(dryGain);
      dryGain.connect(analyserRef.current || ctx.destination); // <- Conectado al analizador
      panner.connect(wetGain);
      wetGain.connect(convolver);
      convolver.connect(ctx.destination);

      const id = crypto.randomUUID();
      const file = new File([arrayBuffer], name, { type: "audio/mpeg" });

      internalsRef.current.set(id, {
        buffer: null, // ✅ No guardamos el audio decodificado
        rawArrayBuffer: sourcePath ? null : arrayBuffer, // ✅ Si viene de disco, no lo guardamos en RAM
        sourcePath, // ✅ Añade esto para que playTrack sepa de dónde leer
        reversedBuffer: null,
        source: null,
        sourceIsReversed: false,
        gain,
        lowShelf,
        midPeak,
        highShelf,
        panner,
        dryGain,
        wetGain,
        convolver,
        positionAtLastUpdate: 0,
        ctxTimeAtLastUpdate: ctx.currentTime,
        currentRate: 1,
        baseRate: 1,
        direction: 1,
        isScratching: false,
      });

      setTracks((prev) => [
        ...prev,
        {
          id,
          stableKey,
          name,
          file,
          sourcePath,
          coverUrl,
          availableCovers: [],
          contentHash,
          duration: duration,
          currentTime: 0,
          isPlaying: false,
          volume: 0.8,
          baseRate: 1,
          direction: 1,
          eq: { low: 0, mid: 0, high: 0 },
          pan: 0,
          reverb: 0,
          themeColors: null,
          themeMode: storedTheme?.mode ?? "disc",
          customThemeColors: storedTheme?.customColors ?? null,
        },
      ]);

      return id;
    },
    [getCtx, getImpulse, getOrCreateReversedBuffer],
  );

  const setTrackAvailableCovers = useCallback(
    (id: string, covers: string[]) => patchTrack(id, { availableCovers: covers }),
    [patchTrack]
  );

    // ✅ NUEVA FUNCIÓN: Libera memoria de las pistas que no estén sonando
  const purgeOldBuffers = useCallback((keepId: string) => {
    let decodedCount = 0;
    const idsToPurge: string[] = [];

    internalsRef.current.forEach((internal, id) => {
      if (internal.buffer) {
        decodedCount++;
        if (id !== keepId) idsToPurge.push(id);
      }
    });

    if (decodedCount > 3) {
      const purgeTarget = decodedCount - 3;
      for (let i = 0; i < purgeTarget; i++) {
        if (idsToPurge[i]) {
          const internal = internalsRef.current.get(idsToPurge[i]);
          if (internal) {
            internal.buffer = null; 
            internal.reversedBuffer = null;
            internal.rawArrayBuffer = null; // ✅ Liberamos también el MP3 crudo
          }
        }
      }
    }
  }, []);

  // ─── VOLUMEN DEL ANALIZADOR ───
  const getAnalyserVolume = useCallback(() => {
    if (!analyserRef.current) return 0;
    const data = new Uint8Array(analyserRef.current.frequencyBinCount);
    analyserRef.current.getByteTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const val = (data[i] - 128) / 128;
      sum += val * val;
    }
    return Math.sqrt(sum / data.length);
  }, []);

  const addTrack = useCallback(
    async (file: File, coverUrl: string | null = null): Promise<string> => {
      const arrayBuffer = await file.arrayBuffer();
      const stableKey = `${file.name}_${file.size}`;
      return addTrackFromArrayBuffer(file.name, stableKey, arrayBuffer, coverUrl, null);
    },
    [addTrackFromArrayBuffer],
  );

  const clearAll = useCallback(() => {
    for (const internal of internalsRef.current.values()) {
      if (internal.source) {
        internal.source.onended = null;
        try { internal.source.stop(); } catch {}
        internal.source.disconnect();
      }
      internal.gain.disconnect();
      internal.lowShelf.disconnect();
      internal.midPeak.disconnect();
      internal.highShelf.disconnect();
      internal.panner.disconnect();
      internal.dryGain.disconnect();
      internal.wetGain.disconnect();
      internal.convolver.disconnect();
    }
    internalsRef.current.clear();
    setTracks([]);
  }, []);

  const reorderTracks = useCallback((orderedIds: string[]) => {
    setTracks((prev) => {
      const map = new Map(prev.map((t) => [t.id, t]));
      return orderedIds.map((id) => map.get(id)).filter((t): t is Track => t !== undefined);
    });
  }, []);

  const playTrack = useCallback(
    async (id: string) => {
      const ctx = getCtx();
      const internal = internalsRef.current.get(id);
      
      if (!internal) return;

            // ✅ 1. Si el buffer fue purgado, lo decodificamos de nuevo
      if (!internal.buffer) {
        try {
          // Si también purgamos el arrayBuffer, lo leemos del disco
          if (!internal.rawArrayBuffer) {
            // ✅ CORREGIDO: Usamos internal.sourcePath en lugar del estado tracks
            if (internal.sourcePath && window.mozzie) {
              const res = await window.mozzie.readFile(internal.sourcePath);
              if (res.ok) internal.rawArrayBuffer = res.data;
            }
          }

          if (!internal.rawArrayBuffer) throw new Error("No hay archivo disponible");

          // Re-decodificamos el archivo original
          internal.buffer = await ctx.decodeAudioData(internal.rawArrayBuffer.slice(0)); 
        } catch (err) {
          console.error("Error re-decodificando audio:", err);
          return;
        }
      }

      // ✅ 2. Purgamos la RAM de las canciones viejas
      purgeOldBuffers(id);

      // ✅ FORZAR LIMPIEZA: Si ya había un source colgado, lo destruimos
      if (internal.source) {
        internal.source.onended = null;
        try { internal.source.stop(); } catch {}
        internal.source.disconnect();
        internal.source = null;
      }

      if (internal.positionAtLastUpdate >= internal.buffer.duration - END_MARGIN) {
        internal.positionAtLastUpdate = 0;
        internal.ctxTimeAtLastUpdate = ctx.currentTime;
        patchTrack(id, { currentTime: 0 });
      } else if (internal.direction === -1 && internal.positionAtLastUpdate <= END_MARGIN) {
        internal.positionAtLastUpdate = internal.buffer.duration;
        internal.ctxTimeAtLastUpdate = ctx.currentTime;
        patchTrack(id, { currentTime: internal.buffer.duration });
      }

      internal.currentRate = internal.direction * Math.abs(internal.baseRate);

      const startPlayback = () => {
        const source = startSourceAt(internal, ctx, internal.positionAtLastUpdate, internal.direction === -1);
        if (!source) return;
        attachOnended(source, internal, id, ctx);
        patchTrack(id, { isPlaying: true });
      };

      if (ctx.state === "suspended") {
        ctx.resume().then(startPlayback).catch(console.warn);
      } else {
        startPlayback();
      }
    },
    [getCtx, startSourceAt, attachOnended, patchTrack],
  );

  const pauseTrack = useCallback(
    (id: string) => {
      const ctx = getCtx();
      const internal = internalsRef.current.get(id);
      if (!internal || !internal.source) return;

      freezePosition(internal, ctx);
      internal.source.onended = null;
      try { internal.source.stop(); } catch {}
      internal.source.disconnect();
      internal.source = null;
      patchTrack(id, { isPlaying: false, currentTime: internal.positionAtLastUpdate });
    },
    [getCtx, freezePosition, patchTrack],
  );

  const toggleTrack = useCallback(
    (id: string) => {
      const internal = internalsRef.current.get(id);
      if (!internal) return;
      if (internal.source) pauseTrack(id);
      else playTrack(id);
    },
    [playTrack, pauseTrack],
  );

  const seekTrack = useCallback(
    (id: string, time: number) => {
      const ctx = getCtx();
      const internal = internalsRef.current.get(id);
      if (!internal) return;

      const atEnd = time >= internal.buffer.duration - END_MARGIN;
      const wasPlaying = !!internal.source;

      if (internal.source) {
        internal.source.onended = null;
        try { internal.source.stop(); } catch {}
        internal.source.disconnect();
        internal.source = null;
      }

      if (atEnd) {
        internal.positionAtLastUpdate = 0;
        internal.ctxTimeAtLastUpdate = ctx.currentTime;
        patchTrack(id, { currentTime: 0, isPlaying: false });
        return;
      }

      if (wasPlaying) {
        const isReversed = internal.currentRate < 0;
        const source = startSourceAt(internal, ctx, time, isReversed);
        if (source) attachOnended(source, internal, id, ctx);
      } else {
        internal.positionAtLastUpdate = time;
        internal.ctxTimeAtLastUpdate = ctx.currentTime;
      }
      patchTrack(id, { currentTime: time });
    },
    [getCtx, startSourceAt, attachOnended, patchTrack],
  );

  const setTrackRate = useCallback(
    (id: string, rate: number) => {
      const ctx = getCtx();
      const internal = internalsRef.current.get(id);
      if (!internal) return;

      const oldSign = Math.sign(internal.currentRate);
      const newSign = Math.sign(rate);

      freezePosition(internal, ctx);
      internal.currentRate = rate;

      if (!internal.source) {
        if (Math.abs(rate) < MIN_ABS_RATE) return;
        const pos = internal.positionAtLastUpdate;
        const dur = internal.buffer.duration;
        if (rate > 0 && pos >= dur - 0.01) return;
        if (rate < 0 && pos <= 0.01) return;

        const source = startSourceAt(internal, ctx, pos, rate < 0);
        if (source) {
          attachOnended(source, internal, id, ctx);
          patchTrack(id, { isPlaying: true });
        }
        return;
      }

      if (oldSign !== newSign && oldSign !== 0 && newSign !== 0) {
        const pos = Math.max(0, Math.min(internal.positionAtLastUpdate, internal.buffer.duration));
        const oldSource = internal.source;
        oldSource.onended = null;
        try { oldSource.stop(); } catch {}
        oldSource.disconnect();
        internal.source = null;

        const source = startSourceAt(internal, ctx, pos, rate < 0);
        if (source) attachOnended(source, internal, id, ctx);
      } else {
        internal.source.playbackRate.cancelScheduledValues(ctx.currentTime);
        internal.source.playbackRate.value = Math.max(Math.abs(rate), MIN_ABS_RATE);
      }
    },
    [getCtx, freezePosition, startSourceAt, attachOnended, patchTrack],
  );

  const setTrackBaseRate = useCallback(
    (id: string, baseRate: number) => {
      const ctx = getCtx();
      const internal = internalsRef.current.get(id);
      if (!internal) return;
      internal.baseRate = Math.abs(baseRate);
      patchTrack(id, { baseRate: Math.abs(baseRate) });

      if (internal.source && !internal.isScratching) {
        freezePosition(internal, ctx);
        const newRate = internal.direction * Math.abs(baseRate);
        setTrackRate(id, newRate);
      }
    },
    [getCtx, freezePosition, setTrackRate, patchTrack],
  );

  const setTrackBaseRateSmooth = useCallback(
    (id: string, target: number, duration = 500) => {
      const internal = internalsRef.current.get(id);
      if (!internal) return;

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
    [setTrackBaseRate],
  );

  const setTrackDirection = useCallback(
    (id: string, direction: 1 | -1) => {
      const ctx = getCtx();
      const internal = internalsRef.current.get(id);
      if (!internal) return;

      internal.direction = direction;
      patchTrack(id, { direction });

      if (internal.source && !internal.isScratching) {
        const newRate = direction * Math.abs(internal.baseRate);
        setTrackRate(id, newRate);
      } else if (!internal.source) {
        internal.currentRate = direction * Math.abs(internal.baseRate);
      }
    },
    [getCtx, patchTrack, setTrackRate],
  );

  const beginScratch = useCallback((id: string) => {
    const internal = internalsRef.current.get(id);
    if (internal) internal.isScratching = true;
  }, []);

  const endScratch = useCallback((id: string) => {
    const internal = internalsRef.current.get(id);
    if (internal) internal.isScratching = false;
  }, []);

  const setTrackEQ = useCallback(
    (id: string, band: EQBand, value: number) => {
      const ctx = getCtx();
      const internal = internalsRef.current.get(id);
      if (!internal) return;
      const node = band === "low" ? internal.lowShelf : band === "mid" ? internal.midPeak : internal.highShelf;
      node.gain.setTargetAtTime(value, ctx.currentTime, 0.01);
      patchTrack(id, (t) => ({ eq: { ...t.eq, [band]: value } }));
    },
    [getCtx, patchTrack],
  );

  const setTrackPan = useCallback(
    (id: string, pan: number) => {
      const ctx = getCtx();
      const internal = internalsRef.current.get(id);
      if (!internal) return;
      const clamped = Math.max(-1, Math.min(1, pan));
      internal.panner.pan.setTargetAtTime(clamped, ctx.currentTime, 0.02);
      patchTrack(id, { pan: clamped });
    },
    [getCtx, patchTrack],
  );

  const setTrackReverb = useCallback(
    (id: string, amount: number) => {
      const ctx = getCtx();
      const internal = internalsRef.current.get(id);
      if (!internal) return;
      const clamped = Math.max(0, Math.min(1, amount));
      internal.wetGain.gain.setTargetAtTime(clamped, ctx.currentTime, 0.05);
      internal.dryGain.gain.setTargetAtTime(1 - clamped * 0.4, ctx.currentTime, 0.05);
      patchTrack(id, { reverb: clamped });
    },
    [getCtx, patchTrack],
  );

  const setTrackVolume = useCallback(
    (id: string, volume: number) => {
      const ctx = getCtx();
      const internal = internalsRef.current.get(id);
      if (!internal) return;
      internal.gain.gain.setTargetAtTime(volume, ctx.currentTime, 0.01);
      patchTrack(id, { volume });
    },
    [getCtx, patchTrack],
  );

  const setTrackCover = useCallback(
    (id: string, coverUrl: string | null) => patchTrack(id, { coverUrl }),
    [patchTrack],
  );

  const setTrackExtractedColors = useCallback(
    (id: string, colors: [string, string, string]) =>
      patchTrack(id, { themeColors: colors }),
    [patchTrack],
  );

  // Busca esta función y cambia el casteo de tipos a [string, string, string]
  const setTrackThemeMode = useCallback(
    (id: string, mode: "disc" | "custom") => {
      setTracks((prev) => {
        const track = prev.find((t) => t.id === id);
        if (!track) return prev;

        let nextCustom = track.customThemeColors;
        if (mode === "custom" && !nextCustom && track.themeColors) {
          nextCustom = [...track.themeColors] as [string, string, string]; // <--- CORREGIDO AQUÍ
        }

        saveDiscTheme(track.stableKey, { mode, customColors: nextCustom });

        return prev.map((t) =>
          t.id === id ? { ...t, themeMode: mode, customThemeColors: nextCustom } : t,
        );
      });
    },
    [],
  );

  const setTrackCustomThemeColors = useCallback(
    (id: string, colors: [string, string, string]) => { // <--- Acepta 3
      setTracks((prev) => {
        const track = prev.find((t) => t.id === id);
        if (track) {
          saveDiscTheme(track.stableKey, { mode: track.themeMode, customColors: colors });
        }
        return prev.map((t) =>
          t.id === id ? { ...t, customThemeColors: colors } : t,
        );
      });
    },
    [],
  );

  const removeTrack = useCallback((id: string) => {
    const internal = internalsRef.current.get(id);
    if (internal) {
      if (internal.source) {
        internal.source.onended = null;
        try { internal.source.stop(); } catch {}
        internal.source.disconnect();
      }
      internal.gain.disconnect();
      internal.lowShelf.disconnect();
      internal.midPeak.disconnect();
      internal.highShelf.disconnect();
      internal.panner.disconnect();
      internal.dryGain.disconnect();
      internal.wetGain.disconnect();
      internal.convolver.disconnect();
      internalsRef.current.delete(id);
    }
    setTracks((prev) => prev.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    let rafId: number;
    let lastUpdate = 0;

    const tick = (time: number) => {
      // ✅ OPTIMIZACIÓN: Solo actualizamos la UI cada 100ms (10 veces por segundo)
      // en lugar de 60 veces por segundo. El oído humano no nota la diferencia,
      // pero la CPU baja drásticamente.
      if (time - lastUpdate < 100) {
        rafId = requestAnimationFrame(tick);
        return;
      }
      lastUpdate = time;

      const ctx = ctxRef.current;
      if (ctx) {
        const endedTracks: string[] = [];

        setTracks((prev) => {
          let changed = false;
          const next = prev.map((t) => {
            const internal = internalsRef.current.get(t.id);
            if (!internal || !internal.source) return t;

            const pos = getPosition(internal, ctx);
            const dur = t.duration;

            if (!internal.isScratching && pos >= dur - END_MARGIN) {
              freezePosition(internal, ctx);
              
              internal.source.onended = null; 
              try { internal.source.stop(); } catch {}
              internal.source.disconnect();
              internal.source = null;
              
              internal.positionAtLastUpdate = 0;
              internal.ctxTimeAtLastUpdate = ctx.currentTime;
              
              changed = true;
              endedTracks.push(t.id);
              return { ...t, isPlaying: false, currentTime: 0 };
            }

            if (internal.isScratching) {
              if (pos < 0) {
                freezePosition(internal, ctx);
                internal.positionAtLastUpdate = 0;
                internal.ctxTimeAtLastUpdate = ctx.currentTime;
                if (internal.source && internal.currentRate < 0) {
                  const src = internal.source;
                  src.onended = null;
                  try { src.stop(); } catch {}
                  src.disconnect();
                  internal.source = null;
                }
                changed = true;
                return { ...t, currentTime: 0 };
              }
              if (pos > dur) {
                freezePosition(internal, ctx);
                internal.positionAtLastUpdate = dur;
                internal.ctxTimeAtLastUpdate = ctx.currentTime;
                if (internal.source && internal.currentRate > 0) {
                  const src = internal.source;
                  src.onended = null;
                  try { src.stop(); } catch {}
                  src.disconnect();
                  internal.source = null;
                }
                changed = true;
                return { ...t, currentTime: dur };
              }
            }

            const newPos = Math.max(0, Math.min(pos, dur));
            if (Math.abs(newPos - t.currentTime) > 0.1) { // Actualizamos cada 0.1s
              changed = true;
              return { ...t, currentTime: newPos };
            }
            return t;
          });
          return changed ? next : prev;
        });

        // Notificar a React fuera del ciclo de renderizado
        if (endedTracks.length > 0) {
          setTimeout(() => {
            for (const id of endedTracks) {
              onTrackEndRef.current?.(id);
            }
          }, 0);
        }
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [getPosition, freezePosition]);

  useEffect(() => {
    return () => {
      if (ctxRef.current && ctxRef.current.state !== 'closed') {
        ctxRef.current.close();
      }
    };
  }, []);

  return {
    tracks,
    addTrack,
    removeTrack,
    addTrackFromArrayBuffer,
    clearAll,
    playTrack,
    pauseTrack,
    toggleTrack,
    seekTrack,
    setTrackRate,
    setTrackBaseRate,
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
    setTrackAvailableCovers, // ← Añadido
    reorderTracks,
    beginScratch,
    endScratch,
    getAnalyserVolume, // ← Añadido
  };
}