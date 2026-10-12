/** Below this zoom, table cards show their name in large type instead of unreadable rows. */
export const OVERVIEW_ZOOM = 0.3

export function applyOverviewZoom(canvas: HTMLElement, zoom: number): void {
  canvas.style.setProperty('--canvas-zoom', String(zoom))
  canvas.toggleAttribute('data-overview', zoom < OVERVIEW_ZOOM)
}
