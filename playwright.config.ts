import { defineConfig } from '@playwright/test'

const PORT = 5199

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
    reuseExistingServer: true,
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
