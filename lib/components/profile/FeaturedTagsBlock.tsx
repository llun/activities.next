import { Hash } from 'lucide-react'
import Link from 'next/link'
import { FC } from 'react'

import type { FeaturedTag } from '@/lib/types/mastodon/featuredTag'
import { isRenderableHashtagName } from '@/lib/utils/text/isRenderableHashtagName'

interface Props {
  tags: FeaturedTag[]
}

const CHIP_CLASS =
  'inline-flex h-8 items-center gap-2 rounded-full border bg-background px-3 text-sm'

// Surface 2 — the compact "Featured hashtags" block shown inside a profile.
// A wrap of pill chips (#name + statuses_count) linking to each hashtag's
// timeline. Hidden entirely when the account features none, so it never
// dominates the profile header.
export const FeaturedTagsBlock: FC<Props> = ({ tags }) => {
  if (tags.length === 0) return null
  return (
    <div className="mt-5 space-y-2 border-t pt-5">
      <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <Hash className="size-[13px]" />
        <span>Featured hashtags</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {tags.map((tag) => {
          const label = (
            <>
              <span className="font-medium text-primary">#{tag.name}</span>
              <span className="text-xs tabular-nums text-muted-foreground">
                {tag.statuses_count}
              </span>
            </>
          )
          // The Mastodon entity `tag.url` is the account-scoped
          // `/@acct/tagged/<name>` URL, which this app does not serve. Link to
          // the in-app hashtag timeline (`/tags/<name>`) instead — the same path
          // every in-post hashtag uses — so the chip navigates client-side. A
          // tag whose name the /tags route can't render (e.g. an all-numeric or
          // Unicode name created via the raw Mastodon API) would 404, so render
          // it as a non-link chip rather than a broken link.
          return isRenderableHashtagName(tag.name) ? (
            <Link
              key={tag.id}
              href={`/tags/${encodeURIComponent(tag.name)}`}
              prefetch={false}
              className={`${CHIP_CLASS} transition-colors hover:bg-primary/[0.08] focus:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50`}
            >
              {label}
            </Link>
          ) : (
            <span key={tag.id} className={CHIP_CLASS}>
              {label}
            </span>
          )
        })}
      </div>
    </div>
  )
}
