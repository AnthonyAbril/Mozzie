import { useRef, Suspense, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useTexture } from '@react-three/drei';
import * as THREE from 'three';

interface Props {
  isPlaying: boolean;
  coverUrl: string | null;
  onScratchStart: () => void;
  onScratchRate: (rate: number) => void;
  onScratchEnd: () => void;
  onSwipe: (direction: 'left' | 'right') => void;
}

const RADS_PER_SEC_33 = (33.333 / 60) * 2 * Math.PI;
const SWIPE_THRESHOLD_PX = 100;
const SLIDE_OUT_DISTANCE = 14;
const SLIDE_DAMPING = 0.18;

function LabelWithCover({ url }: { url: string }) {
  const texture = useTexture(url);
  return (
    <mesh position={[0, 0.051, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <circleGeometry args={[1.5, 64]} />
      <meshBasicMaterial map={texture} toneMapped={false} />
    </mesh>
  );
}

function LabelPlaceholder() {
  return (
    <mesh position={[0, 0.051, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <circleGeometry args={[1.5, 64]} />
      <meshStandardMaterial color="#ffffff" roughness={0.8} />
    </mesh>
  );
}

export function ScratchableVinyl({
  isPlaying,
  coverUrl,
  onScratchStart,
  onScratchRate,
  onScratchEnd,
  onSwipe,
}: Props) {
  const groupRef = useRef<THREE.Group>(null);
  const discRef = useRef<THREE.Mesh>(null);

  const state = useRef({
    mode: 'idle' as 'idle' | 'scratch' | 'swipe' | 'swipe-out',
    lastAngle: 0,
    lastTime: 0,
    swipeStartX: 0,
    swipeOffset: 0,
    swipeTarget: 0,
    pendingSwipe: null as 'left' | 'right' | null,
  });

  const { camera, gl } = useThree();

  useFrame((_, delta) => {
    const s = state.current;
    if (!groupRef.current) return;

    // Auto-rotación cuando suena y no se está haciendo scratch
    if (s.mode !== 'scratch' && isPlaying) {
      groupRef.current.rotation.y += delta * 1.5;
    }

    // ── NUEVO: si estamos en scratch y el ratón lleva >50ms sin moverse, detener
    if (s.mode === 'scratch') {
      const idle = performance.now() - s.lastTime;
      if (idle > 50) {
      // Decaimiento exponencial hacia 0
      const currentRate = s.lastReportedRate ?? 0;
      const decayed = currentRate * Math.max(0, 1 - (idle - 50) / 200);
      const stopped = Math.abs(decayed) < 0.01 ? 0.001 : decayed;
      onScratchRate(stopped);
    }
    }

    // Interpolación suave del swipe
    const diff = s.swipeTarget - s.swipeOffset;
    s.swipeOffset += diff * SLIDE_DAMPING;
    if (Math.abs(diff) < 0.01) s.swipeOffset = s.swipeTarget;

    groupRef.current.position.x = s.swipeOffset;
    groupRef.current.rotation.z = -s.swipeOffset * 0.04;

    // Cuando termina la animación de salida, cambiamos de pista
    if (s.mode === 'swipe-out' && Math.abs(s.swipeOffset - s.swipeTarget) < 0.15) {
      const dir = s.pendingSwipe;
      s.pendingSwipe = null;
      s.mode = 'idle';
      s.swipeOffset = s.swipeTarget > 0 ? -SLIDE_OUT_DISTANCE : SLIDE_OUT_DISTANCE;
      s.swipeTarget = 0;
      if (dir) onSwipe(dir);
    }
  });

  useEffect(() => {
    const canvas = gl.domElement;
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const planeHit = new THREE.Vector3();

    // Solo para detectar si el click inicial cae dentro del disco
    const getDiscHit = (clientX: number, clientY: number) => {
      if (!discRef.current) return null;
      const r = canvas.getBoundingClientRect();
      pointer.x = ((clientX - r.left) / r.width) * 2 - 1;
      pointer.y = -((clientY - r.top) / r.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObject(discRef.current, false);
      return hits.length > 0;
    };

    // Ángulo sobre un PLANO INFINITO horizontal a la altura del disco.
    // Funciona aunque el ratón esté fuera del disco.
    const getAngleAt = (clientX: number, clientY: number): number | null => {
      if (!groupRef.current) return null;
      const r = canvas.getBoundingClientRect();
      pointer.x = ((clientX - r.left) / r.width) * 2 - 1;
      pointer.y = -((clientY - r.top) / r.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);

      const groupPos = new THREE.Vector3();
      groupRef.current.getWorldPosition(groupPos);
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -groupPos.y);

      if (!raycaster.ray.intersectPlane(plane, planeHit)) return null;

      const dx = planeHit.x - groupPos.x;
      const dz = planeHit.z - groupPos.z;
      return Math.atan2(dx, dz);
    };

    const pxToWorld = () => {
      const persp = camera as THREE.PerspectiveCamera;
      const distance = camera.position.length();
      const worldHeight =
        2 * Math.tan(((persp.fov || 45) * Math.PI) / 180 / 2) * distance;
      return worldHeight / canvas.clientHeight;
    };

    const onDown = (e: PointerEvent) => {
      const s = state.current;
      if (s.mode !== 'idle') return;

      if (e.button === 0) {
        if (!isPlaying) return;
        if (!getDiscHit(e.clientX, e.clientY)) return; // solo arranca sobre el disco
        const angle = getAngleAt(e.clientX, e.clientY);
        if (angle === null) return;

        e.preventDefault();
        e.stopPropagation();
        s.mode = 'scratch';
        s.lastAngle = angle;
        s.lastTime = performance.now();
        canvas.style.cursor = 'none';
        canvas.setPointerCapture(e.pointerId);
        onScratchStart();
      } else if (e.button === 2) {
        e.preventDefault();
        e.stopPropagation();
        s.mode = 'swipe';
        s.swipeStartX = e.clientX;
        s.swipeOffset = 0;
        s.swipeTarget = 0;
        canvas.style.cursor = 'grabbing';
        canvas.setPointerCapture(e.pointerId);
      }
    };

    const onMove = (e: PointerEvent) => {
      const s = state.current;

      if (s.mode === 'scratch') {
        const angle = getAngleAt(e.clientX, e.clientY);
        if (angle === null) return; // sólo si el rayo es paralelo al plano

        let dAngle = angle - s.lastAngle;
        if (dAngle > Math.PI) dAngle -= 2 * Math.PI;
        if (dAngle < -Math.PI) dAngle += 2 * Math.PI;

        const now = performance.now();
        const dt = Math.max((now - s.lastTime) / 1000, 0.001);

        if (groupRef.current) groupRef.current.rotation.y += dAngle;

        const angularVelocity = dAngle / dt;
        const rate = THREE.MathUtils.clamp(
          angularVelocity / RADS_PER_SEC_33,
          -4,
          4
        );
        s.lastReportedRate = rate;
        onScratchRate(rate);

        s.lastAngle = angle;
        s.lastTime = now;
      } else if (s.mode === 'swipe') {
        const dxPx = e.clientX - s.swipeStartX;
        const raw = dxPx * pxToWorld();
        s.swipeTarget = THREE.MathUtils.clamp(
          raw,
          -SLIDE_OUT_DISTANCE,
          SLIDE_OUT_DISTANCE
        );
      }
    };

    const onUp = (e: PointerEvent) => {
      const s = state.current;

      if (s.mode === 'scratch') {
        onScratchEnd();
        s.mode = 'idle';
      } else if (s.mode === 'swipe') {
        const dxPx = e.clientX - s.swipeStartX;
        if (Math.abs(dxPx) > SWIPE_THRESHOLD_PX) {
          s.pendingSwipe = dxPx > 0 ? 'right' : 'left';
          s.swipeTarget = dxPx > 0 ? SLIDE_OUT_DISTANCE : -SLIDE_OUT_DISTANCE;
          s.mode = 'swipe-out';
        } else {
          s.swipeTarget = 0;
          s.mode = 'idle';
        }
      }

      canvas.style.cursor = '';
      if (canvas.hasPointerCapture(e.pointerId)) {
        canvas.releasePointerCapture(e.pointerId);
      }
    };

    canvas.addEventListener('pointerdown', onDown, true);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);

    return () => {
      canvas.removeEventListener('pointerdown', onDown, true);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
    };
  }, [camera, gl, isPlaying, onScratchStart, onScratchRate, onScratchEnd, onSwipe]);

  return (
    <group ref={groupRef}>
      <mesh ref={discRef}>
        <cylinderGeometry args={[5, 5, 0.1, 64]} />
        <meshStandardMaterial color="#111111" roughness={0.4} metalness={0.2} />
      </mesh>
      {coverUrl ? (
        <Suspense fallback={<LabelPlaceholder />}>
          <LabelWithCover url={coverUrl} />
        </Suspense>
      ) : (
        <LabelPlaceholder />
      )}
      <mesh position={[0, 0.1, 0]}>
        <cylinderGeometry args={[0.08, 0.08, 0.2, 16]} />
        <meshStandardMaterial color="#cccccc" metalness={0.9} roughness={0.1} />
      </mesh>
    </group>
  );
}