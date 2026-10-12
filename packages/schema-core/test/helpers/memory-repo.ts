import type { ReadFiles, TreeEntry } from '@repoerd/model'

export function memoryRepo(files: Record<string, string>) {
  const tree: TreeEntry[] = Object.entries(files).map(([path, content]) => ({
    path,
    sha: `sha:${path}`,
    size: Buffer.byteLength(content),
  }))
  const reads: string[][] = []
  const readFiles: ReadFiles = async (paths) => {
    reads.push([...paths])
    return new Map(
      paths.flatMap((path): [string, string][] => {
        const content = files[path]
        return content === undefined ? [] : [[path, content]]
      }),
    )
  }
  return { tree, readFiles, reads }
}
