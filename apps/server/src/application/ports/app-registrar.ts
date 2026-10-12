import type { GitHubAppCredentials } from './instance-config.js'

export interface ExistingAppInput {
  appId: number
  clientId: string
  clientSecret: string
  privateKey: string
}

/** Registers the instance's GitHub App (spec §8). */
export interface AppRegistrar {
  /** Exchanges the manifest-flow code; null when GitHub refuses it (expired or used). */
  convertManifest(code: string): Promise<GitHubAppCredentials | null>
  /** Checks existing credentials against GitHub; null when they do not match an App. */
  verify(input: ExistingAppInput): Promise<GitHubAppCredentials | null>
}
