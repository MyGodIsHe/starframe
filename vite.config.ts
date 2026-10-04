import { resolve } from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? "/",
  plugins: [react()],
  // The star map and the sigil figure workshop are separate pages: the workshop shows one figure in
  // isolation and has no universe to load, so it is its own entry rather than a mode of the map.
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        sigil: resolve(import.meta.dirname, "sigil.html"),
      },
    },
  },
  test: {
    exclude: ["tests/**", "node_modules/**"],
  },
});
