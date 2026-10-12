import { type RefObject, useEffect, useRef } from 'react'

/** Names the page in the tab, the history and for screen readers: "<title> · RepoERD". */
export function usePageTitle(title: string | undefined): void {
  useEffect(() => {
    document.title = title ? `${title} · RepoERD` : 'RepoERD'
  }, [title])
}

/**
 * The page's heading takes the focus when the page appears, so that keyboard and screen reader
 * users start from it after a navigation. The heading needs `tabIndex={-1}`.
 */
export function useHeadingFocus<T extends HTMLElement>(): RefObject<T | null> {
  const heading = useRef<T>(null)
  useEffect(() => {
    heading.current?.focus({ preventScroll: true })
  }, [])
  return heading
}
