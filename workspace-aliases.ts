import { fileURLToPath } from 'node:url'

const source = (pkg: string) =>
  fileURLToPath(new URL(`./packages/${pkg}/src/index.ts`, import.meta.url))

export const workspaceAliases = {
  '@repoerd/model': source('model'),
  '@repoerd/schema-core': source('schema-core'),
  '@repoerd/contracts': source('contracts'),
}
