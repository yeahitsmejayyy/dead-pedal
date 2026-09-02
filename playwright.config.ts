import { defineConfig } from '@playwright/test'

/**
 * Distinctive on purpose, and not a default anybody else reaches for.
 *
 * 5199 was taken by an unrelated project's dev server, and because
 * `reuseExistingServer` was true, Playwright adopted it without checking whose
 * it was — so the entire suite ran against a different application and failed
 * in forty-five confusing ways. Playwright cannot tell one vite server from
 * another; only the port can.
 */
const PORT = Number(process.env.E2E_PORT ?? 5273)

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI === undefined ? 'list' : 'dot',
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1280, height: 720 },
  },
  webServer: {
    // PORT rather than `--port`, and the difference matters. A CLI `--port`
    // reaches the dev server but not `vite.config.ts`, which reads the env var
    // to pick a per-port `cacheDir`. Passed as a flag, this server would share
    // `node_modules/.vite` with a dev server already running on 5173, and the
    // two would take turns invalidating each other's pre-bundled deps — which
    // looks, from the outside, like a server restarting on its own.
    command: `PORT=${PORT} npm run dev`,
    url: `http://localhost:${PORT}`,
    /**
     * Never adopt a server this config did not start.
     *
     * Reuse is convenient while iterating, and it is exactly what let a foreign
     * app be tested for a full run. If the port is busy, Playwright now says so
     * and stops, which is the failure worth having: a loud one about the wrong
     * port beats a silent one about the wrong application.
     */
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        // Headless Chromium falls back to SwiftShader for WebGL, which is what
        // CI will use. PLAN.md §6.
        launchOptions: {
          args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
        },
      },
    },
  ],
})
