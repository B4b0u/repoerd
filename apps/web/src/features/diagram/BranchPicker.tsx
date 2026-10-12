import { Check, ChevronsUpDown, GitBranch, RefreshCw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../shared/lib/utils'
import { Button } from '../../shared/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '../../shared/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '../../shared/ui/popover'
import { branchChoices } from './model/branch-choices'

interface Props {
  /** Undefined while the branches load (or when they failed: see `error`). */
  branches: string[] | undefined
  value: string
  onChange: (branch: string) => void
  /** Accessible name; default: "Branch: <value>". */
  ariaLabel?: string
  /** Shown when no branch is chosen; default: the loading label. */
  placeholder?: string
  /** Listed first. */
  defaultBranch?: string
  /** GitHub has more branches than RepoERD read. */
  truncated?: boolean
  /** Why the branches could not be loaded: shown in place of the list, with `onRetry`. */
  error?: string
  onRetry?: () => void
  /** A retry is running: the button waits. */
  retrying?: boolean
}

/** Branch combobox: type to filter, arrows and Enter to pick; at most 100 matches listed. */
export function BranchPicker({
  branches,
  value,
  onChange,
  ariaLabel,
  placeholder,
  defaultBranch,
  truncated = false,
  error,
  onRetry,
  retrying = false,
}: Props) {
  const { t } = useTranslation('diagram')
  const { t: tCommon } = useTranslation('common')
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const shown = value || placeholder || t('branch.loading')
  const choices = useMemo(
    () => branchChoices(branches ?? [], { query, current: value, defaultBranch }),
    [branches, query, value, defaultBranch],
  )
  const onOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) setQuery('')
  }
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel ?? t('branch.current', { branch: shown })}
          disabled={!branches && error === undefined}
          className="max-w-40 justify-between xl:max-w-64 font-normal"
        >
          <GitBranch />
          <span className="truncate">{shown}</span>
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        {error !== undefined ? (
          <div role="alert" className="flex flex-col items-start gap-2 p-3 text-sm">
            <p className="text-destructive">{error}</p>
            {onRetry && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={retrying}
                aria-busy={retrying}
                onClick={onRetry}
              >
                <RefreshCw className={retrying ? 'animate-spin' : undefined} />
                {tCommon('retry')}
              </Button>
            )}
          </div>
        ) : (
          <Command shouldFilter={false}>
            <CommandInput placeholder={t('branch.search')} value={query} onValueChange={setQuery} />
            <CommandList>
              <CommandEmpty>{t('branch.none')}</CommandEmpty>
              <CommandGroup>
                {choices.shown.map((branch) => (
                  <CommandItem
                    key={branch}
                    value={branch}
                    onSelect={() => {
                      onOpenChange(false)
                      if (branch !== value) onChange(branch)
                    }}
                  >
                    <Check className={cn(branch === value ? 'opacity-100' : 'opacity-0')} />
                    <span className="truncate">{branch}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
            {(choices.more > 0 || truncated) && (
              <div className="flex flex-col gap-1 border-t px-3 py-2 text-xs text-muted-foreground">
                {choices.more > 0 && <p>{t('branch.refine', { count: choices.more })}</p>}
                {truncated && <p>{t('branch.truncated')}</p>}
              </div>
            )}
          </Command>
        )}
      </PopoverContent>
    </Popover>
  )
}
