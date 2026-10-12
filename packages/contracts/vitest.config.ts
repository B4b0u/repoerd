import { defineConfig } from 'vitest/config'
import { workspaceAliases } from '../../workspace-aliases.ts'

export default defineConfig({
  resolve: { alias: workspaceAliases },
  test: { coverage: { provider: 'v8', reporter: ['text-summary'], include: ['src/**'] } },
})
