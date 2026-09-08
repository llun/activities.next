'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'
import {
  CSSProperties,
  FC,
  MouseEvent,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'

import { CustomEmojiText } from '@/lib/components/actors/ActorDisplayName'
import {
  Attachment,
  isAudibleAttachment,
  isVisualAttachment
} from '@/lib/types/domain/attachment'
import { Status, StatusNote, StatusType } from '@/lib/types/domain/status'
import { cn } from '@/lib/utils'

import { Media } from './media'
import { useMediaStripScroll } from './useMediaStripScroll'

export type OnMediaSelectedHandle = (
  allMedias: Attachment[],
  selectedMediaIndex: number
) => void

const STRIP_ROW_HEIGHT = 240
const SINGLE_MAX_HEIGHT = 420
const STRIP_ITEM_MAX_WIDTH = '78%'
const STRIP_SNAP_TYPE = 'x proximity'
const FALLBACK_ASPECT_RATIO = 4 / 3
const FALLBACK_ASPECT_RATIO_CSS = '4 / 3'
const MIN_ASPECT_RATIO = 1 / 3
const MAX_ASPECT_RATIO = 3
const MIN_MEDIA_WIDTH = 44

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
    aspectRatio:
      ratio === width / height ? `${width} / ${height}` : String(ratio),
    naturalWidth: width
  }
}

const MEDIA_BOX_CLASS =
  'relative block cursor-zoom-in overflow-hidden rounded-2xl border border-border/60 bg-muted/20'
const SINGLE_FOCUS_CLASS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50'
const STRIP_FOCUS_CLASS =
  'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring/50'

interface CaptionProps {
  identity: string
  text: string
  tags: StatusNote['tags']
}

const Caption: FC<CaptionProps> = ({ identity, text, tags }) => {
  const [isExpanded, setIsExpanded] = useState(false)
  const [canExpand, setCanExpand] = useState(false)
  const captionRef = useRef<HTMLParagraphElement | null>(null)
  const captionId = useId()

  const measure = useCallback(() => {
    const element = captionRef.current
    if (!element) return
    const styles = window.getComputedStyle(element)
    const parsedLineHeight = Number.parseFloat(styles.lineHeight)
    const lineHeight = Number.isFinite(parsedLineHeight) ? parsedLineHeight : 21
    setCanExpand(element.scrollHeight > lineHeight * 3 + 1)
  }, [])

  useLayoutEffect(() => {
    setIsExpanded(false)
    setCanExpand(false)
  }, [identity, text])

  useLayoutEffect(() => {
    measure()
  }, [measure, isExpanded, identity, text])

  useEffect(() => {
    const element = captionRef.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [measure, identity, text])

  return (
    <div
      className="mt-2 select-text text-sm leading-relaxed text-muted-foreground"
      onClick={(event) => event.stopPropagation()}
    >
      <p
        ref={captionRef}
        id={captionId}
        className={cn(
          'break-words whitespace-pre-wrap',
          !isExpanded && 'line-clamp-3'
        )}
      >
        <CustomEmojiText text={text} tags={tags} />
      </p>
      {canExpand ? (
        <button
          type="button"
          aria-expanded={isExpanded}
          aria-controls={captionId}
          className="mt-1 cursor-pointer rounded-sm font-medium text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          onClick={(event) => {
            event.stopPropagation()
            setIsExpanded((expanded) => !expanded)
          }}
        >
          {isExpanded ? 'Show less' : 'Show more'}
        </button>
      ) : null}
    </div>
  )
}

interface Props {
  status: Status
  onMediaSelected: OnMediaSelectedHandle
}

export const Attachments: FC<Props> = ({ status, onMediaSelected }) => {
  const attachments = useMemo(
    () => (status.type === StatusType.enum.Note ? status.attachments : []),
    [status]
  )
  const pictures = useMemo(
    () => attachments.filter(isVisualAttachment),
    [attachments]
  )
  const players = useMemo(
    () => attachments.filter(isAudibleAttachment),
    [attachments]
  )
  const items = useMemo(
    () =>
      pictures.map((attachment) => ({
        attachment,
        width: Math.max(
          160,
          Math.round(STRIP_ROW_HEIGHT * getMediaGeometry(attachment).ratio)
        )
      })),
    [pictures]
  )
  const strip = useMediaStripScroll(items.map((item) => item.width).join(','))
  const { canScrollLeft, canScrollRight } = strip

  if (status.type !== StatusType.enum.Note) return null
  if (!pictures.length && !players.length) return null

  const openMedia = (index: number) => (event: MouseEvent) => {
    event.stopPropagation()
    onMediaSelected(pictures, index)
  }

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
    const caption = attachment.name?.trim()
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
          {caption ? (
            <Caption
              identity={attachment.id}
              text={caption}
              tags={status.tags}
            />
          ) : null}
        </div>
        {audioPlayers}
      </>
    )
  }

  const overflowing = canScrollLeft || canScrollRight
  const stripStyle: CSSProperties = {
    minHeight: STRIP_ROW_HEIGHT,
    scrollSnapType: STRIP_SNAP_TYPE
  }

  return (
    <>
      {items.length ? (
        <div className="mt-3">
          <div
            ref={strip.ref}
            onScroll={strip.measure}
            role="group"
            aria-label={`${items.length} media attachments${overflowing ? ', scroll for more' : ''}`}
            className="no-scrollbar relative flex gap-3 overflow-x-auto"
            style={stripStyle}
          >
            {items.map(({ attachment, width }, index) => {
              const caption = attachment.name?.trim()
              return (
                <div
                  key={attachment.id}
                  className="flex flex-none flex-col"
                  style={{ width, maxWidth: STRIP_ITEM_MAX_WIDTH }}
                >
                  <button
                    type="button"
                    onClick={openMedia(index)}
                    aria-label={mediaLabel(attachment, index)}
                    className={cn(
                      MEDIA_BOX_CLASS,
                      STRIP_FOCUS_CLASS,
                      'h-[240px] w-full flex-none'
                    )}
                    style={{ scrollSnapAlign: 'start' }}
                  >
                    <Media
                      className="h-full w-full object-cover"
                      attachment={attachment}
                      loading="lazy"
                    />
                  </button>
                  {caption ? (
                    <Caption
                      identity={attachment.id}
                      text={caption}
                      tags={status.tags}
                    />
                  ) : null}
                </div>
              )
            })}
          </div>
          {overflowing ? (
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                aria-label="Previous media"
                aria-disabled={!canScrollLeft}
                onClick={(event) => {
                  event.stopPropagation()
                  if (!canScrollLeft) return
                  strip.scrollByPage(-1)
                }}
                className="flex size-11 items-center justify-center rounded-full border bg-background text-foreground shadow-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 aria-disabled:cursor-default aria-disabled:opacity-50"
              >
                <ChevronLeft className="size-5" aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label="Next media"
                aria-disabled={!canScrollRight}
                onClick={(event) => {
                  event.stopPropagation()
                  if (!canScrollRight) return
                  strip.scrollByPage(1)
                }}
                className="flex size-11 items-center justify-center rounded-full border bg-background text-foreground shadow-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 aria-disabled:cursor-default aria-disabled:opacity-50"
              >
                <ChevronRight className="size-5" aria-hidden="true" />
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      {audioPlayers}
    </>
  )
}
