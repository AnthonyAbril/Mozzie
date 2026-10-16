import { useRef, Suspense, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useTexture } from '@react-three/drei';
import * as THREE from 'three';

export function ResponsiveCamera({ baseFov = 45, baseAspect = 1.5 }: { baseFov?: number; baseAspect?: number }) {
  const { camera, size } = useThree();

  useEffect(() => {
    const persp = camera as THREE.PerspectiveCamera;
    const aspect = size.width / size.height;

    if (aspect < baseAspect) {
      // Conserva el mismo campo horizontal que tendría a baseAspect,
      // subiendo el FOV vertical para compensar.
      const halfBaseFov = (baseFov * Math.PI) / 180 / 2;
      const hFovHalf = Math.atan(Math.tan(halfBaseFov) * baseAspect);
      const newVFovHalf = Math.atan(Math.tan(hFovHalf) / aspect);
      const newFov = (newVFovHalf * 2 * 180) / Math.PI;
      persp.fov = Math.min(newFov, 85);
    } else {
      persp.fov = baseFov;
    }
    persp.updateProjectionMatrix();
  }, [camera, size.width, size.height, baseFov, baseAspect]);

  return null;
}

interface Props {
  isPlaying: boolean;
  coverUrl: string | null;
  baseRate: number;
  direction: 1 | -1;         // ← NUEVO
  onScratchStart: () => void;
  onScratchRate: (rate: number) => void;
  onScratchEnd: () => void;
  onSwipe: (direction: 'left' | 'right') => void;
}

const RADS_PER_SEC_33 = (33.333 / 60) * 2 * Math.PI;
const SWIPE_THRESHOLD_PX = 100;
const SLIDE_OUT_DISTANCE = 14;
const SLIDE_DAMPING = 0.18;

const DEFAULT_CAM_POS = new THREE.Vector3(0, 14, 18);
const DEFAULT_TARGET = new THREE.Vector3(0, 0, 0);
const RESET_DURATION_MS = 400;
const MIDDLE_DOUBLE_CLICK_MS = 350;
const MIDDLE_DOUBLE_CLICK_MAX_DIST = 6;

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
  baseRate,
  direction,      // ← NUEVO
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
    lastMiddleClick: null as { time: number; x: number; y: number } | null,
  });

  const reset = useRef({
    active: false,
    startTime: 0,
    fromPos: new THREE.Vector3(),
    fromTarget: new THREE.Vector3(),
  });

  const { camera, gl, controls } = useThree();

  useFrame((_, delta) => {
    const s = state.current;
    const r = reset.current;
    const ctrl = controls as any;

    // ── 1. Auto-rotación del disco (SIEMPRE, independiente del reset)
    if (groupRef.current && s.mode !== 'scratch' && isPlaying) {
      groupRef.current.rotation.y += delta * RADS_PER_SEC_33 * baseRate * direction;
    }

    // ── 2. Animación de reset de cámara (no corta el resto)
    if (r.active) {
      const t = Math.min(
        (performance.now() - r.startTime) / RESET_DURATION_MS,
        1
      );
      const eased = 1 - Math.pow(1 - t, 3);

      camera.position.lerpVectors(r.fromPos, DEFAULT_CAM_POS, eased);
      if (ctrl) {
        ctrl.target.lerpVectors(r.fromTarget, DEFAULT_TARGET, eased);
        ctrl.update();
      }
      if (t >= 1) {
        r.active = false;
        if (ctrl) ctrl.enabled = true;
      }
    }

    if (!groupRef.current) return;

    // ── 3. Detección de ratón quieto durante scratch
    if (s.mode === 'scratch') {
      const idle = performance.now() - s.lastTime;
      if (idle > 50) onScratchRate(0.001);
    }

    // ── 4. Interpolación del swipe
    const diff = s.swipeTarget - s.swipeOffset;
    s.swipeOffset += diff * SLIDE_DAMPING;
    if (Math.abs(diff) < 0.01) s.swipeOffset = s.swipeTarget;

    groupRef.current.position.x = s.swipeOffset;
    groupRef.current.rotation.z = -s.swipeOffset * 0.04;

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

    const getDiscHit = (clientX: number, clientY: number) => {
      if (!discRef.current) return null;
      const r = canvas.getBoundingClientRect();
      pointer.x = ((clientX - r.left) / r.width) * 2 - 1;
      pointer.y = -((clientY - r.top) / r.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObject(discRef.current, false);
      return hits.length > 0;
    };

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
      const ctrl = controls as any;

      // ── Doble clic del botón central → reset de cámara
      if (e.button === 1) {
        const now = performance.now();
        const last = s.lastMiddleClick;
        if (
          last &&
          now - last.time < MIDDLE_DOUBLE_CLICK_MS &&
          Math.abs(e.clientX - last.x) < MIDDLE_DOUBLE_CLICK_MAX_DIST &&
          Math.abs(e.clientY - last.y) < MIDDLE_DOUBLE_CLICK_MAX_DIST
        ) {
          s.lastMiddleClick = null;
          if (ctrl) {
            reset.current.active = true;
            reset.current.startTime = now;
            reset.current.fromPos.copy(camera.position);
            reset.current.fromTarget.copy(ctrl.target);
            ctrl.enabled = false;
          }
        } else {
          s.lastMiddleClick = { time: now, x: e.clientX, y: e.clientY };
        }
        // No bloqueamos el evento: OrbitControls también lo recibe
        return;
      }

      if (s.mode !== 'idle') return;

      if (e.button === 0) {
        if (!getDiscHit(e.clientX, e.clientY)) return;
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
        if (angle === null) return;

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
  }, [camera, gl, controls, isPlaying, onScratchStart, onScratchRate, onScratchEnd, onSwipe]);

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