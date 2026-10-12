import { useSyncExternalStore } from 'react'

/** Replaced at build time by vite.config.ts (REPOERD_VERSION); absent in the unit tests. */
declare const __REPOERD_WEB_VERSION__: string | undefined

/** The version this web build belongs to: REPOERD_VERSION at build time, 'dev' otherwise. */
export const WEB_VERSION: string =
  typeof __REPOERD_WEB_VERSION__ === 'string' ? __REPOERD_WEB_VERSION__ : 'dev'

let serverVersion: string | null = null
// The version whose banner the user closed; the banner comes back for yet another version.
const DISMISSED_KEY = 'repoerd.dismissedVersion'
let dismissedVersion: string | null = readDismissed()

function readDismissed(): string | null {
  try {
    return sessionStorage.getItem(DISMISSED_KEY)
  } catch {
    return null // storage blocked or absent: the choice then lasts until the next reload
  }
}
const listeners = new Set<() => void>()

/** Remembers the version the API answered with (header x-repoerd-version). */
export function noteServerVersion(version: string | null): void {
  if (!version || version === serverVersion) return
  serverVersion = version
  for (const listener of listeners) listener()
}

/** The API answers with another version than the one this page was built with. */
export function isNewVersionAvailable(): boolean {
  return (
    serverVersion !== null && serverVersion !== WEB_VERSION && serverVersion !== dismissedVersion
  )
}

/** Hides the banner until the server reports yet another version. */
export function dismissNewVersion(): void {
  dismissedVersion = serverVersion
  try {
    if (dismissedVersion) sessionStorage.setItem(DISMISSED_KEY, dismissedVersion)
  } catch {
    // In-memory only.
  }
  for (const listener of listeners) listener()
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useNewVersionAvailable(): boolean {
  return useSyncExternalStore(subscribe, isNewVersionAvailable)
}

/** Tests only: forgets the version the API answered with. */
export function resetServerVersion(): void {
  serverVersion = null
  dismissedVersion = null
  try {
    sessionStorage.removeItem(DISMISSED_KEY)
  } catch {
    // Nothing stored.
  }
  for (const listener of listeners) listener()
}
