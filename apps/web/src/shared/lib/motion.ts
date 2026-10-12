/** A viewport animation's duration; 0 when the system asks for reduced motion (spec §6.5). */
export function motionDuration(ms: number): number {
  const reduced =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  return reduced ? 0 : ms
}
