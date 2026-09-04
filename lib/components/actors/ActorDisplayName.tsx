import { FC, ReactNode } from 'react'

import { ActorEmojiTag } from '@/lib/types/domain/actor'
import { Tag } from '@/lib/types/domain/tag'
import { cn } from '@/lib/utils'
import { toEmojiShortcodeToken } from '@/lib/utils/text/getEmojiTags'

const SHORTCODE_CAPTURE_REGEX = /(:[^\s:]{1,64}:)/g

export interface MastodonAccountCustomEmoji {
  shortcode: string
  url: string
  static_url?: string
}

export interface CustomEmojiTextProps {
  text?: string | null
  name?: string | null
  tags?:
    | (
        | Pick<Tag, 'type' | 'name' | 'value'>
        | ActorEmojiTag
        | { type: string; name: string; value: string }
      )[]
    | null
  emojis?: MastodonAccountCustomEmoji[] | null
  className?: string
  emojiClassName?: string
}

export type ActorDisplayNameProps = CustomEmojiTextProps

export const CustomEmojiText: FC<CustomEmojiTextProps> = ({
  text,
  name,
  tags,
  emojis,
  className,
  emojiClassName
}) => {
  const contentText = text ?? name
  if (!contentText) return null

  const urlByShortcode = new Map<string, string>()

  for (const tag of tags ?? []) {
    if (tag.type !== 'emoji') continue
    const token = toEmojiShortcodeToken(tag.name)
    if (!token) continue
    if (!urlByShortcode.has(token)) {
      urlByShortcode.set(token, tag.value)
    }
  }

  for (const emoji of emojis ?? []) {
    const token = toEmojiShortcodeToken(emoji.shortcode)
    if (!token) continue
    if (!urlByShortcode.has(token)) {
      urlByShortcode.set(token, emoji.url)
    }
  }

  if (urlByShortcode.size === 0) {
    return className ? (
      <span className={className}>{contentText}</span>
    ) : (
      <>{contentText}</>
    )
  }

  const parts = contentText.split(SHORTCODE_CAPTURE_REGEX)
  let hasEmoji = false

  const content: ReactNode[] = parts.map((part, index) => {
    const url = urlByShortcode.get(part)
    if (url) {
      hasEmoji = true
      return (
        <img
          key={index}
          src={url}
          alt={part}
          title={part}
          className={cn(
            'inline h-[1.2em] w-[1.2em] align-[-0.2em] object-contain',
            emojiClassName
          )}
        />
      )
    }
    return part
  })

  if (!hasEmoji) {
    return className ? (
      <span className={className}>{contentText}</span>
    ) : (
      <>{contentText}</>
    )
  }

  return className ? (
    <span className={className}>{content}</span>
  ) : (
    <>{content}</>
  )
}

export const ActorDisplayName = CustomEmojiText
