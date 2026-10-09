'use client'

import { TrendingUp } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'

import { getTrendingTags } from '@/lib/client'
import { FramedList, FramedListItem } from '@/lib/components/surface/FramedList'
import { Section } from '@/lib/components/surface/Section'
import { TrendTagRow } from '@/lib/components/trends/trend-tag-row'
import type { Tag } from '@/lib/types/mastodon/tag'

const TRENDING_NOW_LIMIT = 4

// The "Trending now" block surfaced on the empty Search page: the top few
// trending hashtags with a "See more" link to Explore. Self-hides while loading
// and whenever the server has no qualifying trends (or trends are disabled), so
// it never shows an empty shell.
export const TrendingNowBlock = () => {
  const [tags, setTags] = useState<Tag[]>([])

  useEffect(() => {
    let active = true
    getTrendingTags(TRENDING_NOW_LIMIT)
      .then((nextTags) => {
        if (active) setTags(nextTags)
      })
      // A failed/disabled trends endpoint should just hide the block, never
      // surface an error on the Search page.
      .catch(() => {
        if (active) setTags([])
      })
    return () => {
      active = false
    }
  }, [])

  if (tags.length === 0) return null

  return (
    <Section
      title="Trending now"
      icon={TrendingUp}
      actions={
        <Link
          href="/explore"
          className="text-sm font-medium text-primary-text hover:underline"
        >
          See more
        </Link>
      }
    >
      <FramedList>
        {tags.slice(0, TRENDING_NOW_LIMIT).map((tag) => (
          <FramedListItem key={tag.name} className="p-0">
            <TrendTagRow tag={tag} compact />
          </FramedListItem>
        ))}
      </FramedList>
    </Section>
  )
}
