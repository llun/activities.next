'use client'

import { AlertTriangle, Check, Hash, Plus, X } from 'lucide-react'
import { FC, useEffect, useRef, useState } from 'react'

import {
  addFeaturedTag,
  getFeaturedTagSuggestions,
  getFeaturedTags,
  removeFeaturedTag
} from '@/lib/client'
import { PageHeader } from '@/lib/components/page-header'
import { Button } from '@/lib/components/ui/button'
import { Input } from '@/lib/components/ui/input'
import type { FeaturedTag } from '@/lib/types/mastodon/featuredTag'
import type { Tag } from '@/lib/types/mastodon/tag'
import { cn } from '@/lib/utils'
import { isRenderableHashtagName } from '@/lib/utils/text/isRenderableHashtagName'

// Mastodon caps featured tags per account at FeaturedTag::LIMIT = 10.
const FEATURED_TAGS_LIMIT = 10
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec'
]

type InlineMessage = { tone: 'success' | 'error'; text: string }

const postsLabel = (count: string): string => {
  const value = Number(count) || 0
  return value === 1 ? '1 post' : `${value} posts`
}

// last_status_at is a UTC `YYYY-MM-DD` string (or null). Parse the parts by hand
// rather than `new Date(str)` so the rendered day never shifts with the viewer's
// timezone (and so render stays deterministic — no `Date.now()`).
const lastPostLabel = (dateStr: string | null): string => {
  if (!dateStr) return 'no posts yet'
  const [year, month, day] = dateStr.split('-').map(Number)
  if (!year || !month || !day) return 'no posts yet'
  return `last posted on ${MONTHS[month - 1]} ${day}, ${year}`
}

