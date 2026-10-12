import {
  type ApiErrorBody,
  type ApiErrorDetails,
  MUTATION_HEADER,
  VERSION_HEADER,
} from '@repoerd/contracts'
import { noteServerVersion } from './version'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: ApiErrorDetails = {},
    /** Seconds the server asked to wait (`retry-after`), when it did. */
    readonly retryAfterSeconds?: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

function retryAfterSeconds(response: Response): number | undefined {
  const seconds = Number(response.headers.get('retry-after'))
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined
}

async function request(path: string, init: RequestInit): Promise<unknown> {
  const response = await fetch(path, init)
  // A server upgraded since this page was loaded: the banner offers to reload.
  noteServerVersion(response.headers.get(VERSION_HEADER))
  if (response.status === 204) return undefined
  const data: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const error = (data as Partial<ApiErrorBody> | null)?.error
    throw new ApiError(
      response.status,
      error?.code ?? 'unknown',
      error?.message ?? response.statusText,
      error?.details ?? {},
      retryAfterSeconds(response),
    )
  }
  return data
}

export async function apiGet<T>(path: string): Promise<T> {
  return (await request(path, { headers: { accept: 'application/json' } })) as T
}

const KEEPALIVE_MAX_BYTES = 60_000 // browsers cap keepalive bodies at 64 KiB (bytes, not characters)

export async function apiSend(
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  options?: { keepalive?: boolean; signal?: AbortSignal },
): Promise<void> {
  const json = body === undefined ? undefined : JSON.stringify(body)
  await request(path, {
    method,
    headers: { 'content-type': 'application/json', [MUTATION_HEADER]: '1' },
    body: json,
    signal: options?.signal,
    // Over the cap the request is still sent, just without keepalive.
    keepalive:
      options?.keepalive === true &&
      (json === undefined ? 0 : new TextEncoder().encode(json).byteLength) <= KEEPALIVE_MAX_BYTES,
  })
}

/** A mutation with a JSON answer (apiSend is for 204 responses). */
export async function apiSendJson<T>(
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  return (await request(path, {
    method,
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      [MUTATION_HEADER]: '1',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })) as T
}

export const apiPost = <T>(path: string, body: unknown) => apiSendJson<T>('POST', path, body)
