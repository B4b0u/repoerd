/** Content-addressed cache of file contents, keyed by git blob SHA. */
export interface BlobCache {
  getMany(blobShas: string[]): Promise<Map<string, string>>
  putMany(entries: Map<string, string>): Promise<void>
}
