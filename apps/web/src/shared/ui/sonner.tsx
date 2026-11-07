import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from 'lucide-react'
import { Toaster as Sonner, type ToasterProps } from 'sonner'
import { useThemeContext } from '@/shared/theme/theme-context'

/**
 * Clear of the header (60 px from the top) and of the edges; on the left, past the diagram's table
 * list (w-65): the notices in a left corner are about the canvas and must not hide the list.
 */
const OFFSET = { top: 60, right: 60, bottom: 60, left: 'calc(16.25rem + 16px)' }

const Toaster = ({ offset = OFFSET, ...props }: ToasterProps) => {
  const { theme } = useThemeContext()

  return (
    <Sonner
      theme={theme}
      offset={offset}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
          '--border-radius': 'var(--radius)',
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
