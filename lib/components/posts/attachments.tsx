'use client'

import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { CSSProperties, FC, MouseEvent, useId, useMemo, useState } from 'react'

import { CustomEmojiText } from '@/lib/components/actors/ActorDisplayName'
import {
  Attachment,
  isAudibleAttachment,
  isVisualAttachment
} from '@/lib/types/domain/attachment'
import { Status, StatusType } from '@/lib/types/domain/status'
import { cn } from '@/lib/utils'

import { Media } from './media'
import { useMediaStripScroll } from './useMediaStripScroll'

export type OnMediaSelectedHandle = (
  allMedias: Attachment[],
  selectedMediaIndex: number
) => void

/**
 * The row height two or more attachments lay out at, and the height a single
 * one is scaled down to. Both come from the design system's media strip.
 */
const STRIP_ROW_HEIGHT = 240
const SINGLE_MAX_HEIGHT = 420

/**
 * No single item may fill the strip, so the next one always peeks past the
 * edge. That peek is what says "this scrolls" on a touch screen, where the back
 * chevron never appears at all (it is gated on hover) and the forward one is
 * easy to miss.
 */
const STRIP_ITEM_MAX_WIDTH = '78%'

/**
 * `proximity`, never `mandatory`: mandatory snapping would pull the peeking
 * item flush with the edge the moment the scroll settled and undo the very
 * affordance the 78% cap creates.
 */
const STRIP_SNAP_TYPE = 'x proximity'

/** How far the fade at each scrollable edge reaches. */
const EDGE_FADE_WIDTH = 48

/**
 * An attachment federated without dimensions still needs a box to reserve, or
 * the blurhash placeholder has nothing to paint into and the strip measures
 * itself before any width exists. 4:3 is the shape most photos arrive in; the
 * grid this replaced assumed 16:9 for the same reason.
 */
const FALLBACK_ASPECT_RATIO = 4 / 3
const FALLBACK_ASPECT_RATIO_CSS = '4 / 3'

/**
 * The shapes a media box is allowed to take. A 10x10000 sliver would round one
 * axis of its box to zero and render an invisible, unclickable item, and remote
 * dimensions are whatever the origin server said they were. `object-cover`
 * crops whatever the clamp trims.
 */
const MIN_ASPECT_RATIO = 1 / 3
const MAX_ASPECT_RATIO = 3

/**
 * A single box is capped at the file's own pixels so a thumbnail is not
 * upscaled, which for a genuinely tiny image leaves a target too small to hit.
 * 44px is the WCAG 2.5.8 minimum.
 */
const MIN_MEDIA_WIDTH = 44

/**
 * A stored `0` means "dimensions unknown", NOT "zero pixels wide" — several
 * media-storage paths persist `metaData.width ?? 0` (`lib/services/medias/`),
 * and a federated `Document` carries whatever the remote server sent. So every
 * consumer of a dimension has to apply this same guard; reading
 * `attachment.width` raw collapses the box to nothing.
 */
const getMediaGeometry = ({ width, height }: Attachment) => {
  if (!width || !height || width <= 0 || height <= 0) {
    return {
      ratio: FALLBACK_ASPECT_RATIO,
      aspectRatio: FALLBACK_ASPECT_RATIO_CSS,
      naturalWidth: undefined
    }
  }
  const ratio = Math.min(
    MAX_ASPECT_RATIO,
    Math.max(MIN_ASPECT_RATIO, width / height)
  )
  return {
    ratio,
    // Keep the exact `W / H` form whenever the shape was not clamped: it is
    // what a reader sees in devtools, and it avoids float drift on a very tall
    // image. A clamped box has to declare the shape it is actually laid out at
    // or its width and its ratio would disagree.
    aspectRatio:
      ratio === width / height ? `${width} / ${height}` : String(ratio),
    naturalWidth: width
  }
}

