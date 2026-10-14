import { useEffect, useRef, useState } from 'react';
import { applyThemeColors } from './useTheme';

interface ThemeColors {
  primary: string;
  bg1: string;
  bg2: string;
}

function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace('#', '');
  return [
    parseInt(m.substring(0, 2), 16),
    parseInt(m.substring(2, 4), 16),
    parseInt(m.substring(4, 6), 16),
  ];
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const h = (v: number) => clamp(v).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

function mixHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return rgbToHex(
    ar + (br - ar) * t,
    ag + (bg - ag) * t,
    ab + (bb - ab) * t
  );
}

export function useAnimatedTheme(target: ThemeColors, duration = 600): ThemeColors {
  const [animated, setAnimated] = useState<ThemeColors>(target);
  const animatedRef = useRef<ThemeColors>(target);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);

    const from = animatedRef.current;
    const to = target;
    const startTime = performance.now();

    const tick = () => {
      const t = Math.min((performance.now() - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      const next: ThemeColors = {
        primary: mixHex(from.primary, to.primary, eased),
        bg1: mixHex(from.bg1, to.bg1, eased),
        bg2: mixHex(from.bg2, to.bg2, eased),
      };
      animatedRef.current = next;
      setAnimated(next);
      applyThemeColors(next.primary, next.bg1, next.bg2);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.primary, target.bg1, target.bg2, duration]);

  return animated;
}