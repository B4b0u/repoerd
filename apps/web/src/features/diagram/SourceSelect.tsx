import type { SourceDto } from '@repoerd/contracts'
import { Database } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../shared/ui/select'

interface Props {
  sources: SourceDto[]
  value: string
  onChange: (sourceId: string) => void
}

export function SourceSelect({ sources, value, onChange }: Props) {
  const { t } = useTranslation('diagram')
  const { t: tCommon } = useTranslation('common')
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger size="sm" aria-label={t('source.label')} className="max-w-40 xl:max-w-64">
        <Database />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {sources.map((source) => (
          <SelectItem key={source.id} value={source.id}>
            {source.name}
            <span className="text-muted-foreground">{tCommon(`formats.${source.format}`)}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
