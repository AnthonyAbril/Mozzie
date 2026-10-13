import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface VinylProps {
  isPlaying?: boolean;
}

export function Vinyl({ isPlaying = false }: VinylProps) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame((_, delta) => {
    if (groupRef.current && isPlaying) {
      groupRef.current.rotation.y += delta * 1.5;
    }
  });

  return (
    <group ref={groupRef}>
      {/* Cuerpo del vinilo */}
      <mesh>
        <cylinderGeometry args={[5, 5, 0.1, 64]} />
        <meshStandardMaterial color="#111111" roughness={0.4} metalness={0.2} />
      </mesh>

      {/* Etiqueta central */}
      <mesh position={[0, 0.051, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[1.5, 32]} />
        <meshStandardMaterial color="#ffffff" roughness={0.8} />
      </mesh>

      {/* MARCADOR: pequeño punto rojo en la etiqueta para ver el giro */}
      <mesh position={[1.1, 0.052, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.12, 16]} />
        <meshBasicMaterial color="#ff3b3b" />
      </mesh>

      {/* Otro marcador en el borde exterior del vinilo */}
      <mesh position={[4.4, 0.052, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.15, 16]} />
        <meshBasicMaterial color="#3b82f6" />
      </mesh>

      {/* Eje central (no gira visualmente pero da igual) */}
      <mesh position={[0, 0.1, 0]}>
        <cylinderGeometry args={[0.08, 0.08, 0.2, 16]} />
        <meshStandardMaterial color="#cccccc" metalness={0.9} roughness={0.1} />
      </mesh>
    </group>
  );
}