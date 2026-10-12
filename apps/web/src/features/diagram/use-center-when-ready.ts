import { useEffect, useRef } from 'react'

/**
 * Centres `table` once the canvas is placed (`ready`): a canvas that mounts with a table to show
 * (back from the related-tables view) is not placed yet when the click asks for it. Once per
 * mount.
 */
export function useCenterWhenReady(
  ready: boolean,
  table: string | undefined,
  center: (table: string) => void,
): void {
  const done = useRef(false)
  useEffect(() => {
    if (!ready || table === undefined || done.current) return
    const frame = requestAnimationFrame(() => {
      done.current = true
      center(table)
    })
    return () => cancelAnimationFrame(frame)
  }, [ready, table, center])
}