/**
 * A gradient MASK rather than a gradient background: posts render on four
 * different surfaces (`bg-card` when framed, `bg-background` on the status
 * detail, `bg-muted/30` for an ancestor row, and the page itself when
 * unframed), so a fade painted in any one token is visibly wrong on the other
 * three — and wrong in both themes. Masking fades the strip's own pixels and
 * lets whatever is behind show through.
 *
 * A standalone function so the string itself is unit-testable: jsdom's CSS
 * parser rejects the two variants carrying `calc()` and stores nothing for
 * them, so a rendered node can only ever be asserted against the left-edge-only
 * form.
 */
export const buildEdgeFadeMask = (
  canScrollLeft: boolean,
  canScrollRight: boolean
) => {
  if (!canScrollLeft && !canScrollRight) return undefined
  const start = canScrollLeft
    ? `transparent 0, #000 ${EDGE_FADE_WIDTH}px`
    : '#000 0'
  const end = canScrollRight
    ? `#000 calc(100% - ${EDGE_FADE_WIDTH}px), transparent 100%`
    : '#000 100%'
  return `linear-gradient(to right, ${start}, ${end})`
}

/**
 * A pointer press must not move focus to the chevron — see CHEVRON_CLASS below.
 * Cancelling the default on mousedown is what stops the browser focusing it,
 * and it leaves the click itself, and every keyboard path, untouched.
 */
const preventFocusOnPress = (event: MouseEvent) => event.preventDefault()

const MEDIA_BOX_CLASS =
  'relative block cursor-zoom-in overflow-hidden rounded-xl border border-border/60 bg-muted/20'

/**
 * A lone picture is not inside an overflow container, so an ordinary outset
 * ring paints in the clear space around it.
 */
const SINGLE_FOCUS_CLASS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50'

/**
 * A strip item cannot use that ring. Its border box is exactly the strip's
 * height and `overflow-x-auto` forces `overflow-y` to compute to `auto`, so an
 * OUTSET ring's top and bottom bars fall outside the scrollport and are clipped
 * away. An INSET one is worse: an inset `box-shadow` paints with the element's
 * background, underneath its content, and the button's only child is an opaque
 * image filling the whole box — so it is occluded on all four sides and there
 * is no indicator at all. An outline with a negative offset draws inside the
 * border box AND paints above content, which is the combination this needs.
 */
const STRIP_FOCUS_CLASS =
  'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring/50'

/**
 * The chevrons are POINTER affordances. They duplicate no function — every
 * picture is a focusable button and focusing one scrolls it into view, which is
 * the whole of what a chevron does — and each is unmounted by the very scroll
 * it performs, so a chevron holding focus would drop it to `<body>` on its last
 * press and send the next Tab back to the top of the page (WCAG 2.4.3).
 *
 * Keeping them out of the tab order takes BOTH `tabIndex={-1}` and the
 * mousedown guard below. `tabindex="-1"` removes an element from the SEQUENTIAL
 * tab order only; it stays click-focusable, and Chrome and Firefox focus a
 * `<button>` on click, so the mouse path reaches the same dropped focus the
 * keyboard path avoids.
 */
const CHEVRON_CLASS =
  'absolute top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full border bg-popover text-foreground shadow-sm hover:bg-muted'

interface Props {
  status: Status
  onMediaSelected: OnMediaSelectedHandle
}

