'use client'

import { TrendingUp } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'

import { getTrendingTags } from '@/lib/client'
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
    void getTrendingTags(TRENDING_NOW_LIMIT).then((nextTags) => {
      if (active) setTags(nextTags)
    })
    return () => {
      active = false
    }
  }, [])

  if (tags.length === 0) return null

  return (
    <div className="rounded-2xl border bg-card/80 p-3 shadow-sm backdrop-blur">
      <div className="flex items-center justify-between px-3 pb-1 pt-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <TrendingUp className="size-4 text-primary" />
          Trending now
        </div>
        <Link
          href="/explore"
          className="text-xs font-medium text-primary hover:underline"
        >
          See more
        </Link>
      </div>
      {tags.slice(0, TRENDING_NOW_LIMIT).map((tag) => (
        <TrendTagRow key={tag.name} tag={tag} compact />
      ))}
    </div>
  )
}
