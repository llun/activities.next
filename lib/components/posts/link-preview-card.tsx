'use client'

import { Play } from 'lucide-react'
import { FC, MouseEvent, useEffect, useRef, useState } from 'react'

import { safeExternalHref } from '@/lib/components/trends/safeHref'
import { StatusLinkPreview } from '@/lib/types/domain/status'
import { cn } from '@/lib/utils'
import {
  YouTubeVideo,
  getYouTubeEmbedUrl,
  getYouTubePosterUrl,
  getYouTubeVideoFromUrl
} from '@/lib/utils/youtube'

interface LinkPreviewCardProps {
  linkPreview: StatusLinkPreview
  className?: string
}

/**
 * Whether an `<img>` has already finished loading and has no pixels — i.e. it
 * failed.
 *
 * These cards are server-rendered, so the browser begins fetching the thumbnail
 * while it parses the HTML — often finishing before React hydrates. `error` does
 * not bubble, so React attaches that listener to the element itself during
 * hydration and a failure that landed first is never delivered: `onError` simply
 * never fires and the card holds a broken image open forever. Asking the element
 * what already happened, at the moment the ref attaches, is what recovers it.
 * (`complete` alone is not enough — it is also true for an image that loaded.)
 *
 * Known false positive, accepted: an SVG carrying only a `viewBox` loads and
 * paints fine yet reports `naturalWidth === 0`, so it is read as a failure and
 * the card degrades. There is no cleaner DOM question to ask, the input is rare
 * for an `og:image`, and the degradation is graceful — a text-only card, or the
 * next poster candidate.
 */
const hasImageAlreadyFailed = (image: HTMLImageElement) =>
  image.complete && image.naturalWidth === 0

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

interface YouTubeLinkPreviewCardProps extends LinkPreviewCardProps {
  video: YouTubeVideo
}

/**
 * The card for a link to a YouTube video: a click-to-play facade over the
 * embedded player, with the title and domain below it linking out to YouTube.
 *
 * Nothing is loaded from YouTube's player until the reader presses play. A live
 * iframe per row would fetch a megabyte of player code and announce the reader
 * to Google for every video that merely scrolled past, so the facade is what
 * keeps a timeline cheap and quiet; pressing play is the consent that makes the
 * request reasonable.
 */
