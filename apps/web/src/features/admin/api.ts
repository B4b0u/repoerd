import {
  type AdminConfigResponse,
  type AdminListResponse,
  type AdminUsersResponse,
  apiPaths,
  type ManifestResponse,
} from '@repoerd/contracts'
import { useQuery } from '@tanstack/react-query'
import { apiGet, apiPost, apiSend, apiSendJson } from '../../shared/api/client'
import type { ExistingAppCredentials } from '../setup/AppRegistration'

export const adminKeys = {
  config: ['admin-config'] as const,
  admins: ['admin-admins'] as const,
  users: ['admin-users'] as const,
}

export function useAdminConfig(enabled: boolean) {
  return useQuery({
    queryKey: adminKeys.config,
    queryFn: () => apiGet<AdminConfigResponse>(apiPaths.adminConfig),
    enabled,
  })
}

export function useAdmins(enabled: boolean) {
  return useQuery({
    queryKey: adminKeys.admins,
    queryFn: () => apiGet<AdminListResponse>(apiPaths.adminAdmins),
    enabled,
  })
}

export const saveAdminConfig = (body: {
  allowedOrgs: string[]
  publicUrl?: string
  version?: string
}) => apiSendJson<AdminConfigResponse>('PUT', apiPaths.adminConfig, body)

export const addAdmin = (login: string) =>
  apiPost<AdminListResponse>(apiPaths.adminAdmins, { login })

export const removeAdmin = (id: string) =>
  apiSendJson<AdminListResponse>('DELETE', apiPaths.adminAdmin(id))

export const startAppReplacement = (organization: string | undefined) =>
  apiPost<ManifestResponse>(apiPaths.adminAppManifest, { organization })

export const replaceWithExistingApp = (credentials: ExistingAppCredentials) =>
  apiSend('POST', apiPaths.adminExistingApp, credentials)

export function useUsers(enabled: boolean) {
  return useQuery({
    queryKey: adminKeys.users,
    queryFn: () => apiGet<AdminUsersResponse>(apiPaths.adminUsers),
    enabled,
  })
}

export const signOutUser = (id: string) =>
  apiSendJson<AdminUsersResponse>('DELETE', apiPaths.adminUserSessions(id))
