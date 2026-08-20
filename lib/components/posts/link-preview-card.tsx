'use client'

import { FC, MouseEvent, useEffect, useState } from 'react'

import { safeExternalHref } from '@/lib/components/trends/safeHref'
import { StatusLinkPreview } from '@/lib/types/domain/status'
import { cn } from '@/lib/utils'

interface LinkPreviewCardProps {
  linkPreview: StatusLinkPreview
  className?: string
}

// The bare hostname is what tells a reader where a link actually goes, so it is
// always derived from the URL rather than taken from the page's own
// `og:site_name` — which the page author controls and can set to anything.
const getDomain = (linkPreview: StatusLinkPreview) => {
  try {
    return new URL(linkPreview.url).hostname.replace(/^www\./, '')
  } catch {
    return linkPreview.siteName ?? linkPreview.url
  }
}

/**
 * The preview card for the link in a status — the same anatomy as the trending
 * link card: thumbnail, "publisher · domain", a clamped title and description.
 *
 * Everything here is remote, author-controlled text: it renders as React text
 * nodes (never `dangerouslySetInnerHTML`), the href goes through
 * `safeExternalHref`, and the thumbnail is loaded without a referrer so reading
 * a timeline does not announce the reader to whatever host the author chose.
 */
export const LinkPreviewCard: FC<LinkPreviewCardProps> = ({
  linkPreview,
  className
}) => {
  // A thumbnail is hotlinked from whatever host the page author chose, so it
  // can fail for reasons this server cannot see or fix — hotlink protection, a
  // dead CDN, an expired signed URL. Keeping a broken image holds an 88px hole
  // open in the card, so a failure degrades to the text-only card instead.
  const [imageFailed, setImageFailed] = useState(false)
  // A status can be replaced in place (an edit, or a feed row being reused for
  // a different post), and the previous card's failure must not suppress the
  // new one's thumbnail.
  useEffect(() => setImageFailed(false), [linkPreview.imageUrl])

  const domain = getDomain(linkPreview)
  const publisher =
    linkPreview.siteName && linkPreview.siteName !== domain
      ? `${linkPreview.siteName} · ${domain}`
      : domain

  return (
    <a
      href={safeExternalHref(linkPreview.url)}
      target="_blank"
      rel="noopener noreferrer nofollow"
      // The card sits inside a post that is itself clickable on some surfaces;
      // without this the browser opens the link and the row navigates to the
      // status behind it.
      onClick={(event: MouseEvent) => event.stopPropagation()}
      className={cn(
        'mt-3 flex gap-3 overflow-hidden rounded-xl border bg-card p-3 shadow-sm transition-colors hover:bg-muted',
        className
      )}
    >
      {linkPreview.imageUrl && !imageFailed ? (
        // A plain <img>, not next/image: the host is whatever the page author
        // chose, so it can never be in `images.remotePatterns`, and routing it
        // through the optimizer would put this server in front of every
        // thumbnail it renders.
        <img
          src={linkPreview.imageUrl}
          alt=""
          role="presentation"
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setImageFailed(true)}
          className="size-[88px] shrink-0 rounded-lg object-cover"
        />
      ) : null}
      <div className="min-w-0 space-y-0.5">
        <div className="truncate text-xs text-muted-foreground">
          {publisher}
        </div>
        <div className="line-clamp-2 text-sm font-semibold leading-snug">
          {linkPreview.title}
        </div>
        {linkPreview.description ? (
          <div className="line-clamp-2 text-[13px] leading-snug text-muted-foreground">
            {linkPreview.description}
          </div>
        ) : null}
      </div>
    </a>
  )
}
