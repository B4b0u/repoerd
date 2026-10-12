import type { ReactNode } from 'react'
import { CardDescription, CardHeader, CardTitle } from './card'

/** A card header whose title is a real heading (shadcn's CardTitle is a div). */
export function CardHeading({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <CardHeader>
      <CardTitle>
        <h2>{title}</h2>
      </CardTitle>
      {children && <CardDescription>{children}</CardDescription>}
    </CardHeader>
  )
}
