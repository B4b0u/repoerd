import { cloneElement, type ReactElement, type ReactNode, useId } from 'react'
import { Label } from './label'

type Control = ReactElement<{ id?: string; 'aria-describedby'?: string }>

/** A label above its control (wired by id), and an optional hint below. */
export function FormField({
  label,
  hint,
  children,
}: {
  label: ReactNode
  hint?: ReactNode
  children: Control
}) {
  const id = useId()
  const hintId = `${id}-hint`
  const describedBy = [children.props['aria-describedby'], hint ? hintId : undefined]
    .filter(Boolean)
    .join(' ')
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      {cloneElement(children, { id, 'aria-describedby': describedBy || undefined })}
      {hint && (
        <p id={hintId} className="text-sm text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  )
}
