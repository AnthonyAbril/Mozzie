import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  resolve: {
    // MATA el bug de "Multiple instances of Three.js"
    dedupe: ['three', '@react-three/fiber', '@react-three/drei', 'react', 'react-dom'],
    alias: {
      "@": path.join(__dirname, "src"),
      "@comp": path.join(__dirname, "src/components"),
      "@store": path.join(__dirname, "src/stores"),
      "@obj": path.join(__dirname, "src/objects"),
    },
  },
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
  },
  clearScreen: false,
});