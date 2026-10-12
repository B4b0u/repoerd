import { useEffect } from 'react'

/** While `active`, a reload, a closed tab or another site asks the browser's confirmation first. */
export function useBeforeUnload(active: boolean): void {
  useEffect(() => {
    if (!active) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = '' // older browsers only ask when this is set
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [active])
}
