import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { Route, Switch } from 'wouter'
import { RepoListPage } from '../features/repo-picker/RepoListPage'
import { handleQueryError, shouldRetry } from '../shared/api/session'
import { usePageTitle } from '../shared/lib/page-title'
import { ThemeProvider } from '../shared/theme/theme-context'
import { PageMessage } from '../shared/ui/PageMessage'
import { Toaster } from '../shared/ui/sonner'
import { AppGate } from './AppGate'
import { PageErrorBoundary } from './PageErrorBoundary'
import { VersionBanner } from './VersionBanner'

export function createQueryClient(): QueryClient {
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => handleQueryError(client, error, query.queryKey),
    }),
    // Saves (settings, admin actions…) end the same way when the session expired meanwhile.
    mutationCache: new MutationCache({
      onError: (error) => handleQueryError(client, error, ['mutation']),
    }),
    defaultOptions: { queries: { refetchOnWindowFocus: false, retry: shouldRetry } },
  })
  return client
}

const queryClient = createQueryClient()

// Loaded with their route: the diagram (React Flow) and the admin screens stay out of the code
// downloaded for the repository list.
const AdminPage = lazy(() =>
  import('../features/admin/AdminPage').then((module) => ({ default: module.AdminPage })),
)
const DiagramPage = lazy(() =>
  import('../features/diagram/DiagramPage').then((module) => ({ default: module.DiagramPage })),
)
const RepoSettingsPage = lazy(() =>
  import('../features/repo-settings/RepoSettingsPage').then((module) => ({
    default: module.RepoSettingsPage,
  })),
)
const SetupPage = lazy(() =>
  import('../features/setup/SetupPage').then((module) => ({ default: module.SetupPage })),
)

function PageLoading() {
  const { t } = useTranslation('common')
  return <PageMessage>{t('loading')}</PageMessage>
}

function NotFound() {
  const { t } = useTranslation('common')
  usePageTitle(t('notFoundTitle'))
  return <PageMessage>{t('pageNotFound')}</PageMessage>
}

export function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <AppGate>
          <PageErrorBoundary>
            <Suspense fallback={<PageLoading />}>
              <Switch>
                <Route path="/" component={RepoListPage} />
                <Route path="/setup" component={SetupPage} />
                <Route path="/admin" component={AdminPage} />
                <Route path="/:owner/:repo/settings">
                  {(params) => (
                    // Keyed so another repository never inherits the drafts of the previous one.
                    <RepoSettingsPage
                      key={`${params.owner}/${params.repo}`}
                      owner={params.owner}
                      repo={params.repo}
                    />
                  )}
                </Route>
                <Route path="/:owner/:repo">
                  {(params) => <DiagramPage owner={params.owner} repo={params.repo} />}
                </Route>
                <Route>
                  <NotFound />
                </Route>
              </Switch>
            </Suspense>
          </PageErrorBoundary>
        </AppGate>
        <Toaster position="top-right" offset={60} />
        <VersionBanner />
      </QueryClientProvider>
    </ThemeProvider>
  )
}
