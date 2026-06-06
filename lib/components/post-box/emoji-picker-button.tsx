'use client'

import { Search, Smile, Sticker } from 'lucide-react'
import { FC, useEffect, useMemo, useState } from 'react'

import { Button } from '@/lib/components/ui/button'
import { Input } from '@/lib/components/ui/input'
import type { CustomEmoji } from '@/lib/types/mastodon/customEmoji'
import { cn } from '@/lib/utils'

import { EMOJI_GROUPS, SystemEmoji, searchSystemEmojis } from './emoji-data'

// A picker item normalizes the two kinds (custom sticker image vs. unicode
// glyph) into one shape for the grid + preview. `insert` is the text inserted at
// the caret on select: `:shortcode: ` for custom emoji, the character for
// system emoji.
type PickerItem =
  | {
      kind: 'custom'
      key: string
      name: string
      label: string
      insert: string
      url: string
    }
  | {
      kind: 'system'
      key: string
      name: string
      label: string
      insert: string
      char: string
    }

const customItem = (emoji: CustomEmoji): PickerItem => ({
  kind: 'custom',
  key: `c:${emoji.shortcode}`,
  name: emoji.shortcode,
  label: `:${emoji.shortcode}:`,
  insert: `:${emoji.shortcode}: `,
  url: emoji.url
})

const systemItem = (emoji: SystemEmoji): PickerItem => ({
  kind: 'system',
  key: `s:${emoji.char}`,
  name: emoji.name,
  label: 'emoji',
  insert: emoji.char,
  char: emoji.char
})

const ItemGlyph: FC<{ item: PickerItem; size?: number }> = ({
  item,
  size = 26
}) =>
  item.kind === 'custom' ? (
    <img
      src={item.url}
      alt={item.label}
      className="object-contain"
      style={{ width: size, height: size }}
    />
  ) : (
    <span style={{ fontSize: Math.round(size * 0.92), lineHeight: 1 }}>
      {item.char}
    </span>
  )

interface Props {
  customEmojis: CustomEmoji[]
  onSelect: (insertText: string) => void
  disabled?: boolean
}

export const EmojiPickerButton: FC<Props> = ({
  customEmojis,
  onSelect,
  disabled
}) => {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [hover, setHover] = useState<PickerItem | null>(null)

  const hasCustom = customEmojis.length > 0
  const tabs = useMemo(
    () => [
      ...(hasCustom
        ? [
            {
              id: 'custom',
              name: 'Custom',
              kind: 'icon' as const,
              icon: Sticker
            }
          ]
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
  const [tab, setTab] = useState(hasCustom ? 'custom' : EMOJI_GROUPS[0].id)

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const items = useMemo<PickerItem[]>(() => {
    const trimmed = query.trim().toLowerCase()
    if (trimmed) {
      const customMatches = customEmojis
        .filter((emoji) => emoji.shortcode.toLowerCase().includes(trimmed))
        .map(customItem)
      const systemMatches = searchSystemEmojis(trimmed).map(systemItem)
      return [...customMatches, ...systemMatches]
    }
    if (tab === 'custom') return customEmojis.map(customItem)
    const group = EMOJI_GROUPS.find((candidate) => candidate.id === tab)
    return group ? group.emojis.map(systemItem) : []
  }, [query, tab, customEmojis])

  const preview = hover ?? items[0] ?? null

  const pick = (item: PickerItem) => {
    onSelect(item.insert)
    setOpen(false)
    setQuery('')
  }

  return (
    <div className="relative inline-block">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={disabled}
        aria-label="Add emoji or sticker"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Add emoji or sticker"
        className={cn(
          open
            ? 'bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary'
            : 'text-muted-foreground hover:text-foreground'
        )}
        onClick={() => setOpen((value) => !value)}
      >
        <Smile className="size-4" />
      </Button>

      {open ? (
        <>
          <div
            className="fixed inset-0 z-40"
            aria-hidden
            onClick={() => setOpen(false)}
          />
          <div
            role="dialog"
            aria-label="Emoji and sticker picker"
            className="absolute left-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-xl border bg-background shadow-lg"
          >
            <div className="border-b p-2.5">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  autoFocus
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search emoji & stickers"
                  aria-label="Search emoji and stickers"
                  className="h-9 pl-8"
                />
              </div>
            </div>

            {!query.trim() ? (
              <div className="no-scrollbar flex items-center gap-0.5 overflow-x-auto px-2 pt-1.5">
                {tabs.map((entry) => {
                  const active = entry.id === tab
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      onClick={() => setTab(entry.id)}
                      title={entry.name}
                      aria-label={entry.name}
                      aria-pressed={active}
                      className={cn(
                        'inline-flex size-8 shrink-0 items-center justify-center rounded-md transition-colors',
                        active
                          ? 'bg-primary/10 text-primary'
                          : 'text-muted-foreground hover:bg-muted'
                      )}
                    >
                      {entry.kind === 'icon' ? (
                        <entry.icon className="size-4" />
                      ) : (
                        <span style={{ fontSize: 18, lineHeight: 1 }}>
                          {entry.glyph}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            ) : null}

            <div className="max-h-[220px] overflow-y-auto px-2 py-2">
              {items.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  {query.trim()
                    ? `Nothing matches “${query.trim()}”`
                    : tab === 'custom'
                      ? 'No custom emoji on this instance yet.'
                      : 'Nothing here yet'}
                </p>
              ) : (
                <div className="grid grid-cols-7 gap-1">
                  {items.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onMouseEnter={() => setHover(item)}
                      onFocus={() => setHover(item)}
                      onClick={() => pick(item)}
                      title={item.kind === 'custom' ? item.label : item.name}
                      aria-label={
                        item.kind === 'custom'
                          ? `Insert ${item.label}`
                          : `Insert ${item.name}`
                      }
                      className="inline-flex aspect-square w-full items-center justify-center rounded-md transition-colors hover:bg-muted"
                    >
                      <ItemGlyph item={item} />
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex h-11 items-center gap-2 border-t px-3">
              {preview ? (
                <>
                  <ItemGlyph item={preview} size={22} />
                  <span className="truncate text-sm font-medium">
                    {preview.name}
                  </span>
                  <span className="ml-auto font-mono text-xs text-muted-foreground">
                    {preview.label}
                  </span>
                </>
              ) : (
                <span className="text-xs text-muted-foreground">
                  Pick an emoji or sticker
                </span>
              )}
            </div>
          </div>
        </>
      ) : null}
    </div>
  )
}
