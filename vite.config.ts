import { defineConfig } from 'vite'

// Honour an assigned PORT so the dev server can coexist with others on the box.
const port = Number(process.env.PORT) || 5173

export default defineConfig({
  /**
   * GitHub Pages serves this repo at `/dead-pedal/`, not at a domain root.
   *
   * Everything vite emits — the module bundle, the CSS, and any hashed asset it
   * fingerprints — gets this prefix baked into the URL. Files under `public/`
   * do NOT: vite copies those verbatim and never rewrites references to them,
   * so anything loading them at runtime has to resolve its own path against
   * `import.meta.env.BASE_URL`.
   */
  base: process.env.GITHUB_ACTIONS ? '/dead-pedal/' : '/',

  server: {
    port,
    strictPort: true,
    /**
     * Don't watch the test tree.
     *
     * The visual fixture is a PNG under `tests/e2e/fixtures/`, written by the
     * test run itself when it is missing. That file appearing inside the vite
     * root pokes the watcher, and a full reload arriving mid-test breaks the
     * one test that drives its own clock — which is exactly what happened on
     * the first run after a re-record, and only that run. Nothing under
     * `tests/` is ever served to the browser, so there is nothing to watch.
     */
    watch: { ignored: ['**/tests/**'] },
  },

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
