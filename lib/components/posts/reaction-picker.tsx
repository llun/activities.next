'use client'

import { Search, Sticker } from 'lucide-react'
import {
  FC,
  RefObject,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { createPortal } from 'react-dom'

import { getCustomEmojis } from '@/lib/client'
import {
  EMOJI_GROUPS,
  searchSystemEmojis
} from '@/lib/components/post-box/emoji-data'
import { Input } from '@/lib/components/ui/input'
import { cn } from '@/lib/utils'

export interface CustomEmojiOption {
  shortcode: string
  url: string
}

// A reaction is one emoji, so the picker returns the *name to store* rather than
// text to insert at a caret: a unicode character as itself, a custom emoji as its
// bare shortcode (the API accepts either spelling; bare matches what is stored).
type PickerItem =
  | { kind: 'custom'; key: string; name: string; label: string; url: string }
  | { kind: 'system'; key: string; name: string; label: string; char: string }

const ItemGlyph: FC<{ item: PickerItem }> = ({ item }) =>
  item.kind === 'custom' ? (
    <img
      src={item.url}
      alt={item.label}
      className="h-[22px] w-[22px] object-contain"
    />
  ) : (
    <span style={{ fontSize: 20, lineHeight: 1 }}>{item.char}</span>
  )

// The instance's custom emoji, fetched at most once per page load. Threading
// them as a prop would touch every surface that renders a post (~30 files),
// which is exactly the prop-drilling AGENTS.md warns against for instance-wide
// values; the picker is also the only consumer, and only once it is opened.
let customEmojiRequest: Promise<CustomEmojiOption[]> | null = null

const loadCustomEmojis = (): Promise<CustomEmojiOption[]> => {
  if (!customEmojiRequest) {
    customEmojiRequest = getCustomEmojis()
      .then((emojis) =>
        emojis
          .filter((emoji) => emoji.visible_in_picker)
          .map((emoji) => ({ shortcode: emoji.shortcode, url: emoji.url }))
      )
      // A failure degrades to unicode-only rather than breaking the picker, and
      // is not cached so the next open retries.
      .catch(() => {
        customEmojiRequest = null
        return []
      })
  }
  return customEmojiRequest
}

interface ReactionPickerProps {
  onPick: (name: string) => void
  onClose: () => void
  // The button the picker hangs off. Its viewport rect anchors the panel.
  anchorRef: RefObject<HTMLButtonElement | null>
}

const PANEL_WIDTH = 288
const VIEWPORT_MARGIN = 8

// The panel is rendered in a portal at the document root and positioned from
// the trigger's viewport rect. It used to be an `absolute` child of the chip
// row, which meant ANY ancestor with `overflow-hidden` clipped it — and the
// cards that wrap posts have it for their rounded corners. That was fixed
// container-by-container three times and kept reappearing somewhere else (the
// status detail cards, the fitness header card, the search results section,
// the collection detail card), so the panel now escapes them all by
// construction.
const usePanelPosition = (
  anchorRef: RefObject<HTMLButtonElement | null>,
  panel: HTMLElement | null
) => {
  const [position, setPosition] = useState<{
    top: number
    left: number
  } | null>(null)

  useLayoutEffect(() => {
    const place = () => {
      const anchor = anchorRef.current
      if (!anchor) return
      const rect = anchor.getBoundingClientRect()
      const height = panel?.offsetHeight ?? 0

      // Below the trigger by default; above it when there isn't room, which is
      // reachable either way because the panel is viewport-positioned.
      const below = rect.bottom + VIEWPORT_MARGIN
      const fitsBelow = below + height <= window.innerHeight - VIEWPORT_MARGIN
      const top = fitsBelow
        ? below
        : Math.max(VIEWPORT_MARGIN, rect.top - VIEWPORT_MARGIN - height)

      // Clamp right edge first, then left — doing it the other way round lets a
      // viewport narrower than the panel produce a negative left, pushing the
      // panel off-screen instead of pinning it to the margin.
      const left = Math.max(
        VIEWPORT_MARGIN,
        Math.min(rect.left, window.innerWidth - PANEL_WIDTH - VIEWPORT_MARGIN)
      )
      setPosition({ top, left })
    }

    place()
    // Scrolling or resizing moves the trigger, so follow it rather than leaving
    // the panel stranded. `capture` catches scrolls in any ancestor.
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [anchorRef, panel])

  return position
}

/**
 * The emoji picker for post reactions. Reuses the post-box picker's data layer
 * (`EMOJI_GROUPS` + `searchSystemEmojis` + the instance's custom emoji) rather
 * than duplicating an emoji table, but returns a reaction name instead of
 * inserting text.
 */
export const ReactionPicker: FC<ReactionPickerProps> = ({
  onPick,
  onClose,
  anchorRef
}) => {
  const [query, setQuery] = useState('')
  const [customEmojis, setCustomEmojis] = useState<CustomEmojiOption[]>([])
  const [tab, setTab] = useState(EMOJI_GROUPS[0].id)
  const [panel, setPanel] = useState<HTMLDivElement | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const hasFocusedSearch = useRef(false)
  const hasCustom = customEmojis.length > 0
  const position = usePanelPosition(anchorRef, panel)

  // `autoFocus` is not enough: the panel is `visibility: hidden` until it has
  // been measured, and a browser will not focus inside a hidden subtree — so
  // the field silently stayed unfocused and the picker opened with focus on
  // <body>. (jsdom focuses regardless, which is why only a real browser showed
  // it.) Focus once the panel is placed, and only once, so a scroll-driven
  // reposition cannot yank focus back off an emoji the viewer has tabbed to.
  useEffect(() => {
    if (!position || hasFocusedSearch.current) return
    hasFocusedSearch.current = true
    searchRef.current?.focus()
  }, [position])

  useEffect(() => {
    let active = true
    loadCustomEmojis().then((emojis) => {
      if (active) setCustomEmojis(emojis)
    })
    return () => {
      active = false
    }
  }, [])

  // Escape closes the picker, matching the post-box picker and the announcement
  // reaction picker.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const tabs = useMemo(
    () => [
      ...(hasCustom
        ? [{ id: 'custom', name: 'Custom', kind: 'icon' as const }]
        : []),
      ...EMOJI_GROUPS.map((group) => ({
        id: group.id,
        name: group.name,
        kind: 'emoji' as const,
        glyph: group.icon
      }))
    ],
    [hasCustom]
  )

  const items = useMemo<PickerItem[]>(() => {
    const toCustom = (emoji: CustomEmojiOption): PickerItem => ({
      kind: 'custom',
      key: `c:${emoji.shortcode}`,
      name: emoji.shortcode,
      label: `:${emoji.shortcode}:`,
      url: emoji.url
    })
    const trimmed = query.trim().toLowerCase()
    if (trimmed) {
      return [
        ...customEmojis
          .filter((emoji) => emoji.shortcode.toLowerCase().includes(trimmed))
          .map(toCustom),
        ...searchSystemEmojis(trimmed).map((emoji) => ({
          kind: 'system' as const,
          key: `s:${emoji.char}`,
          name: emoji.char,
          label: emoji.name,
          char: emoji.char
        }))
      ]
    }
    if (tab === 'custom') return customEmojis.map(toCustom)
    const group = EMOJI_GROUPS.find((candidate) => candidate.id === tab)
    return group
      ? group.emojis.map((emoji) => ({
          kind: 'system' as const,
          key: `s:${emoji.char}`,
          name: emoji.char,
          label: emoji.name,
          char: emoji.char
        }))
      : []
  }, [query, tab, customEmojis])

  const content = (
    <>
      {/* Outside-click overlay. aria-hidden keeps this full-viewport target out
          of the accessibility tree. */}
      <div className="fixed inset-0 z-30" aria-hidden onClick={onClose} />
      <div
        ref={setPanel}
        role="dialog"
        aria-label="Choose a reaction"
        className="bg-background fixed z-40 w-72 overflow-hidden rounded-xl border shadow-lg"
        style={{
          top: position?.top ?? 0,
          left: position?.left ?? 0,
          // Hidden for the first paint only, while the panel is measured: it
          // has no height until it is in the DOM, so its placement cannot be
          // computed any earlier.
          visibility: position ? 'visible' : 'hidden'
        }}
      >
        <div className="border-b p-2.5">
          <div className="relative">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
            <Input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search emoji"
              aria-label="Search emoji"
              className="h-9 pl-8"
            />
          </div>
        </div>

        {!query.trim() && (
          <div className="no-scrollbar flex items-center gap-0.5 overflow-x-auto px-2 pt-1.5">
            {tabs.map((entry) => (
              <button
                key={entry.id}
                type="button"
                title={entry.name}
                aria-label={entry.name}
                aria-pressed={entry.id === tab}
                onClick={() => setTab(entry.id)}
                className={cn(
                  'focus-visible:ring-ring inline-flex size-8 shrink-0 items-center justify-center rounded-md transition-colors focus-visible:ring-2 focus-visible:outline-none',
                  entry.id === tab
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-muted'
                )}
              >
                {entry.kind === 'icon' ? (
                  <Sticker className="size-4" />
                ) : (
                  <span style={{ fontSize: 18, lineHeight: 1 }}>
                    {entry.glyph}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        <div className="max-h-[200px] overflow-y-auto px-2 py-2">
          {items.length === 0 ? (
            <p className="text-muted-foreground py-6 text-center text-sm">
              {query.trim()
                ? `Nothing matches “${query.trim()}”`
                : 'No custom emoji on this instance yet.'}
            </p>
          ) : (
            <div className="grid grid-cols-7 gap-1">
              {items.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  title={item.label}
                  aria-label={`React with ${item.label}`}
                  onClick={() => onPick(item.name)}
                  className="hover:bg-muted focus-visible:ring-ring inline-flex aspect-square w-full items-center justify-center rounded-md transition-colors focus-visible:ring-2 focus-visible:outline-none"
                >
                  <ItemGlyph item={item} />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )

  // Portalled to the document root so no ancestor's overflow can clip it.
  return typeof document === 'undefined'
    ? content
    : createPortal(content, document.body)
}
