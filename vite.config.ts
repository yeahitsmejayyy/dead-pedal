import { defineConfig } from 'vite'

// Honour an assigned PORT so the dev server can coexist with others on the box.
const port = Number(process.env.PORT) || 5173

export default defineConfig({
  server: { port, strictPort: true },

  /**
   * One dependency-optimiser cache per port, not per project.
   *
   * Two dev servers on the same root is normal here — yours on 5173 while
   * Playwright brings up its own on 5199 — and by default both write to
   * `node_modules/.vite`. They then take turns invalidating each other's
   * pre-bundled deps, which surfaces as a server that looks like it is
   * restarting on its own: repeated "Re-optimizing dependencies", forced page
   * reloads, and 504 Outdated Optimize Dep on a module that was fine a second
   * ago. Nothing is actually wrong with either server; they are fighting over
   * one directory.
   *
   * Keying the cache on the port makes them independent. The cost is one extra
   * pre-bundle the first time a new port is used.
   */
  cacheDir: `node_modules/.vite-${port}`,
})
