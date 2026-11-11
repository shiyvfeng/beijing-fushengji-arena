import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = fileURLToPath(new URL(".", import.meta.url));
const replayOnly = process.env.ARENA_BUILD_REPLAY_ONLY === "1";
const homeOnly = process.env.ARENA_BUILD_HOME_ONLY === "1";
const benchOnly = process.env.ARENA_BUILD_BENCH_ONLY === "1";
const sessionOnly = process.env.ARENA_BUILD_SESSION === "1";

export default defineConfig({
  base: "./",
  build: {
    outDir: benchOnly ? "dist/bench" : "dist/site",
    emptyOutDir: true,
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: sessionOnly
        ? { home: resolve(webRoot, 'index.html'), replay: resolve(webRoot, 'replay.html'), rules: resolve(webRoot, 'rules.html') }
        : benchOnly
        ? { bench: resolve(webRoot, "bench.html") }
        : replayOnly
          ? { replay: resolve(webRoot, "replay.html") }
          : homeOnly
            ? {
              home: resolve(webRoot, "index.html"),
              rules: resolve(webRoot, "rules.html"),
            }
            : {
              bench: resolve(webRoot, "bench.html"),
              home: resolve(webRoot, "index.html"),
              replay: resolve(webRoot, "replay.html"),
              rules: resolve(webRoot, "rules.html"),
            },
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5174,
    strictPort: true,
    allowedHosts: ["terminal.local"],
  },
  preview: {
    host: "127.0.0.1",
    port: 5174,
    strictPort: true,
  },
  plugins: [react()],
});
