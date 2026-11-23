import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig(({ mode, isSsrBuild }) => {
  const game = mode === "game";

  return {
    plugins: [svelte()],
    base: game ? "/static/launcher-ui/" : "/",
    ssr: { noExternal: true },
    server: {
      host: "localhost",
      port: 5173,
      strictPort: true,
      proxy: {
        "/api": "http://127.0.0.1:8080",
        "/health": "http://127.0.0.1:8080",
      },
    },
    build: {
      target: "es2022",
      cssTarget: "chrome100",
      outDir: game
        ? isSsrBuild
          ? "dist/game/server"
          : "dist/game/client"
        : "dist/app",
      manifest: !isSsrBuild,
      rollupOptions: {
        input: game
          ? isSsrBuild
            ? "src/game/server.ts"
            : "src/game/client.ts"
          : "index.html",
        output: isSsrBuild ? { entryFileNames: "entry.js" } : undefined,
      },
    },
  };
});