export const Attachments: FC<Props> = ({ status, onMediaSelected }) => {
  const [isAltExpanded, setIsAltExpanded] = useState(true)
  const altListId = useId()
  const attachments = useMemo(
    () => (status.type === StatusType.enum.Note ? status.attachments : []),
    [status]
  )

  // The lightbox is handed exactly the pictures the post shows, and an index
  // into THAT list — never the raw attachment array. Anything filtered out here
  // is something `Media` renders as nothing, so passing it on would give the
  // modal a blank slide, an empty thumbnail and a wrong "n of m" count.
  const pictures = useMemo(
    () => attachments.filter(isVisualAttachment),
    [attachments]
  )
  const players = useMemo(
    () => attachments.filter(isAudibleAttachment),
    [attachments]
  )

  // Each item's width is decided here rather than in the map so it can also key
  // the scroll measurement: the observer watches the container, which does not
  // resize when an edit swaps one attachment for another of a different shape.
  const items = useMemo(
    () =>
      pictures.map((attachment) => ({
        attachment,
        width: Math.round(STRIP_ROW_HEIGHT * getMediaGeometry(attachment).ratio)
      })),
    [pictures]
  )

  const strip = useMediaStripScroll(items.map((item) => item.width).join(','))
  const { canScrollLeft, canScrollRight } = strip

  const edgeFadeMask = buildEdgeFadeMask(canScrollLeft, canScrollRight)

  if (status.type !== StatusType.enum.Note) return null
  if (!pictures.length && !players.length) return null

  const openMedia = (index: number) => (event: MouseEvent) => {
    // The post row is itself clickable — opening the lightbox must not also
    // navigate to the status.
    event.stopPropagation()
    onMediaSelected(pictures, index)
  }

  // `Media` names the image from its `alt`, but `attachment.name` is a required
  // string that federation writes as `attachment.name || ''`, so an undescribed
  // photo leaves the button with no accessible name at all — a screen reader
  // announces "button" with nothing to tell one photo from the next. Same
  // wording as `ActorMediaGallery`, which already solved this.
  const mediaLabel = (attachment: Attachment, index: number) =>
    attachment.name
      ? `Open media: ${attachment.name}`
      : `Open media ${index + 1}`

  const audioPlayers = players.length ? (
    <div className="mt-3 flex flex-col items-start gap-2">
      {players.map((attachment) => (
        <Media
          key={attachment.id}
          className="w-full max-w-80"
          attachment={attachment}
        />
      ))}
    </div>
  ) : null

  // A lone picture keeps its own shape and hugs the post's left edge instead of
  // being cropped to a full-width banner. It is scaled by WIDTH, never by
  // capping the height of an aspect-ratio box: the width that puts the image at
  // SINGLE_MAX_HEIGHT is plain arithmetic, and `min(100%, …)` then keeps it
  // inside a narrow post with the ratio intact. A capped max-height would leave
  // the ratio to be re-derived from a clamped axis, which browsers resolve
  // inconsistently.
  if (pictures.length === 1) {
    const attachment = pictures[0]
    const { ratio, aspectRatio, naturalWidth } = getMediaGeometry(attachment)
    const width = Math.max(
      MIN_MEDIA_WIDTH,
      Math.min(
        naturalWidth ?? Number.POSITIVE_INFINITY,
        Math.round(SINGLE_MAX_HEIGHT * ratio)
      )
    )
    const altText = attachment.name?.trim()
    return (
      <>
        <div className="mt-3 flex flex-col justify-start">
          <button
            type="button"
            onClick={openMedia(0)}
            aria-label={mediaLabel(attachment, 0)}
            className={cn(MEDIA_BOX_CLASS, SINGLE_FOCUS_CLASS)}
            style={{ aspectRatio, width: `min(100%, ${width}px)` }}
          >
            <Media
              className="h-full w-full object-cover"
              attachment={attachment}
            />
          </button>
          {altText ? (
            <p
              onClick={(e) => e.stopPropagation()}
              className="mt-1.5 text-sm leading-relaxed text-muted-foreground break-words select-text"
            >
              <CustomEmojiText text={altText} tags={status.tags} />
            </p>
          ) : null}
        </div>
        {audioPlayers}
      </>
    )
  }

  const altEntries = useMemo(() => {
    const entries: { indices: number[]; text: string }[] = []
    pictures.forEach((pic, i) => {
      const text = pic.name?.trim()
      if (!text) return
      const existing = entries.find((e) => e.text === text)
      if (existing) {
        existing.indices.push(i + 1)
      } else {
        entries.push({ indices: [i + 1], text })
      }
    })
    return entries
  }, [pictures])

  const stripStyle: CSSProperties = {
    height: STRIP_ROW_HEIGHT,
    scrollSnapType: STRIP_SNAP_TYPE,
    maskImage: edgeFadeMask,
    WebkitMaskImage: edgeFadeMask
  }

  return (
    <>
      {items.length ? (
        <>
          <div className="group/media relative mt-3">
            <div
              ref={strip.ref}
              onScroll={strip.measure}
              role="group"
              // Only promise more once the measurement says there is more: a
              // strip whose items all fit tells a screen-reader user to scroll to
              // content that does not exist.
              aria-label={
                canScrollLeft || canScrollRight
                  ? `${items.length} media attachments, scroll for more`
                  : `${items.length} media attachments`
              }
              className="no-scrollbar flex gap-1.5 overflow-x-auto"
              style={stripStyle}
            >
              {items.map(({ attachment, width }, index) => {
                const alt = attachment.name?.trim()
                return (
                  <button
                    key={attachment.id}
                    type="button"
                    onClick={openMedia(index)}
                    aria-label={mediaLabel(attachment, index)}
                    className={cn(
                      MEDIA_BOX_CLASS,
                      STRIP_FOCUS_CLASS,
                      'h-full flex-none'
                    )}
                    style={{
                      width,
                      maxWidth: STRIP_ITEM_MAX_WIDTH,
                      scrollSnapAlign: 'start'
                    }}
                  >
                    <Media
                      className="h-full w-full object-cover"
                      attachment={attachment}
                      loading="lazy"
                    />
                    {alt ? (
                      <span
                        className="pointer-events-none absolute bottom-2 left-2 flex items-center rounded bg-black/60 px-1.5 py-0.5 text-xs font-semibold text-white shadow-sm backdrop-blur-xs"
                        aria-hidden="true"
                      >
                        ALT<sup>{index + 1}</sup>
                      </span>
                    ) : null}
                  </button>
                )
              })}
            </div>
            {canScrollLeft ? (
              <button
                type="button"
                tabIndex={-1}
                aria-label="Previous media"
                onMouseDown={preventFocusOnPress}
                onClick={(event) => {
                  event.stopPropagation()
                  strip.scrollByPage(-1)
                }}
                // Hidden until the strip is hovered — going back is only worth
                // chrome once you have gone forward. The forward chevron opposite
                // stays visible so "there is more" is discoverable without a
                // pointer. `pointer-events-none` while invisible is load-bearing:
                // `opacity-0` alone still hit-tests, and on a touch screen —
                // where `group-hover` never latches — that leaves a dead column
                // swallowing taps on the leftmost photo.
                className={cn(
                  CHEVRON_CLASS,
                  'pointer-events-none left-2 opacity-0 transition-opacity group-hover/media:pointer-events-auto group-hover/media:opacity-100'
                )}
              >
                <ChevronLeft className="size-4" />
              </button>
            ) : null}
            {canScrollRight ? (
              <button
                type="button"
                tabIndex={-1}
                aria-label="More media"
                onMouseDown={preventFocusOnPress}
                onClick={(event) => {
                  event.stopPropagation()
                  strip.scrollByPage(1)
                }}
                className={cn(CHEVRON_CLASS, 'right-2')}
              >
                <ChevronRight className="size-4" />
              </button>
            ) : null}
          </div>
          {altEntries.length ? (
            <div
              className="mt-2 flex flex-col gap-1 text-sm text-muted-foreground select-text"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                aria-expanded={isAltExpanded}
                aria-controls={isAltExpanded ? altListId : undefined}
                aria-label={
                  isAltExpanded ? 'Collapse alt text' : 'Expand alt text'
                }
                onClick={(e) => {
                  e.stopPropagation()
                  setIsAltExpanded((prev) => !prev)
                }}
                className="flex items-center gap-1 self-start text-xs font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer select-none"
              >
                <span>Alt text</span>
                <ChevronDown
                  className={cn(
                    'size-3.5 transition-transform duration-200',
                    isAltExpanded && 'rotate-180'
                  )}
                  aria-hidden="true"
                />
              </button>
              {isAltExpanded ? (
                <div id={altListId} className="flex flex-col gap-1">
                  {altEntries.map((entry) => (
                    <div
                      key={entry.indices.join('-')}
                      className="flex items-start gap-1 leading-relaxed"
                    >
                      <sup className="shrink-0 pt-0.5 text-xs font-semibold select-none">
                        {entry.indices.join(' ')}
                      </sup>
                      <span className="break-words">
                        <CustomEmojiText text={entry.text} tags={status.tags} />
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
      {audioPlayers}
    </>
  )
}
