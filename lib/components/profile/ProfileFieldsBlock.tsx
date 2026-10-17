'use client'

import {
  Activity,
  Check,
  Globe,
  Image as ImageIcon,
  type LucideIcon,
  Mail,
  MapPin,
  Tag
} from 'lucide-react'
import { FC, useState } from 'react'

import {
  ActorDisplayName,
  type CustomEmojiTextProps
} from '@/lib/components/actors/ActorDisplayName'
import {
  type ProfileFieldIconKind,
  chooseProfileFieldIcon
} from '@/lib/components/profile/profileFieldIcon'
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

const ICONS: Record<ProfileFieldIconKind, LucideIcon> = {
  location: MapPin,
  image: ImageIcon,
  activity: Activity,
  mail: Mail,
  link: Globe,
  text: Tag
}

// Items shown before "+N more": the first 2 below `sm`, the first 3 from `sm`.
const PHONE_VISIBLE = 2
const DESKTOP_VISIBLE = 3

const plainText = (html: string) =>
  html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .trim()

// The class that hides item `index` while the list is collapsed.
const collapsedClass = (index: number) => {
  if (index >= DESKTOP_VISIBLE) return 'hidden'
  if (index >= PHONE_VISIBLE) return 'hidden sm:inline-flex'
  return undefined
}

const MORE_CLASS =
  'cursor-pointer text-sm text-muted-foreground hover:text-foreground hover:underline underline-offset-2'

// The profile's metadata fields ("links") on one wrapping line under the bio:
// a muted icon and the value per field, folded behind "+N more" past the first
// 2 (phone) or 3 (`sm` and up). The fold is CSS only, so the server render is
// right without measuring. A link field hides its label from sight (it stays
// for screen readers and the title); a text field the icons cannot name keeps
// its label visible. Hidden when there are none. The value goes through the
// same sanitizer and emoji pipeline as the bio, so a remote actor's links work
// and its custom emoji show.
export const ProfileFieldsBlock: FC<Props> = ({ fields, tags }) => {
  const [expanded, setExpanded] = useState(false)
  const rows = fields.filter((field) => field.name.trim() || field.value.trim())
  if (rows.length === 0) return null

  const emojiTags = (tags ?? []).flatMap((tag) =>
    tag.type === 'emoji' && toEmojiShortcodeToken(tag.name)
      ? [{ type: 'emoji' as const, name: tag.name, value: tag.value }]
      : []
  )

  const hiddenOnPhone = Math.max(0, rows.length - PHONE_VISIBLE)
  const hiddenOnDesktop = Math.max(0, rows.length - DESKTOP_VISIBLE)

  const toggle = (count: number, className: string) => (
    <button
      type="button"
      aria-expanded={expanded}
      onClick={() => setExpanded((value) => !value)}
      className={cn(MORE_CLASS, className)}
    >
      {expanded ? 'Show less' : `+${count} more`}
    </button>
  )

  return (
    <ul
      data-slot="profile-fields"
      className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm"
    >
      {rows.map((field, index) => {
        const verifiedDate = field.verifiedAt
          ? formatVerifiedDate(field.verifiedAt)
          : null
        const verified = Boolean(field.verifiedAt)
        const choice = chooseProfileFieldIcon(field.name, field.value)
        const Icon = ICONS[choice.kind]
        const showLabel = choice.kind === 'text'
        const hasLink = /<a\s/i.test(field.value)
        const label = field.name.trim()
        const text = plainText(field.value)
        return (
          <li
            key={`${index}-${field.name}`}
            title={
              verified
                ? `Ownership of this link was checked${verifiedDate ? ` on ${verifiedDate}` : ''}`
                : `${label ? `${label}: ` : ''}${text}`
            }
            className={cn(
              'inline-flex max-w-full shrink-0 items-center gap-1.5',
              !expanded && collapsedClass(index)
            )}
          >
            <Icon
              aria-hidden="true"
              className="size-3.5 shrink-0 text-muted-foreground"
            />
            {verified ? (
              <Check
                role="img"
                aria-label="Verified"
                className="size-3.5 shrink-0 text-success-text"
              />
            ) : null}
            <span
              className={cn(
                'min-w-0 truncate',
                showLabel ? 'text-muted-foreground' : 'sr-only'
              )}
            >
              <ActorDisplayName text={field.name} tags={emojiTags} />
              {showLabel ? '' : ': '}
            </span>
            <span
              className={cn(
                // `pr-px` keeps sub-pixel text widths from tripping the ellipsis.
                'min-w-0 truncate pr-px',
                verified
                  ? VERIFIED_LINK_CLASS
                  : hasLink
                    ? LINK_CLASS
                    : showLabel
                      ? 'text-foreground'
                      : 'text-muted-foreground'
              )}
            >
              {cleanClassName(
                sanitizeTrustedStatusText(
                  convertEmojisToImages(sanitizeText(field.value), emojiTags)
                ),
                // Keep the link the person entered (target and rel="me").
                { rewriteProfileLinks: false }
              )}
            </span>
          </li>
        )
      })}
      {hiddenOnPhone > 0 ? (
        <li className={cn(hiddenOnDesktop === 0 && 'sm:hidden')}>
          {hiddenOnDesktop > 0 ? (
            <>
              {toggle(hiddenOnPhone, 'sm:hidden')}
              {toggle(hiddenOnDesktop, 'max-sm:hidden')}
            </>
          ) : (
            toggle(hiddenOnPhone, '')
          )}
        </li>
      ) : null}
    </ul>
  )
}
