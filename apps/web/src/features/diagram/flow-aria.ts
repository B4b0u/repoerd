import type { AriaLabelConfig } from '@xyflow/react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * React Flow's screen reader texts, translated (spec §6.5). Cards and links are out of the tab
 * order and nothing can be selected or deleted: the texts point to the table list instead.
 */
export function useFlowAriaLabels(): Partial<AriaLabelConfig> {
  const { t } = useTranslation('diagram')
  return useMemo<Partial<AriaLabelConfig>>(
    () => ({
      'node.a11yDescription.default': t('a11y.node'),
      'node.a11yDescription.keyboardDisabled': t('a11y.node'),
      'node.a11yDescription.ariaLiveMessage': ({ direction, x, y }) =>
        t('a11y.moved', { direction, x, y }),
      'edge.a11yDescription.default': t('a11y.edge'),
      'controls.ariaLabel': t('a11y.controls'),
      'controls.zoomIn.ariaLabel': t('canvas.zoomIn'),
      'controls.zoomOut.ariaLabel': t('canvas.zoomOut'),
      'controls.fitView.ariaLabel': t('canvas.fit'),
      'controls.interactive.ariaLabel': t('a11y.interactive'),
      'minimap.ariaLabel': t('a11y.minimap'),
      'handle.ariaLabel': t('a11y.handle'),
    }),
    [t],
  )
}
