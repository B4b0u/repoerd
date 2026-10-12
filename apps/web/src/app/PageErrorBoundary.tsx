import { Component, type ErrorInfo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'wouter'
import { Button } from '../shared/ui/button'
import { PageMessage } from '../shared/ui/PageMessage'

function PageLoadFailed() {
  const { t } = useTranslation('common')
  return (
    <div>
      <PageMessage tone="error">{t('pageLoadFailed')}</PageMessage>
      <div className="px-6">
        <Button type="button" onClick={() => window.location.reload()}>
          {t('reload')}
        </Button>
      </div>
    </div>
  )
}

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('A page failed to render', error, info.componentStack)
  }

  render() {
    return this.state.failed ? <PageLoadFailed /> : this.props.children
  }
}

/**
 * A tab opened before an upgrade requests page chunks that no longer exist: without a boundary
 * the failed lazy import would unmount the whole app. Keyed by location so navigating away
 * recovers.
 */
export function PageErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation()
  return <Boundary key={location}>{children}</Boundary>
}
