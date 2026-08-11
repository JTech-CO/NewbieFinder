import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * 빌드 산출물 배치
 *
 *   dist/
 *   ├── manifest.json          (public/manifest.json → copy-manifest.mjs 가 검증 후 복사)
 *   ├── background.js          (src/background/index.ts, ES Module Service Worker)
 *   ├── finder/index.html      (확장 내부 Finder 페이지)
 *   ├── assets/*               (JS/CSS 청크)
 *   ├── icons/*                (public/icons)
 *   └── images/*               (public/images)
 *
 * CSP 는 `script-src 'self'` 이므로 인라인 스크립트가 생성되면 안 된다.
 * 그래서 modulePreload 폴리필(인라인 스크립트)을 끈다.
 */
export default defineConfig({
  root: "src",
  publicDir: fileURLToPath(new URL("./public", import.meta.url)),
  base: "./",
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    outDir: fileURLToPath(new URL("./dist", import.meta.url)),
    // Windows 에서 Vite 의 dist 삭제가 프로세스를 죽이는 사례가 있어
    // scripts/clean-dist.mjs 로 먼저 지우고 여기서는 비우지 않는다.
    emptyOutDir: false,
    target: "chrome120",
    sourcemap: false,
    cssCodeSplit: true,
    assetsInlineLimit: 0,
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: {
        finder: fileURLToPath(new URL("./src/finder/index.html", import.meta.url)),
        background: fileURLToPath(new URL("./src/background/index.ts", import.meta.url)),
      },
      output: {
        // Service Worker 는 manifest 가 참조하는 고정 경로여야 한다.
        entryFileNames: (chunk) =>
          chunk.name === "background" ? "background.js" : "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
  define: {
    __DEV__: JSON.stringify(process.env.NODE_ENV !== "production"),
  },
});
