/**
 * Write the model reference sheets to disk.
 *
 * `npm run refsheet` — no dev server needed and nothing to click. Boots vite on
 * an ephemeral port, renders the page, saves the strips and shuts down.
 *
 * The page itself (tools/refsheet.html) is still worth opening by hand when you
 * want to look at a car rather than hand it to something.
 */
import { createServer as createSocketServer } from 'node:net'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from '@playwright/test'
import { createServer } from 'vite'

const OUT = join(process.cwd(), '_art/reference')

/** Ask the OS for a port nobody is on, then let go of it. */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createSocketServer()
    probe.on('error', reject)
    probe.listen(0, () => {
      const address = probe.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      probe.close(() => resolve(port))
    })
  })
}

async function main(): Promise<void> {
  // vite.config.ts reads PORT and sets strictPort, so an inline `port` loses to
  // it and the run dies on "5173 already in use" whenever the dev server is up.
  // Set the env it reads instead, and give this its own optimiser cache: two
  // vite servers sharing `node_modules/.vite` take turns invalidating each
  // other, which presents as a server restarting itself for no reason.
  process.env.PORT = String(await freePort())
  const server = await createServer({
    logLevel: 'warn',
    cacheDir: 'node_modules/.vite-refsheet',
    server: { strictPort: false },
  })
  await server.listen()
  const url = server.resolvedUrls?.local[0] ?? `http://localhost:${process.env.PORT}/`

  const browser = await chromium.launch()
  const page = await browser.newPage()
  const failures: string[] = []
  page.on('pageerror', (error) => failures.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') failures.push(message.text())
  })

  await page.goto(new URL('tools/refsheet.html', url).href)
  await page.waitForFunction(() => '__sheets' in window, undefined, { timeout: 60_000 })

  const sheets = await page.evaluate(() => (window as unknown as { __sheets: { name: string; dataUrl: string }[] }).__sheets)

  mkdirSync(OUT, { recursive: true })
  for (const sheet of sheets) {
    const png = Buffer.from(sheet.dataUrl.split(',')[1] ?? '', 'base64')
    writeFileSync(join(OUT, `${sheet.name}.png`), png)
    console.log(`  ${sheet.name}.png  ${String(Math.round(png.length / 1024))}KB`)
  }

  await browser.close()
  await server.close()

  if (failures.length > 0) {
    console.error(`\n${String(failures.length)} page error(s):`)
    for (const failure of failures) console.error(`  ${failure}`)
    process.exitCode = 1
    return
  }
  if (sheets.length === 0) {
    console.error('\nNo sheets produced — the models did not load.')
    process.exitCode = 1
    return
  }
  console.log(`\n${String(sheets.length)} reference sheets in _art/reference/`)
}

void main()
