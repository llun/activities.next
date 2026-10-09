import { FC } from 'react'

import { Frame } from '@/lib/components/surface/Frame'
import { Avatar, AvatarFallback, AvatarImage } from '@/lib/components/ui/avatar'

interface Props {
  name?: string | null
  email: string
  iconUrl?: string | null
}

// At-a-glance identity summary for the account: the avatar, display name, and
// email shared by every actor. Read-only — editing lives in the forms below.
// Mirrors the OIDC consent identity block so the account's avatar/name read the
// same wherever they surface.
export const AccountIdentityCard: FC<Props> = ({ name, email, iconUrl }) => {
  const displayName = name?.trim() || email
  // Spread to the first code point so a surrogate-pair glyph (emoji / non-BMP
  // name) isn't sliced into a broken half.
  const initial = [...displayName][0]?.toUpperCase() || '?'

  return (
    <Frame className="flex items-center gap-4 px-4 py-4">
      <Avatar className="h-16 w-16" aria-hidden="true">
        {iconUrl && <AvatarImage src={iconUrl} alt="" />}
        <AvatarFallback className="bg-(--skeleton) text-xl font-semibold text-muted-foreground dark:bg-input">
          {initial}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <p className="truncate text-base font-semibold">{displayName}</p>
        {/* Show the email beneath only when a distinct name is the heading, so
            it never renders twice (case-insensitive — emails are). */}
        {displayName.toLowerCase() !== email.toLowerCase() && (
          <p className="truncate text-sm text-muted-foreground">{email}</p>
        )}
      </div>
    </Frame>
  )
}
