'use client'

import { Check } from 'lucide-react'
import { FC } from 'react'

import {
  ActorDisplayName,
  type CustomEmojiTextProps
} from '@/lib/components/actors/ActorDisplayName'
import { Frame } from '@/lib/components/surface/Frame'
import { cn } from '@/lib/utils'
import { cleanClassName } from '@/lib/utils/text/cleanClassName'
import { convertEmojisToImages } from '@/lib/utils/text/convertEmojisToImages'
import { toEmojiShortcodeToken } from '@/lib/utils/text/getEmojiTags'
import {
  sanitizeText,
  sanitizeTrustedStatusText
} from '@/lib/utils/text/sanitizeText'

export interface ProfileFieldItem {
  name: string
  /** HTML, as the actor document carries it. Sanitized before it is shown. */
  value: string
  /** When ownership of the link was checked (ISO 8601); unset when it was not. */
  verifiedAt?: string | null
}

interface Props {
  fields: ProfileFieldItem[]
  tags?: CustomEmojiTextProps['tags']
}

const formatVerifiedDate = (verifiedAt: string) => {
  const time = Date.parse(verifiedAt)
  if (Number.isNaN(time)) return null
  // A fixed locale and zone, so the server and the browser print the same text.
  return new Date(time).toLocaleDateString('en-US', {
    dateStyle: 'medium',
    timeZone: 'UTC'
  })
}

const LINK_CLASS =
  '[&_a]:text-(color:--link-color) [&_a]:underline [&_a]:underline-offset-2 [&_a:hover]:text-(color:--link-color-hover)'
const VERIFIED_LINK_CLASS =
  '[&_a]:font-medium [&_a]:text-success-text [&_a]:underline [&_a]:underline-offset-2'

// The profile's metadata fields ("links") under the bio: a framed list with
// the label in a muted left column and the value in the right two thirds from
// `sm`, stacked on a phone. Hidden when there are none. The value goes through
// the same sanitizer and emoji pipeline as the bio, so a remote actor's links
// work and its custom emoji show.
export const ProfileFieldsBlock: FC<Props> = ({ fields, tags }) => {
  const rows = fields.filter((field) => field.name.trim() || field.value.trim())
  if (rows.length === 0) return null

  const emojiTags = (tags ?? []).flatMap((tag) =>
    tag.type === 'emoji' && toEmojiShortcodeToken(tag.name)
      ? [{ type: 'emoji' as const, name: tag.name, value: tag.value }]
      : []
  )

  return (
    <Frame className="mt-4 overflow-hidden">
      <dl data-slot="profile-fields" className="divide-y">
        {rows.map((field, index) => {
          const verifiedDate = field.verifiedAt
            ? formatVerifiedDate(field.verifiedAt)
            : null
          const verified = Boolean(field.verifiedAt)
          return (
            <div
              key={`${index}-${field.name}`}
              className={cn(
                'grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]',
                verified && 'bg-success/10'
              )}
            >
              <dt
                className={cn(
                  'px-4 pt-2.5 text-xs font-medium tracking-wide break-words text-muted-foreground uppercase sm:py-2.5 sm:leading-5',
                  !verified && 'sm:bg-muted/40'
                )}
              >
                <ActorDisplayName text={field.name} tags={emojiTags} />
              </dt>
              <dd
                title={
                  verified
                    ? `Ownership of this link was checked${verifiedDate ? ` on ${verifiedDate}` : ''}`
                    : undefined
                }
                className={cn(
                  'flex min-w-0 items-start gap-1.5 px-4 pt-1 pb-2.5 text-sm [overflow-wrap:anywhere] sm:py-2.5',
                  verified ? VERIFIED_LINK_CLASS : LINK_CLASS
                )}
              >
                {verified ? (
                  <Check
                    role="img"
                    aria-label="Verified"
                    className="mt-0.5 size-3.5 shrink-0 text-success-text"
                  />
                ) : null}
                <div className="min-w-0">
                  {cleanClassName(
                    sanitizeTrustedStatusText(
                      convertEmojisToImages(
                        sanitizeText(field.value),
                        emojiTags
                      )
                    ),
                    // Keep the link the person entered (target and rel="me").
                    { rewriteProfileLinks: false }
                  )}
                </div>
              </dd>
            </div>
          )
        })}
      </dl>
    </Frame>
  )
}
