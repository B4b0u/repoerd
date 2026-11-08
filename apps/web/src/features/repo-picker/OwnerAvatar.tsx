import { GROUP_PALETTE } from '@repoerd/model'
import { cn } from '../../shared/lib/utils'
import { Avatar, AvatarFallback, AvatarImage } from '../../shared/ui/avatar'
import { contrastRatio } from '../diagram/groups/group-colors'

/** One of the 12 group colours, always the same for the same owner. */
export function ownerColor(owner: string): string {
  let hash = 0
  for (const char of owner.toLowerCase()) {
    hash = (Math.imul(hash, 31) + (char.codePointAt(0) ?? 0)) >>> 0
  }
  return GROUP_PALETTE[hash % GROUP_PALETTE.length] ?? '#8d6e63'
}

/** The GitHub avatar of an owner, or its initial on its colour (demo mode, image unavailable). */
export function OwnerAvatar({
  owner,
  avatarUrl,
  className,
}: {
  owner: string
  avatarUrl: string | null
  className?: string
}) {
  const color = ownerColor(owner)
  const text = contrastRatio(color, '#000000') >= contrastRatio(color, '#ffffff') ? '#000' : '#fff'
  return (
    // Decorative: the owner's name is always written next to it.
    <Avatar aria-hidden className={cn('size-5 rounded-md', className)}>
      {avatarUrl && <AvatarImage src={avatarUrl} alt="" />}
      <AvatarFallback
        className="rounded-md text-[0.625rem] font-semibold"
        style={{ backgroundColor: color, color: text }}
      >
        {owner.slice(0, 1).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  )
}