const YouTubeLinkPreviewCard: FC<YouTubeLinkPreviewCardProps> = ({
  linkPreview,
  video,
  className
}) => {
  // Defence in depth, NOT the mechanism: what actually clears a reader's
  // consent when the linked video changes is the `key` this component is
  // mounted under (see the dispatcher), which remounts it with this back at
  // `null`. Comparing against a remembered id was the original mechanism and
  // was not enough — it defended A→B but not A→B→A, because the id was only
  // ever compared against, never cleared. Since the key means this component
  // now sees exactly one videoId for its whole life, the comparison is
  // equivalent to a boolean; it is kept so that removing the key degrades to
  // the old one-directional guard rather than to none at all.
  const [playingVideoId, setPlayingVideoId] = useState<string | null>(null)
  // Posters are remembered by URL for the same reason — a new candidate is not
  // in the list, so the next video starts with a clean slate and no effect has
  // to run to arrange it.
  const [failedPosterUrls, setFailedPosterUrls] = useState<readonly string[]>(
    []
  )

  const isPlaying = playingVideoId === video.videoId
  const derivedPosterUrl = getYouTubePosterUrl(video)
  // The page's own image first — usually the same frame the derived thumbnail
  // shows, at whatever size YouTube gave the card — then YouTube's `hqdefault`,
  // which exists for every video. A card whose stored thumbnail 404s therefore
  // still gets a real poster instead of an empty box.
  const posterUrls =
    linkPreview.imageUrl && linkPreview.imageUrl !== derivedPosterUrl
      ? [linkPreview.imageUrl, derivedPosterUrl]
      : [derivedPosterUrl]
  const posterUrl =
    posterUrls.find((url) => !failedPosterUrls.includes(url)) ?? null
  // Re-entrant by design: the ref runs again after the state change, sees the
  // next candidate, and stops when one loads. What terminates it is that the
  // candidate list has at most two entries and every failure advances past one
  // — not the identical-array branch below, which never runs on that path,
  // since `posterUrl` is by construction a URL the list does not yet contain.
  // That branch is for a late `error` from an element already replaced.
  const markPosterFailed = (url: string) =>
    setFailedPosterUrls((current) =>
      current.includes(url) ? current : [...current, url]
    )

  const domain = getDomain(linkPreview)

  // The button the reader just activated is the element that unmounts, and the
  // browser's fallback for a focused element disappearing is `document.body` —
  // so a keyboard user would be dropped to the top of the page with no signal
  // that anything happened, and the next Tab would resume from the document
  // start rather than from the video they just opened. Moving focus onto the
  // frame keeps them where they were and hands the player their keys (space to
  // pause). This is the same move `StatusReplyBox` makes when its inline UI
  // replaces the trigger that opened it.
  const playerRef = useRef<HTMLIFrameElement>(null)
  useEffect(() => {
    if (isPlaying) playerRef.current?.focus()
  }, [isPlaying])

  return (
    <div
      className={cn(
        'mt-2 overflow-hidden rounded-xl border border-border/60 bg-muted/20',
        className
      )}
    >
      <div className="relative aspect-video w-full bg-black">
        {isPlaying ? (
          <iframe
            ref={playerRef}
            // Built from the card's own url, never from the page's metadata —
            // and always on the cookie-light host, which is the only origin
            // this app's CSP allows in a frame.
            src={getYouTubeEmbedUrl(video, { autoplay: true })}
            // Frames need an accessible name of their own; the card title is
            // what a reader would call this one.
            title={linkPreview.title || 'YouTube video player'}
            // Autoplay's default allowlist is `self`, so the reader's click in
            // THIS document does not reach the frame unless it is delegated.
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
            // No referrerPolicy override: the site default sends the origin
            // only, and `no-referrer` breaks videos whose owners restrict
            // embedding to allowlisted domains. The poster below keeps
            // `no-referrer` because it loads before the reader has consented to
            // anything; this frame only exists because they pressed play.
            // No sandbox either — but not because one would be useless. A
            // sandbox is only neutered by `allow-scripts allow-same-origin`
            // when the framed document is SAME-origin with us, which this is
            // not, so one would still deny top-level navigation and popups.
            // It is left off because the player's own affordances need popups
            // ("Watch on YouTube", end-screen links), and the origin is already
            // pinned twice over: by the builder and by the CSP frame-src.
            className="absolute inset-0 size-full border-0"
          />
        ) : (
          <button
            type="button"
            onClick={(event: MouseEvent) => {
              event.stopPropagation()
              setPlayingVideoId(video.videoId)
            }}
            aria-label={
              linkPreview.title
                ? `Play video: ${linkPreview.title}`
                : 'Play video'
            }
            // The focus indicator is NOT on this element — see the overlay at
            // the end of the button. Nothing painted on the button itself
            // survives: an outward ring is clipped by the wrapper's
            // `overflow-hidden` (which must stay, to round the video's square
            // corners) because the button is flush with its edges, an inward
            // one paints below the button's own descendants, and an outline
            // does not come out either, because the poster is an
            // `absolute inset-0` child covering the box exactly. All three were
            // measured on a focused button with a poster loaded: zero indicator
            // pixels. `outline-none` is therefore deliberate, not an oversight.
            className="group absolute inset-0 flex cursor-pointer items-center justify-center focus-visible:outline-none"
          >
            {posterUrl ? (
              // A plain <img>, not next/image: the same reason the standard
              // card gives — this server must not sit in front of every
              // thumbnail it renders.
              <img
                key={posterUrl}
                src={posterUrl}
                alt=""
                role="presentation"
                loading="lazy"
                referrerPolicy="no-referrer"
                // Both halves are needed: the ref catches a failure that
                // happened before hydration, onError catches one that happens
                // after. Keying on the URL gives each candidate its own element,
                // so the ref runs again for the fallback.
                ref={(image) => {
                  if (image && hasImageAlreadyFailed(image)) {
                    markPosterFailed(posterUrl)
                  }
                }}
                onError={() => markPosterFailed(posterUrl)}
                className="absolute inset-0 size-full object-cover"
              />
            ) : null}
            {/* Decoration: the button's own label already says what this does,
                and with no poster left to show this is the whole facade. */}
            <span
              aria-hidden="true"
              // The hairline is what keeps the badge legible when NO poster
              // loaded: the area behind it is then plain `bg-black`, and black
              // at any opacity composites to black, so the circle and its hover
              // state would both vanish and leave a bare floating triangle.
              className="relative rounded-full bg-black/60 p-4 ring-1 ring-white/25 transition-colors group-hover:bg-black/80"
            >
              <Play className="size-8 fill-white text-white" />
            </span>
            {/* The focus indicator, as an overlay rather than a style on the
                button, because this is the only place it survives: painted
                LAST, after the poster that covers the button's box, and inside
                its own bounds so the wrapper's clip cannot take it. */}
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 ring-inset ring-ring/50 group-focus-visible:ring-2"
            />
          </button>
        )}
      </div>
      <a
        href={safeExternalHref(linkPreview.url)}
        target="_blank"
        rel="noopener noreferrer nofollow"
        // Defensive, and the same reason the standard card gives: every sibling
        // block that navigates stops propagation.
        onClick={(event: MouseEvent) => event.stopPropagation()}
        // Spelled out rather than left to the UA outline, which does render but
        // is clipped on three sides: this anchor is flush with the wrapper's
        // left, right and bottom edges. Same offset outline as the button, for
        // one mechanism rather than two — and it needs the matching bottom
        // radius, since a square outline inside a `rounded-xl` clip gets its
        // corners nipped.
        className="block space-y-0.5 rounded-b-[11px] p-3 transition-colors hover:bg-muted/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring/50"
      >
        {/* No publisher name beside it: on a YouTube card it only ever repeats
            the domain. The domain is the part the page cannot choose, so it is
            the part that is shown. */}
        <div className="truncate text-xs text-muted-foreground">{domain}</div>
        <div className="line-clamp-2 wrap-anywhere text-sm font-semibold leading-snug">
          {linkPreview.title}
        </div>
      </a>
    </div>
  )
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
const StandardLinkPreviewCard: FC<LinkPreviewCardProps> = ({
  linkPreview,
  className
}) => {
  // A thumbnail is hotlinked from whatever host the page author chose, so it
  // can fail for reasons this server cannot see or fix — hotlink protection, a
  // dead CDN, an expired signed URL. Keeping a broken image holds an 88px hole
  // open in the card, so a failure degrades to the text-only card instead.
  //
  // The failure is remembered by URL rather than as a boolean, which is what
  // keeps a status replaced in place (an edit, or a feed row reused for a
  // different post) from inheriting the previous card's failure: a different
  // URL simply does not match. It used to be a boolean reset in an effect, and
  // that effect ran AFTER the ref below and overwrote what it had just found —
  // so the pre-hydration failure this fallback exists for was undone on every
  // mount.
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null)
  const imageFailed =
    Boolean(linkPreview.imageUrl) && failedImageUrl === linkPreview.imageUrl

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
          // The ref covers a failure that landed before hydration, which is the
          // common case for a server-rendered card: without it `onError` never
          // fires and the promised text-only fallback never happens.
          // Unlike the YouTube poster this needs no `key`, because a recorded
          // failure UNMOUNTS the image — so no broken element ever survives to
          // be handed a new `src` and condemn it on the old element's state.
          // Anything that keeps the image mounted through a failure has to
          // bring the key with it.
          ref={(image) => {
            if (image && hasImageAlreadyFailed(image)) {
              setFailedImageUrl(linkPreview.imageUrl ?? null)
            }
          }}
          onError={() => setFailedImageUrl(linkPreview.imageUrl ?? null)}
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
            // The separator rides WITH the name — inside the truncating box,
            // as an inline child rather than its own flex item — so a name
            // squeezed to nothing on a narrow card clips the "·" along with it
            // instead of leaving it orphaned at the head of the line. Being a
            // nested element rather than bare text is what lets it stay
            // decoration to a screen reader.
            <span className="min-w-0 truncate">
              {siteName}
              <span aria-hidden="true"> ·</span>
            </span>
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

/**
 * The preview card for the link in a status. A link to a YouTube video renders
 * as a click-to-play player; everything else renders as the standard card.
 *
 * The branch reads the card's `url` — the redirect-resolved URL this server
 * actually fetched — and never the page's own `og:type` or the stored card
 * `type`, both of which the page controls. Splitting the two anatomies into
 * separate components (rather than branching inside one) is what makes a card
 * replaced in place safe: React swaps the component type, so neither half can
 * inherit the other's state.
 */
export const LinkPreviewCard: FC<LinkPreviewCardProps> = ({
  linkPreview,
  className
}) => {
  const video = getYouTubeVideoFromUrl(linkPreview.url)

  if (video) {
    return (
      // Keyed on the video so React CLEARS the card's state when the linked
      // video changes, rather than the card comparing against state it kept.
      // Deriving `isPlaying` from a remembered id defends A→B but not A→B→A:
      // the remembered id was never cleared, so returning to a video the reader
      // had played re-entered the playing branch with no click — mounting an
      // autoplaying frame and taking focus. A remount starts from `null`, in
      // the same commit, so there is still no painted frame of autoplay.
      <YouTubeLinkPreviewCard
        key={video.videoId}
        linkPreview={linkPreview}
        video={video}
        className={className}
      />
    )
  }

  return (
    <StandardLinkPreviewCard linkPreview={linkPreview} className={className} />
  )
}
