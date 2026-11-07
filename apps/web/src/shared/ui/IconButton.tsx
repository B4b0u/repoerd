import type { ComponentProps, ReactNode } from 'react'
import { Button } from './button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip'

type Props = Omit<ComponentProps<typeof Button>, 'aria-label' | 'size' | 'asChild'> & {
  /** Accessible name, also shown as tooltip. */
  label: string
  size?: 'icon' | 'icon-sm' | 'icon-xs'
  /** Tooltip text when it says more than the name (the reason a button is unavailable). */
  tooltip?: ReactNode
}

/** An icon-only button with a tooltip; it brings its own provider so it renders anywhere. */
export function IconButton({
  label,
  tooltip = label,
  size = 'icon-sm',
  variant = 'ghost',
  ...props
}: Props) {
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant={variant} size={size} aria-label={label} {...props} />
        </TooltipTrigger>
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
