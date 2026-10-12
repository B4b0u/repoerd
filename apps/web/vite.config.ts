import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { workspaceAliases } from '../../workspace-aliases.ts'

const SERVER_DIR = fileURLToPath(new URL('../server/', import.meta.url))
const readEnvFile = (name: string): Record<string, string | undefined> => {
  const file = `${SERVER_DIR}${name}`
  return existsSync(file) ? parseEnv(readFileSync(file, 'utf8')) : {}
}
// The dev port of the API is the server's own, with the server's precedence: the shell's PORT,
// then `.env`, then `.env.development`, then 3100; an empty value counts as absent.
// REPOERD_API_URL points a second dev stack to another API (e.g. a fake-mode check next to a
// real-mode pnpm dev).
const fromEnv = (name: string): string | undefined => readEnvFile(name).PORT || undefined
const API_PORT = process.env.PORT || fromEnv('.env') || fromEnv('.env.development') || '3100'
const API_URL = process.env.REPOERD_API_URL ?? `http://localhost:${API_PORT}`

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // The version this build belongs to (the image's REPOERD_VERSION): compared with the API's.
  define: { __REPOERD_WEB_VERSION__: JSON.stringify(process.env.REPOERD_VERSION || 'dev') },
  resolve: {
    // `@/` is the alias of the shadcn/ui primitives (components.json).
    alias: { ...workspaceAliases, '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    manifest: true,
    rolldownOptions: {
      output: {
        // Stable vendor code in its own files: it stays cached from one release to the next.
        codeSplitting: {
          groups: [
            {
              name: 'react',
              test: /[\\/]node_modules[\\/](react|react-dom|scheduler|use-sync-external-store)[\\/]/,
              priority: 3,
            },
            { name: 'radix', test: /[\\/]node_modules[\\/](@radix-ui|radix-ui)[\\/]/, priority: 2 },
            { name: 'xyflow', test: /[\\/]node_modules[\\/]@xyflow[\\/]/, priority: 1 },
            // The Zod config must run before the first schema is built: keep them in one chunk, in import order.
            {
              name: 'zod',
              test: /[\\/](node_modules[\\/]zod[\\/]|shared[\\/]api[\\/]zod-config|packages[\\/]contracts[\\/])/,
              priority: 4,
            },
          ],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': API_URL,
      '/healthz': API_URL,
      // OAuth and the App manifest flow are full-page navigations handled by the API.
      '/auth': API_URL,
      '/setup/github': API_URL,
    },
  },
})
