'use client'

import { FC, useMemo } from 'react'

import { MastodonAccountCustomEmoji } from '@/lib/components/actors/ActorDisplayName'
import { ActorEmojiTag } from '@/lib/types/domain/actor'
import { Tag } from '@/lib/types/domain/tag'
import { cleanClassName } from '@/lib/utils/text/cleanClassName'
import { convertEmojisToImages } from '@/lib/utils/text/convertEmojisToImages'
import { toEmojiShortcodeToken } from '@/lib/utils/text/getEmojiTags'
import {
  sanitizeText,
  sanitizeTrustedStatusText
} from '@/lib/utils/text/sanitizeText'

interface Props {
  summary?: string | null
  tags?:
    | (
        | Pick<Tag, 'type' | 'name' | 'value'>
        | ActorEmojiTag
        | { type: string; name: string; value: string }
      )[]
    | null
  emojis?: MastodonAccountCustomEmoji[] | null
}

export const Bio: FC<Props> = ({ summary, tags, emojis }) => {
  const resolvedTags = useMemo(() => {
    const list: Pick<Tag, 'type' | 'name' | 'value'>[] = []
    for (const tag of tags ?? []) {
      if (tag.type === 'emoji') {
        list.push({ type: 'emoji', name: tag.name, value: tag.value })
      }
    }
    for (const emoji of emojis ?? []) {
      const token = toEmojiShortcodeToken(emoji.shortcode)
      if (token) {
        list.push({ type: 'emoji', name: token, value: emoji.url })
      }
    }
    return list
  }, [tags, emojis])

  const bio = useMemo(
    () =>
      cleanClassName(
        sanitizeTrustedStatusText(
          convertEmojisToImages(sanitizeText(summary || ''), resolvedTags)
        )
      ),
    [summary, resolvedTags]
  )
  return (
    <div className="mt-4 text-sm leading-relaxed break-words [&_a]:text-sky-600 dark:[&_a]:text-sky-400 [&_a]:underline [&_a]:underline-offset-2 [&_a:hover]:text-sky-700 dark:[&_a:hover]:text-sky-300 [&_p]:mb-4 last:[&_p]:mb-0">
      {bio}
    </div>
  )
}
