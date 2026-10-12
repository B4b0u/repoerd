import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { ThemeProvider } from '../src/shared/theme/theme-context'
import { Toaster } from '../src/shared/ui/sonner'

/** Renders `ui` inside the providers of the app, with its toaster. */
export function renderWithApp(
  ui: ReactNode,
  client = new QueryClient(),
  options: { reactStrictMode?: boolean } = {},
) {
  return render(
    <ThemeProvider>
      <QueryClientProvider client={client}>
        {ui}
        <Toaster />
      </QueryClientProvider>
    </ThemeProvider>,
    options,
  )
}
