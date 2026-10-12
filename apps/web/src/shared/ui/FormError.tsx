import { CircleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { Alert, AlertDescription } from './alert'

/** Why a form was refused, shown next to it and announced to screen readers. */
export function FormError({ children }: { children: ReactNode }) {
  return (
    <Alert variant="destructive">
      <CircleAlert />
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  )
}
