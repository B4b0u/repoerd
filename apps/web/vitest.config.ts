import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import { workspaceAliases } from '../../workspace-aliases.ts'

export default defineConfig({
  resolve: {
    alias: { ...workspaceAliases, '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    testTimeout: 30_000,
    setupFiles: ['./test/setup.ts'],
    coverage: { provider: 'v8', reporter: ['text-summary'], include: ['src/**'] },
  },
})
