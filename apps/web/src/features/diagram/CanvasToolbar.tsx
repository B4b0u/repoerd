import { DISPLAY_MODES, type DisplayMode, isDisplayMode } from '@repoerd/model'
import { Panel, useReactFlow, useViewport } from '@xyflow/react'
import { LayoutGrid, Maximize, Minus, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { formatPercent } from '../../shared/i18n/format'
import { toLanguage } from '../../shared/i18n/i18n'
import { motionDuration } from '../../shared/lib/motion'
import { IconButton } from '../../shared/ui/IconButton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../shared/ui/select'
import { Separator } from '../../shared/ui/separator'

interface Props {
  mode: DisplayMode
  onModeChange: (mode: DisplayMode) => void
  /** Omitted where the layout cannot be rearranged (related-tables view). */
  onRearrange?: () => void
}

/** Floating toolbar at the bottom of the canvas (must be rendered inside <ReactFlow>). */
export function CanvasToolbar({ mode, onModeChange, onRearrange }: Props) {
  const { t, i18n } = useTranslation('diagram')
  const { zoomIn, zoomOut, fitView } = useReactFlow()
  const { zoom } = useViewport()
  return (
    <Panel
      position="bottom-center"
      className="flex items-center gap-1 rounded-lg border bg-card p-1 shadow-md"
    >
      <IconButton label={t('canvas.zoomOut')} onClick={() => void zoomOut()}>
        <Minus />
      </IconButton>
      <span className="min-w-12 text-center text-sm tabular-nums">
        {formatPercent(zoom, toLanguage(i18n.resolvedLanguage))}
      </span>
      <IconButton label={t('canvas.zoomIn')} onClick={() => void zoomIn()}>
        <Plus />
      </IconButton>
      <Separator orientation="vertical" className="mx-1 data-[orientation=vertical]:h-5" />
      <IconButton
        label={t('canvas.fit')}
        onClick={() => void fitView({ duration: motionDuration(200) })}
      >
        <Maximize />
      </IconButton>
      {onRearrange && (
        <IconButton label={t('canvas.rearrange')} onClick={onRearrange}>
          <LayoutGrid />
        </IconButton>
      )}
      <Separator orientation="vertical" className="mx-1 data-[orientation=vertical]:h-5" />
      <Select
        value={mode}
        onValueChange={(value) => {
          if (isDisplayMode(value)) onModeChange(value)
        }}
      >
        <SelectTrigger
          size="sm"
          aria-label={t('canvas.displayMode')}
          className="border-transparent bg-transparent font-medium shadow-none dark:bg-transparent"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {DISPLAY_MODES.map((m) => (
            <SelectItem key={m} value={m}>
              {t(`displayModes.${m}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Panel>
  )
}
