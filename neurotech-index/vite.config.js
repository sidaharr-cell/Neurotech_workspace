import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // 5173 by default, but an assigned PORT wins so a second dev server can run
  // alongside one that already holds the default.
  server: { port: Number(process.env.PORT) || 5173, open: true },
  // Vitest transforms JSX through esbuild rather than the react plugin, which
  // defaults to the classic runtime and leaves React undefined in component
  // tests. The app build is unaffected: the plugin already emits automatic.
  esbuild: { jsx: 'automatic' },
})
