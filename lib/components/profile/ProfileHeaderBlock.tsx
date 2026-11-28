import { FC, ReactNode } from 'react'

import type { CustomEmojiTextProps } from '@/lib/components/actors/ActorDisplayName'
import { Bio } from '@/lib/components/bio/Bio'
import {
  type ProfileFieldItem,
  ProfileFieldsBlock
} from '@/lib/components/profile/ProfileFieldsBlock'
import { Avatar, AvatarFallback, AvatarImage } from '@/lib/components/ui/avatar'

interface Props {
  /** The cover box, so the page and the editor share its size and phone behaviour. */
  cover: ReactNode
  avatarUrl?: string | null
  avatarAlt?: string
  /** The monogram shown while there is no avatar. */
  initials: string
  name: ReactNode
  /** `p` where the page already has its own `h1` (the editor's preview). */
  nameAs?: 'h1' | 'p'
  handle: ReactNode
  actions?: ReactNode
  summary?: string | null
  fields: ProfileFieldItem[]
  tags?: CustomEmojiTextProps['tags']
  /** Page-only extras under the links (the software line, featured hashtags). */
  children?: ReactNode
}

/** The monogram for an avatar without an image; `:emoji:` shortcodes are not letters. */
export const getInitials = (name: string, fallback: string) => {
  const cleanName = name.replaceAll(/:[^\s:]{1,64}:/g, '').trim()
  return (cleanName || fallback)
    .trim()
    .split(/\s+/)
    .map((part) => Array.from(part)[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

/**
 * The profile header the profile page and the Edit profile preview both draw:
 * the cover, the avatar overlapping it, the name and handle with the actions
 * beside them, the bio and the links. Directive-less so the server page and the
 * client editor render the same markup; the page-only extras (moved and Bluesky
 * badges, the software line, featured hashtags) come in through `name`,
 * `handle` and `children`, and `actions` carries the Edit/Follow controls.
 */
export const ProfileHeaderBlock: FC<Props> = ({
  cover,
  avatarUrl,
  avatarAlt = '',
  initials,
  name,
  nameAs = 'h1',
  handle,
  actions,
  summary,
  fields,
  tags,
  children
}) => {
  const Name = nameAs
  return (
    <>
      {cover}
      <div className="relative px-4">
        <Avatar className="relative -mt-14 size-20 border-4 border-background">
          <AvatarImage src={avatarUrl || undefined} alt={avatarAlt} />
          {/* The 4px border takes the avatar's content box down to 72px, so
              the shared 42cqw initial would come out 30px; the Avatar board
              draws the 80px monogram at 34. */}
          <AvatarFallback className="text-[34px]">{initials}</AvatarFallback>
        </Avatar>

        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div className="min-w-0">
            <Name className="text-xl font-semibold tracking-tight break-words">
              {name}
            </Name>
            <p className="text-sm text-muted-foreground">{handle}</p>
          </div>
          {actions}
        </div>

        <Bio summary={summary} tags={tags} />

        {/* Each value is HTML (a local actor's is formatted from its raw
            text), so both kinds go through the same sanitizer in the block.
            `verifiedAt` comes from the stored actor row. */}
        <ProfileFieldsBlock fields={fields} tags={tags} />

        {children}
      </div>
    </>
  )
}
