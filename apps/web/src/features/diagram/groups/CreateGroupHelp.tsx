import { FolderPlus } from 'lucide-react'
import { useId } from 'react'
import { Button } from '../../../shared/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '../../../shared/ui/popover'
import { useGroupsTranslation } from './groups-i18n'

/**
 * The toolbar's way into groups while a source has none: a group is made from its tables, so the
 * button shows how to select them and name the group rather than create an empty one.
 */
export function CreateGroupHelp() {
  const { t } = useGroupsTranslation()
  const titleId = useId()
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8">
          <FolderPlus />
          {t('createGroup.open')}
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" aria-labelledby={titleId} className="w-80 text-sm">
        <p id={titleId} className="mb-2 font-medium">
          {t('createGroup.open')}
        </p>
        <ol className="list-decimal space-y-1 pl-5">
          <li>{t('createGroup.select')}</li>
          <li>{t('createGroup.name')}</li>
        </ol>
        <p className="mt-2 text-muted-foreground">{t('createGroup.keyboard')}</p>
      </PopoverContent>
    </Popover>
  )
}
