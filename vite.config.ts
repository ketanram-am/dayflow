// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// The Dayflow FastAPI backend serves /api; the proxy keeps the session cookie same-origin.
const API = process.env["DAYFLOW_API"] ?? "http://127.0.0.1:8001";

export default defineConfig({
  vite: {
    server: {
      proxy: {
        "/api": {
          target: API,
          changeOrigin: true,
          configure: (proxy) => proxy.on("proxyReq", (req) => req.setHeader("origin", API)),
        },
      },
    },
  },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
