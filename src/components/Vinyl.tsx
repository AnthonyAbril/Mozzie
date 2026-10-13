import { useRef, Suspense } from 'react';
import { useFrame } from '@react-three/fiber';
import { useTexture } from '@react-three/drei';
import * as THREE from 'three';

interface VinylProps {
  isPlaying?: boolean;
  coverUrl?: string | null;
}

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

export function Vinyl({ isPlaying = false, coverUrl = null }: VinylProps) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame((_, delta) => {
    if (groupRef.current && isPlaying) {
      groupRef.current.rotation.y += delta * 1.5;
    }
  });

  return (
    <group ref={groupRef}>
      <mesh>
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