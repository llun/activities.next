import { FC } from 'react'

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
    <section className="flex items-center gap-4 rounded-2xl border bg-background/80 p-6 shadow-sm">
      <Avatar className="h-16 w-16" aria-hidden="true">
        {iconUrl && <AvatarImage src={iconUrl} alt="" />}
        <AvatarFallback className="bg-gray-200 text-xl text-gray-600 dark:bg-gray-700 dark:text-gray-300">
          {initial}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <h2 className="truncate text-xl font-semibold">{displayName}</h2>
        {/* Show the email beneath only when a distinct name is the heading, so
            it never renders twice (case-insensitive — emails are). */}
        {displayName.toLowerCase() !== email.toLowerCase() && (
          <p className="truncate text-sm text-muted-foreground">{email}</p>
        )}
      </div>
    </section>
  )
}
