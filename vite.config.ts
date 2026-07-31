import { defineConfig } from 'vite'

// Honour an assigned PORT so the dev server can coexist with others on the box.
const port = Number(process.env.PORT) || 5173

export default defineConfig({
  server: { port, strictPort: true },
})