const normalizeName = (raw: string): string =>
  raw.trim().replace(/^#+/, '').toLowerCase()

interface SectionProps {
  title: string
  description: string
  children: React.ReactNode
}

const Section: FC<SectionProps> = ({ title, description, children }) => (
  <section className="space-y-4 rounded-2xl border bg-background/80 p-6 shadow-sm">
    <div>
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
    {children}
  </section>
)

const HashTile: FC = () => (
  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
    <Hash className="size-[18px]" />
  </span>
)

const LoadingSkeleton: FC = () => (
  <div className="space-y-2">
    {[0, 1, 2].map((index) => (
      <div
        key={index}
        className="flex items-center gap-3 rounded-lg border p-3"
      >
        <span className="h-9 w-9 shrink-0 animate-pulse rounded-lg bg-muted" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="h-3.5 w-28 animate-pulse rounded bg-muted" />
          <div className="h-3 w-44 animate-pulse rounded bg-muted" />
        </div>
        <span className="h-8 w-8 shrink-0 animate-pulse rounded-md bg-muted" />
      </div>
    ))}
  </div>
)

const InlineMessageLine: FC<{ message: InlineMessage | null }> = ({
  message
}) => {
  const isSuccess = message?.tone === 'success'
  const Icon = isSuccess ? Check : AlertTriangle
  // Keep the live region mounted at all times and only swap its contents, so a
  // screen reader reliably announces each new message. Errors use `alert`
  // (assertive); successes use `status` (polite).
  return (
    <div
      aria-live={isSuccess ? 'polite' : 'assertive'}
      role={isSuccess ? 'status' : 'alert'}
    >
      {message && (
        <div
          className={cn(
            'flex items-start gap-2 text-sm',
            isSuccess ? 'text-green-600' : 'text-destructive'
          )}
        >
          <Icon className="mt-0.5 size-4 shrink-0" />
          <span>{message.text}</span>
        </div>
      )}
    </div>
  )
}

interface TagRowProps {
  tag: FeaturedTag
  onRemove: (tag: FeaturedTag) => void
  busy: boolean
}

const TagRow: FC<TagRowProps> = ({ tag, onRemove, busy }) => (
  <div className="flex items-center gap-3 rounded-lg border p-3">
    <HashTile />
    <div className="min-w-0 flex-1">
      <div className="truncate text-sm font-medium">#{tag.name}</div>
      <div className="truncate text-xs text-muted-foreground">
        {postsLabel(tag.statuses_count)} · {lastPostLabel(tag.last_status_at)}
      </div>
    </div>
    <Button
      type="button"
      variant="outline"
      size="icon-sm"
      aria-label={`Remove #${tag.name}`}
      onClick={() => onRemove(tag)}
      disabled={busy}
      className="shrink-0 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
    >
      <X className="size-[15px]" />
    </Button>
  </div>
)

export const FeaturedTagsEditor: FC = () => {
  const [loading, setLoading] = useState(true)
  const [tags, setTags] = useState<FeaturedTag[]>([])
  const [suggestions, setSuggestions] = useState<Tag[]>([])
  const [value, setValue] = useState('')
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState<InlineMessage | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let active = true
    Promise.all([getFeaturedTags(), getFeaturedTagSuggestions()])
      .then(([loadedTags, loadedSuggestions]) => {
        if (!active) return
        setTags(loadedTags)
        setSuggestions(loadedSuggestions)
      })
      .catch(() => {
        // Flag the failure so the list shows a load error instead of the
        // "no featured hashtags yet" empty state, which would otherwise be
        // misleading.
        if (active) setLoadFailed(true)
      })
      .finally(() => {
        // Always clear the skeleton — otherwise a rejected request (network
        // error, or a thrown response parse) would leave the editor stuck
        // loading forever.
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  // Close the suggestions dropdown on an outside click.
  useEffect(() => {
    const onDocumentMouseDown = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocumentMouseDown)
    return () => document.removeEventListener('mousedown', onDocumentMouseDown)
  }, [])

  const atLimit = tags.length >= FEATURED_TAGS_LIMIT
  const featuredNames = new Set(tags.map((tag) => tag.name.toLowerCase()))
  const query = normalizeName(value)
  const visibleSuggestions = suggestions
    .filter((suggestion) => !featuredNames.has(suggestion.name.toLowerCase()))
    .filter((suggestion) => suggestion.name.toLowerCase().includes(query))
    .slice(0, 6)

  const commit = async (raw: string) => {
    // Guard against concurrent submits (e.g. clicking a suggestion while a POST
    // is already in flight), which could append a duplicate row / duplicate key.
    if (submitting) return
    const name = raw.trim().replace(/^#+/, '')
    if (!name) return
    if (!isRenderableHashtagName(name)) {
      setMessage({
        tone: 'error',
        text: 'Use letters, numbers, and underscores, and include at least one letter.'
      })
      return
    }
    if (featuredNames.has(name.toLowerCase())) {
      setMessage({ tone: 'error', text: `#${name} is already featured.` })
      return
    }
    if (atLimit) {
      setMessage({
        tone: 'error',
        text: 'Limit reached. You can feature up to 10 hashtags.'
      })
      return
    }

    setSubmitting(true)
    const result = await addFeaturedTag(name)
    setSubmitting(false)
    if (result.error || !result.tag) {
      setMessage({
        tone: 'error',
        text: result.error ?? 'Failed to feature hashtag.'
      })
      return
    }

    const created = result.tag
    setTags((current) => [...current, created])
    setSuggestions((current) =>
      current.filter(
        (suggestion) =>
          suggestion.name.toLowerCase() !== created.name.toLowerCase()
      )
    )
    setValue('')
    setOpen(false)
    setMessage({
      tone: 'success',
      text: `#${created.name} is now featured on your profile.`
    })
  }

  const remove = async (tag: FeaturedTag) => {
    setBusyId(tag.id)
    const removed = await removeFeaturedTag(tag.id)
    setBusyId(null)
    if (!removed) {
      setMessage({
        tone: 'error',
        text: `Couldn’t remove #${tag.name}. Please try again.`
      })
      return
    }
    setTags((current) => current.filter((item) => item.id !== tag.id))
    setMessage({
      tone: 'success',
      text: `#${tag.name} is no longer featured.`
    })
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Featured hashtags"
        description="Feature up to 10 hashtags on your profile so visitors can browse your posts on the topics you post about most."
      />

      <Section
        title="Add a hashtag"
        description="Type a hashtag or pick one of your most-used tags. People can tap it to see all of your posts with that tag."
      >
        <div ref={wrapRef} className="relative">
          <div className="flex items-stretch gap-2">
            <div className="relative flex-1">
              <Hash className="pointer-events-none absolute left-3 top-1/2 size-[15px] -translate-y-1/2 text-muted-foreground" />
              <Input
                value={value}
                disabled={atLimit || submitting}
                placeholder={
                  atLimit
                    ? 'You’ve reached the 10-hashtag limit'
                    : 'Add a hashtag'
                }
                aria-label="Add a hashtag"
                className="pl-8"
                onChange={(event) => {
                  setValue(event.target.value)
                  setOpen(true)
                  if (message) setMessage(null)
                }}
                onFocus={() => setOpen(true)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    commit(value)
                  }
                  if (event.key === 'Escape') setOpen(false)
                }}
              />
            </div>
            <Button
              type="button"
              onClick={() => commit(value)}
              disabled={atLimit || submitting}
            >
              <Plus className="size-4" />
              Add
            </Button>
          </div>

          {open && !atLimit && visibleSuggestions.length > 0 && (
            <div className="absolute left-0 right-0 top-[42px] z-40 rounded-xl border bg-popover p-1 shadow-lg">
              <div className="px-2.5 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Your most-used hashtags
              </div>
              {visibleSuggestions.map((suggestion) => (
                <button
                  key={suggestion.name}
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault()
                    commit(suggestion.name)
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent"
                >
                  <Hash className="size-[15px] text-primary" />
                  <span className="font-medium">#{suggestion.name}</span>
                  <Plus className="ml-auto size-[15px] text-muted-foreground" />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 pt-0.5">
          <InlineMessageLine message={message} />
          <span
            className={cn(
              'ml-auto shrink-0 text-xs tabular-nums',
              atLimit ? 'font-medium text-primary' : 'text-muted-foreground'
            )}
          >
            {tags.length} of {FEATURED_TAGS_LIMIT} featured
          </span>
        </div>
        {atLimit && (
          <p className="text-[0.8rem] text-muted-foreground">
            You can feature up to 10 hashtags. Remove one to add another.
          </p>
        )}
      </Section>

      <Section
        title="Your featured hashtags"
        description="Shown on your profile in the order below. They link to your posts tagged with each hashtag."
      >
        {loading ? (
          <LoadingSkeleton />
        ) : loadFailed ? (
          <p role="alert" className="py-8 text-center text-sm text-destructive">
            Couldn’t load your featured hashtags. Please refresh to try again.
          </p>
        ) : tags.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Hash className="size-5" />
            </span>
            <p className="text-sm font-medium">No featured hashtags yet</p>
            <p className="max-w-xs text-[0.8rem] text-muted-foreground">
              Add a hashtag above to show your best posts on a topic right from
              your profile.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {tags.map((tag) => (
              <TagRow
                key={tag.id}
                tag={tag}
                onRemove={remove}
                busy={busyId === tag.id}
              />
            ))}
          </div>
        )}
      </Section>
    </div>
  )
}
