import { DISPLAY_MODES, type DisplayMode, isDisplayMode } from '@repoerd/model'
import { Panel, useReactFlow, useViewport } from '@xyflow/react'
import { LayoutGrid, Maximize, Minus, Plus, RefreshCw } from 'lucide-react'
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
import { Tabs, TabsList, TabsTrigger } from '../../shared/ui/tabs'
import { useGroupsTranslation } from './groups/groups-i18n'
import type { HubLinksMode } from './hubs'

interface Props {
  mode: DisplayMode
  onModeChange: (mode: DisplayMode) => void
  /** Omitted where the layout cannot be rearranged (related-tables view). */
  onRearrange?: () => void
  /** Shows the groups proposed from the files again; omitted without the right to edit them. */
  onRepropose?: () => void
  /** Resolved hub tables; the selector is shown only when this is non-empty. */
  hubs?: readonly string[]
  hubLinks?: Exclude<HubLinksMode, 'all'>
  onHubLinksChange?: (hubLinks: Exclude<HubLinksMode, 'all'> | undefined) => void
}

/** Floating toolbar at the bottom of the canvas (must be rendered inside <ReactFlow>). */
export function CanvasToolbar({
  mode,
  onModeChange,
  onRearrange,
  onRepropose,
  hubs,
  hubLinks,
  onHubLinksChange,
}: Props) {
  const { t, i18n } = useTranslation('diagram')
  const { t: tGroups } = useGroupsTranslation()
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
      {onRepropose && (
        <IconButton
          label={tGroups('repropose')}
          title={tGroups('reproposeHint')}
          onClick={onRepropose}
        >
          <RefreshCw />
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
      {hubs && hubs.length > 0 && onHubLinksChange && (
        <>
          <Separator orientation="vertical" className="mx-1 data-[orientation=vertical]:h-5" />
          <span className="px-1 text-xs font-medium text-muted-foreground">{t('hub.links')}</span>
          <Tabs
            value={hubLinks ?? 'all'}
            onValueChange={(value) => {
              if (value === 'none' || value === 'first') onHubLinksChange(value)
              else onHubLinksChange(undefined)
            }}
            className="flex-row items-center gap-0"
          >
            <TabsList className="h-7" aria-label={t('hub.links')}>
              <TabsTrigger value="none" className="px-1.5 text-xs">
                {t('hub.none')}
              </TabsTrigger>
              <TabsTrigger value="first" className="px-1.5 text-xs" title={t('hub.firstHint')}>
                {t('hub.first')}
              </TabsTrigger>
              <TabsTrigger value="all" className="px-1.5 text-xs">
                {t('hub.all')}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </>
      )}
    </Panel>
  )
}
