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
    // Never fall back to `siteName`: that is the page's own claim about itself,
    // and this line exists precisely to be the part it cannot choose.
    return linkPreview.url
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
  // Only shown when it adds something the domain does not already say.
  const siteName =
    linkPreview.siteName && linkPreview.siteName !== domain
      ? linkPreview.siteName
      : null

  return (
    <a
      href={safeExternalHref(linkPreview.url)}
      target="_blank"
      rel="noopener noreferrer nofollow"
      // Defensive: no surface makes the post row itself clickable today, but
      // the card is a link inside a post body and every sibling block that
      // navigates (the quote card, the attachments) stops propagation for the
      // same reason.
      onClick={(event: MouseEvent) => event.stopPropagation()}
      className={cn(
        'mt-2 flex gap-3 overflow-hidden rounded-xl border border-border/60 bg-muted/20 p-3 transition-colors hover:bg-muted/40',
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
        {/* The DOMAIN must survive truncation, because it is the one part of
            this card the page cannot choose. Truncating the whole line clipped
            it and kept the author-supplied site name — so a long enough
            `og:site_name` pushed the real host off the end entirely. The name
            truncates; the domain does not. */}
        <div className="flex min-w-0 gap-1 text-xs text-muted-foreground">
          {siteName ? (
            // The separator rides WITH the name, so a name squeezed to nothing
            // on a narrow card cannot leave an orphan "·" opening the line.
            <span className="min-w-0 truncate">{siteName} ·</span>
          ) : null}
          {/* `shrink-0` keeps the domain out of the squeeze, but it still needs
              `truncate` for the case where the domain alone overflows: hard
              clipping would cut it flush, and the ellipsis is the only signal
              that the host a reader is checking is not the whole host. */}
          <span className="max-w-full shrink-0 truncate">{domain}</span>
        </div>
        <div className="line-clamp-2 wrap-anywhere text-sm font-semibold leading-snug">
          {linkPreview.title}
        </div>
        {linkPreview.description ? (
          <div className="line-clamp-2 wrap-anywhere text-[13px] leading-snug text-muted-foreground">
            {linkPreview.description}
          </div>
        ) : null}
      </div>
    </a>
  )
}
