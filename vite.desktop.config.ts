import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const projectRoot = __dirname;

export default defineConfig({
  root: path.join(projectRoot, "desktop-renderer"),
  base: "./",
  publicDir: path.join(projectRoot, "public"),
  plugins: [react()],
  resolve: {
    alias: [
      { find: "next/dynamic", replacement: path.join(projectRoot, "desktop-renderer/src/next-dynamic.tsx") },
      { find: "@", replacement: projectRoot },
    ],
  },
  define: {
    "process.env.NEXT_PUBLIC_NAUTEX_API_BASE_URL": "undefined",
  },
  build: {
    outDir: path.join(projectRoot, ".desktop-build/renderer"),
    emptyOutDir: true,
    sourcemap: true,
  },
});
