import { COMPARE_MODES, type CompareMode, isCompareMode } from '@repoerd/model'
import { GitCompare } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../shared/ui/button'
import { Label } from '../../shared/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '../../shared/ui/popover'
import { RadioGroup, RadioGroupItem } from '../../shared/ui/radio-group'
import { BranchPicker } from '../diagram/BranchPicker'

interface Props {
  /** Undefined while the branches load. */
  branches: string[] | undefined
  /** The displayed branch: the "after" side, never offered as reference. */
  head: string
  defaultBranch: string | undefined
  /** The current reference branch, when comparing. */
  base: string | undefined
  mode: CompareMode
  onApply: (base: string, mode: CompareMode) => void
  /** GitHub has more branches than RepoERD read. */
  truncated?: boolean
  /** The branch list failed: the reference picker says why and offers a retry. */
  branchesError?: string
  onRetryBranches?: () => void
  retryingBranches?: boolean
}

/** The "Compare" button and its form: reference branch and mode. */
export function CompareControl({
  branches,
  head,
  defaultBranch,
  base,
  mode,
  onApply,
  truncated,
  branchesError,
  onRetryBranches,
  retryingBranches,
}: Props) {
  const { t } = useTranslation('compare')
  const [open, setOpen] = useState(false)
  const [chosenBase, setChosenBase] = useState<string | undefined>()
  const [chosenMode, setChosenMode] = useState<CompareMode>(mode)
  const candidates = branches?.filter((branch) => branch !== head)
  const initialBase =
    base ??
    (defaultBranch !== undefined && defaultBranch !== head ? defaultBranch : candidates?.[0])
  const selected = chosenBase ?? initialBase

  const onOpenChange = (next: boolean) => {
    setOpen(next)
    if (next) {
      setChosenBase(undefined)
      setChosenMode(mode)
    }
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant={base ? 'secondary' : 'outline'}
          size="sm"
          title={t('buttonTitle')}
          disabled={!branches && branchesError === undefined}
        >
          <GitCompare />
          <span className="sr-only xl:not-sr-only">{t('button')}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (!selected) return
            setOpen(false)
            onApply(selected, chosenMode)
          }}
        >
          <p className="text-sm font-semibold">{t('control.title')}</p>
          <div className="flex flex-col gap-1.5">
            <span className="text-sm text-muted-foreground">{t('control.base')}</span>
            <BranchPicker
              branches={candidates}
              value={selected ?? ''}
              onChange={setChosenBase}
              ariaLabel={t('control.base')}
              placeholder={t('control.pickBase')}
              defaultBranch={defaultBranch}
              truncated={truncated}
              error={branchesError}
              onRetry={onRetryBranches}
              retrying={retryingBranches}
            />
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1.5 text-sm text-muted-foreground">{t('control.mode')}</legend>
            <RadioGroup
              value={chosenMode}
              onValueChange={(value) => {
                if (isCompareMode(value)) setChosenMode(value)
              }}
            >
              {COMPARE_MODES.map((option) => (
                <div key={option} className="flex items-start gap-2">
                  <RadioGroupItem id={`compare-mode-${option}`} value={option} className="mt-0.5" />
                  <Label
                    htmlFor={`compare-mode-${option}`}
                    className="flex flex-col items-start gap-0.5 font-normal"
                  >
                    <span className="font-medium">{t(`control.modes.${option}`)}</span>
                    <span className="text-xs text-muted-foreground">
                      {t(`control.modeHelp.${option}`)}
                    </span>
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </fieldset>
          <Button type="submit" size="sm" disabled={!selected}>
            {t('control.apply')}
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  )
}
