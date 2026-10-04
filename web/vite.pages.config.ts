import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// A static entry point reuses the trainer without bundling the Worker/server.
export default defineConfig({
  root: fileURLToPath(new URL("./pages", import.meta.url)),
  base: "/chessbot/",
  publicDir: fileURLToPath(new URL("./public", import.meta.url)),
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("./", import.meta.url)) } },
  define: { __DIRECT_LICHESS__: "true" },
  build: {
    outDir: fileURLToPath(new URL("./dist-pages", import.meta.url)),
    emptyOutDir: true,
  },
});
