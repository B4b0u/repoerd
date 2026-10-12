import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function Icon({ size = 14, children, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  )
}

export const TableIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
    <path d="M2 6.5h12M6.5 6.5v7" />
  </Icon>
)

export const KeyIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="5.5" cy="10.5" r="3" />
    <path d="M7.7 8.3 13.5 2.5M11.5 4.5l1.5 1.5M10 6l1.2 1.2" />
  </Icon>
)

export const LinkIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M6.8 9.2 9.2 6.8" />
    <path d="M7.5 4.5 8.8 3.2a2.6 2.6 0 0 1 3.7 3.7L11.2 8.2" />
    <path d="M8.5 11.5 7.2 12.8a2.6 2.6 0 0 1-3.7-3.7L4.8 7.8" />
  </Icon>
)

/** Filled for NOT NULL columns, hollow for nullable ones. */
export const DiamondIcon = ({ filled, ...props }: IconProps & { filled: boolean }) => (
  <Icon {...props}>
    <path d="M8 3.5 12.5 8 8 12.5 3.5 8Z" fill={filled ? 'currentColor' : 'none'} />
  </Icon>
)
