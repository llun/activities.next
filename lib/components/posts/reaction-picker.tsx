'use client'

import { Search, Sticker } from 'lucide-react'
import { FC, useEffect, useMemo, useState } from 'react'

import { getCustomEmojis } from '@/lib/client'
import {
  EMOJI_GROUPS,
  searchSystemEmojis
} from '@/lib/components/post-box/emoji-data'
import { Input } from '@/lib/components/ui/input'
import { cn } from '@/lib/utils'

import type { CustomEmojiOption } from './reaction-row'

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
}

/**
 * The emoji picker for post reactions. Reuses the post-box picker's data layer
 * (`EMOJI_GROUPS` + `searchSystemEmojis` + the instance's custom emoji) rather
 * than duplicating an emoji table, but returns a reaction name instead of
 * inserting text.
 */
export const ReactionPicker: FC<ReactionPickerProps> = ({
  onPick,
  onClose
}) => {
  const [query, setQuery] = useState('')
  const [customEmojis, setCustomEmojis] = useState<CustomEmojiOption[]>([])
  const [tab, setTab] = useState(EMOJI_GROUPS[0].id)
  const hasCustom = customEmojis.length > 0

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

  return (
    <>
      {/* Outside-click overlay. aria-hidden keeps this full-viewport target out
          of the accessibility tree. */}
      <div className="fixed inset-0 z-30" aria-hidden onClick={onClose} />
      <div
        role="dialog"
        aria-label="Choose a reaction"
        // Opens downward (like the composer's emoji picker) rather than upward.
        // Upward it needs ~330px of clear space above the chip row, which the
        // status detail page does not have — the focused post sits ~170px from
        // the top of its card, so the panel's head was clipped away by the
        // card's overflow, and block-start overflow can never be scrolled back
        // into view.
        className="bg-background absolute top-full left-0 z-40 mt-2 w-72 overflow-hidden rounded-xl border shadow-lg"
      >
        <div className="border-b p-2.5">
          <div className="relative">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
            <Input
              autoFocus
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
}
