'use client'

import { AlertTriangle, Check, Hash, Plus, X } from 'lucide-react'
import { FC, useCallback, useEffect, useRef, useState } from 'react'

import {
  addFeaturedTag,
  getFeaturedTagSuggestions,
  getFeaturedTags,
  removeFeaturedTag
} from '@/lib/client'
import { AddBar } from '@/lib/components/surface/AddBar'
import { Alert } from '@/lib/components/surface/Alert'
import { EmptyState } from '@/lib/components/surface/EmptyState'
import { Frame } from '@/lib/components/surface/Frame'
import { FramedList, FramedListItem } from '@/lib/components/surface/FramedList'
import { Section } from '@/lib/components/surface/Section'
import { SkeletonRows } from '@/lib/components/surface/Skeleton'
import { Button } from '@/lib/components/ui/button'
import type { FeaturedTag } from '@/lib/types/mastodon/featuredTag'
import type { Tag } from '@/lib/types/mastodon/tag'
import { cn } from '@/lib/utils'
import { isRenderableHashtagName } from '@/lib/utils/text/isRenderableHashtagName'
import { MAX_HASHTAG_NAME_LENGTH } from '@/lib/utils/text/mastodonHashtag'

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

const HashTile: FC = () => (
  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
    <Hash className="size-[18px]" />
  </span>
)

const INLINE_MESSAGE_ID = 'featured-tag-message'

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
      id={INLINE_MESSAGE_ID}
      aria-live={isSuccess ? 'polite' : 'assertive'}
      role={isSuccess ? 'status' : 'alert'}
    >
      {message && (
        <div
          className={cn(
            'mt-3 flex items-start gap-2 text-sm',
            isSuccess ? 'text-success-text' : 'text-destructive-text'
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
  <FramedListItem className="flex items-center gap-3">
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
      className="shrink-0 border-destructive/40 text-destructive-text hover:bg-destructive/10 hover:text-destructive-text"
    >
      <X className="size-[15px]" />
    </Button>
  </FramedListItem>
)

/**
 * The Edit profile page's one "Featured hashtags" section
 * (`id="featured-hashtags"`, so `/settings/profile#featured-hashtags` lands on
 * it) with the add bar over the list. Adding and removing a tag saves at once;
 * it never waits for the page's Save. Each save names the profile the page
 * was loaded for; when the session has moved to another one the server
 * refuses it (409) and `onActorChanged` lets the page say so.
 */
export const FeaturedTagsSection: FC<{
  /** The profile this page was loaded for; the server refuses other ones. */
  actorId: string
  /** The session is on another profile now: nothing was saved. */
  onActorChanged: () => void
}> = ({ actorId, onActorChanged }) => {
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
  const inputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(() => {
    let active = true
    setLoading(true)
    setLoadFailed(false)
    // Featured tags are the critical data — a failure rejects and shows the
    // load error. Suggestions are an optional enhancement, so swallow their
    // failure (network/parse/HTTP) here; it must never discard loaded tags.
    Promise.all([
      getFeaturedTags(),
      getFeaturedTagSuggestions().catch(() => [] as Tag[])
    ])
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

  useEffect(() => load(), [load])

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
    if (name.length > MAX_HASHTAG_NAME_LENGTH) {
      setMessage({
        tone: 'error',
        text: `Hashtags can be up to ${MAX_HASHTAG_NAME_LENGTH} characters.`
      })
      return
    }
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
    const result = await addFeaturedTag(name, actorId)
    setSubmitting(false)
    if (result.actorChanged) {
      onActorChanged()
      return
    }
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
    const { removed, actorChanged } = await removeFeaturedTag(tag.id, actorId)
    setBusyId(null)
    if (actorChanged) {
      onActorChanged()
      return
    }
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

  const countMeta = (
    <span
      className={cn('tabular-nums', atLimit && 'text-primary-text font-medium')}
    >
      {tags.length} of {FEATURED_TAGS_LIMIT} featured
    </span>
  )

  const addBar = (
    <div ref={wrapRef}>
      <AddBar
        label="Add a hashtag"
        id="featured-tag-input"
        prefix={<Hash className="size-[15px]" />}
        buttonDisabled={atLimit || submitting}
        inputRef={inputRef}
        onSubmit={(event) => {
          event.preventDefault()
          commit(value)
        }}
        inputProps={{
          value,
          disabled: atLimit || submitting,
          placeholder: atLimit
            ? 'You’ve reached the 10-hashtag limit'
            : 'Add a hashtag',
          'aria-describedby': message ? INLINE_MESSAGE_ID : undefined,
          onChange: (event) => {
            setValue(event.target.value)
            setOpen(true)
            if (message) setMessage(null)
          },
          onFocus: () => setOpen(true),
          onKeyDown: (event) => {
            if (event.key === 'Escape') setOpen(false)
          }
        }}
        dropdown={
          open && !atLimit && visibleSuggestions.length > 0 ? (
            <div className="absolute top-full right-0 left-0 z-40 mt-1 rounded-md border bg-popover p-1 shadow-lg">
              <div className="px-2.5 pb-1 pt-1.5 text-xs font-medium text-muted-foreground">
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
                  className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent"
                >
                  <Hash className="size-[15px] text-primary" />
                  <span className="font-medium">#{suggestion.name}</span>
                  <Plus className="ml-auto size-[15px] text-muted-foreground" />
                </button>
              ))}
            </div>
          ) : null
        }
      >
        <InlineMessageLine message={message} />
        {atLimit && (
          <p className="mt-3 text-xs text-muted-foreground">
            You can feature up to 10 hashtags. Remove one to add another.
          </p>
        )}
      </AddBar>
    </div>
  )

  const list = (
    <>
      {loading ? (
        <Frame className="p-4">
          <SkeletonRows
            rows={3}
            rowClassName="h-14"
            label="Loading your featured hashtags"
          />
        </Frame>
      ) : loadFailed ? (
        <Alert title="Couldn’t load your featured hashtags" onRetry={load}>
          Check your connection and try again.
        </Alert>
      ) : tags.length === 0 ? (
        <EmptyState
          icon={Hash}
          title="No featured hashtags yet"
          action={
            <Button
              type="button"
              size="sm"
              onClick={() => inputRef.current?.focus()}
            >
              <Plus className="size-4" />
              Add hashtag
            </Button>
          }
        >
          Add a hashtag above to show your best posts on a topic right from your
          profile.
        </EmptyState>
      ) : (
        <FramedList aria-label="Your featured hashtags">
          {tags.map((tag) => (
            <TagRow
              key={tag.id}
              tag={tag}
              onRemove={remove}
              busy={busyId === tag.id}
            />
          ))}
        </FramedList>
      )}
    </>
  )

  return (
    <Section
      id="featured-hashtags"
      title="Featured hashtags"
      description="Tags you post about most, shown under your bio. Adding or removing one saves at once."
      meta={countMeta}
      className="scroll-mt-24"
    >
      <div className="space-y-3">
        {addBar}
        {list}
      </div>
    </Section>
  )
}
