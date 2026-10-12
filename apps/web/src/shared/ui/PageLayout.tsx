import { ArrowLeft } from 'lucide-react'
import type { MouseEvent, ReactNode } from 'react'
import { Link } from 'wouter'
import { useHeadingFocus } from '../lib/page-title'

interface Props {
  title: ReactNode
  /** A link back to the previous page, shown above the title. */
  back?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
}

/** Frame of the pages outside the diagram: a centred column with a title and actions. */
export function PageLayout({ title, back, description, actions, children }: Props) {
  const heading = useHeadingFocus<HTMLHeadingElement>()
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8">
      <header className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          {back}
          <h1
            ref={heading}
            tabIndex={-1}
            className="truncate text-2xl font-semibold tracking-tight outline-none"
          >
            {title}
          </h1>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
      </header>
      {children}
    </main>
  )
}

export function BackLink({
  href,
  children,
  onClick,
}: {
  href: string
  children: ReactNode
  /** Runs first; `event.preventDefault()` keeps the page (to ask a confirmation). */
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground no-underline hover:text-foreground"
    >
      <ArrowLeft className="size-4" />
      {children}
    </Link>
  )
}
