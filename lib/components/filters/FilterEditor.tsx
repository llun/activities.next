'use client'

import { ArrowLeft, Plus, X } from 'lucide-react'
import { FC, type KeyboardEvent, useRef, useState } from 'react'

import type {
  ClientFilter,
  FilterInput,
  FilterKeywordInput
} from '@/lib/client'
import { FormRow } from '@/lib/components/surface/FormRow'
import { Frame } from '@/lib/components/surface/Frame'
import { SaveBar } from '@/lib/components/surface/SaveBar'
import { Section } from '@/lib/components/surface/Section'
import { TABLE_HEAD_ROW_CLASS } from '@/lib/components/surface/TableFrame'
import { Button } from '@/lib/components/ui/button'
import { Checkbox } from '@/lib/components/ui/checkbox'
import { Input } from '@/lib/components/ui/input'
import { Select } from '@/lib/components/ui/select'
import { Switch } from '@/lib/components/ui/switch'
import type { FilterAction, FilterContext } from '@/lib/types/domain/filter'
import { cn } from '@/lib/utils'

import {
  EXPIRY_OPTIONS,
  FILTER_CONTEXTS,
  expiresInFromValue,
  expiryOptionForExpiresAt
} from './filterConstants'

// Editor row for a single keyword. `id` is set only for keywords that already
// exist server-side (so we can target them for update/delete); `key` is a
// stable React key for both existing and freshly-added rows.
interface KeywordDraft {
  key: string
  id?: string
  keyword: string
  wholeWord: boolean
}

const ACTION_CARDS: {
  id: FilterAction
  label: string
  hint: (scope: FilterScope) => string
}[] = [
  {
    id: 'warn',
    label: 'Hide with a warning',
    hint: () =>
      'Matching posts collapse behind the filter title, with a “Show anyway” option.'
  },
  {
    id: 'hide',
    label: 'Hide completely',
    hint: (scope) =>
      scope === 'server'
        ? 'Matching posts are dropped server-side and never delivered.'
        : 'Matching posts are dropped server-side and never reach your feeds or notifications.'
  }
]

export type FilterScope = 'account' | 'server'

interface FilterEditorProps {
  initial: ClientFilter | null
  scope: FilterScope
  currentTime: number
  saving: boolean
  error: string | null
  onCancel: () => void
  onSave: (input: FilterInput) => void
}

export const FilterEditor: FC<FilterEditorProps> = ({
  initial,
  scope,
  currentTime,
  saving,
  error,
  onCancel,
  onSave
}) => {
  const isNew = !initial
  const keywordCounter = useRef(0)
  const nextKey = () => `new-${keywordCounter.current++}`
  // Refs to the action radio cards for roving-focus arrow-key navigation.
  const actionRefs = useRef<(HTMLButtonElement | null)[]>([])

  const handleActionKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number
  ) => {
    const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown'
    const backward = event.key === 'ArrowLeft' || event.key === 'ArrowUp'
    if (!forward && !backward) return
    event.preventDefault()
    const delta = forward ? 1 : -1
    const nextIndex =
      (index + delta + ACTION_CARDS.length) % ACTION_CARDS.length
    setAction(ACTION_CARDS[nextIndex].id)
    actionRefs.current[nextIndex]?.focus()
  }

  const [title, setTitle] = useState(initial?.title ?? '')
  const [context, setContext] = useState<FilterContext[]>(
    initial ? [...initial.context] : ['home']
  )
  // The editor only offers warn/hide cards; a filter saved with another
  // action (e.g. 'blur' created via the API) opens as 'warn' rather than
  // rendering with no selected card.
  const [action, setAction] = useState<FilterAction>(() => {
    const initialAction = initial?.filter_action ?? 'warn'
    return ACTION_CARDS.some((card) => card.id === initialAction)
      ? initialAction
      : 'warn'
  })
  const [expiryValue, setExpiryValue] = useState(() =>
    expiryOptionForExpiresAt(
      initial?.expires_at ? Date.parse(initial.expires_at) : null,
      currentTime
    )
  )
  const [keywords, setKeywords] = useState<KeywordDraft[]>(() =>
    initial
      ? initial.keywords.map((keyword) => ({
          key: keyword.id,
          id: keyword.id,
          keyword: keyword.keyword,
          wholeWord: keyword.whole_word
        }))
      : [{ key: nextKey(), keyword: '', wholeWord: true }]
  )
  // Existing keywords removed from the editor — sent as `_destroy` on save.
  const [removedKeywordIds, setRemovedKeywordIds] = useState<string[]>([])

  // A filter needs at least one non-empty keyword to match anything.
  const hasKeyword = keywords.some((k) => k.keyword.trim().length > 0)

  // Everything the user can edit, so Save knows whether there is anything to
  // save. A filter being created always has something to save.
  const snapshot = () =>
    JSON.stringify({
      title,
      context: [...context].sort(),
      action,
      expiryValue,
      keywords: keywords.map((k) => [k.id ?? null, k.keyword, k.wholeWord]),
      removedKeywordIds
    })
  const [initialSnapshot] = useState(snapshot)
  const dirty = isNew || snapshot() !== initialSnapshot

  const toggleContext = (id: FilterContext) =>
    setContext((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id]
    )

  const patchKeyword = (key: string, patch: Partial<KeywordDraft>) =>
    setKeywords((current) =>
      current.map((keyword) =>
        keyword.key === key ? { ...keyword, ...patch } : keyword
      )
    )

  const addKeyword = () =>
    setKeywords((current) => [
      ...current,
      { key: nextKey(), keyword: '', wholeWord: true }
    ])

  const removeKeyword = (key: string) => {
    // Keep both state updates in the event handler — a state updater must be
    // pure, so the `_destroy` bookkeeping can't live inside setKeywords.
    const target = keywords.find((keyword) => keyword.key === key)
    if (target?.id) {
      setRemovedKeywordIds((ids) => [...ids, target.id as string])
    }
    setKeywords((current) => current.filter((keyword) => keyword.key !== key))
  }

  const handleSave = () => {
    const keywordInputs: FilterKeywordInput[] = []
    for (const draft of keywords) {
      const trimmed = draft.keyword.trim()
      if (trimmed.length === 0) {
        // A cleared existing keyword is removed; a blank new row is dropped.
        if (draft.id)
          keywordInputs.push({
            id: draft.id,
            keyword: '',
            wholeWord: draft.wholeWord,
            _destroy: true
          })
        continue
      }
      keywordInputs.push({
        ...(draft.id ? { id: draft.id } : {}),
        keyword: trimmed,
        wholeWord: draft.wholeWord
      })
    }
    for (const id of removedKeywordIds) {
      keywordInputs.push({ id, keyword: '', wholeWord: false, _destroy: true })
    }

    onSave({
      title: title.trim() || 'Untitled filter',
      context: context.length ? context : ['home'],
      filterAction: action,
      expiresIn: expiresInFromValue(expiryValue),
      keywords: keywordInputs
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          onClick={onCancel}
          disabled={saving}
        >
          <ArrowLeft className="size-3.5" />
          Back
        </Button>
        {/* The Settings or Admin layout owns the page's h1. */}
        <h2 className="text-xl font-semibold tracking-tight">
          {isNew ? 'Add filter' : `Edit “${initial?.title}”`}
        </h2>
      </div>

      <Section
        title="Filter"
        description="Name this filter and choose how long it stays active."
      >
        <Frame divided>
          <FormRow
            label="Title"
            htmlFor="filterTitle"
            hint="Shown in place of hidden posts, e.g. “Filtered: Spoilers”."
          >
            {({ describedBy }) => (
              <Input
                id="filterTitle"
                aria-describedby={describedBy}
                value={title}
                placeholder="e.g. Spoilers"
                onChange={(event) => setTitle(event.target.value)}
              />
            )}
          </FormRow>
          <FormRow
            label="Expire after"
            htmlFor="filterExpiry"
            hint="Expired filters stop applying but are kept so you can reactivate them."
          >
            {({ describedBy }) => (
              <Select
                id="filterExpiry"
                aria-describedby={describedBy}
                value={expiryValue}
                onChange={(event) => setExpiryValue(event.target.value)}
              >
                {EXPIRY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            )}
          </FormRow>
        </Frame>
      </Section>

      <Section
        title="Filter contexts"
        description="Choose where this filter applies."
      >
        <Frame divided>
          {FILTER_CONTEXTS.map((option) => (
            <FormRow
              key={option.id}
              label={option.label}
              htmlFor={`filterContext-${option.id}`}
              hint={option.hint}
              inline
            >
              {({ describedBy }) => (
                <Checkbox
                  id={`filterContext-${option.id}`}
                  aria-describedby={describedBy}
                  className="size-[18px]"
                  checked={context.includes(option.id)}
                  onChange={() => toggleContext(option.id)}
                />
              )}
            </FormRow>
          ))}
        </Frame>
      </Section>

      <Section
        title="Filter action"
        description="What happens when a post matches."
      >
        <Frame>
          <div
            className="divide-y"
            role="radiogroup"
            aria-label="Filter action"
          >
            {ACTION_CARDS.map((card, index) => {
              const selected = action === card.id
              return (
                <button
                  key={card.id}
                  ref={(element) => {
                    actionRefs.current[index] = element
                  }}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => setAction(card.id)}
                  onKeyDown={(event) => handleActionKeyDown(event, index)}
                  className={cn(
                    'focus-visible:ring-ring/50 flex w-full items-start gap-3 px-4 py-3 text-left transition-colors outline-none first:rounded-t-lg last:rounded-b-lg focus-visible:ring-[3px] focus-visible:ring-inset',
                    selected ? 'bg-primary/5' : 'hover:bg-muted/50'
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border',
                      selected && 'border-primary'
                    )}
                  >
                    {selected ? (
                      <span className="bg-primary size-2 rounded-full" />
                    ) : null}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">
                      {card.label}
                    </span>
                    <span className="text-muted-foreground block text-xs">
                      {card.hint(scope)}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
          {action === 'warn' && (
            // The bare bar a warned post collapses to, as the Filter management
            // board draws it: no dashed frame, no caption.
            <div className="border-t px-4 py-3">
              <div className="bg-muted flex items-center justify-between gap-3 rounded-md px-3 py-2">
                <span className="text-muted-foreground text-sm">
                  Filtered: {title.trim() || 'Untitled filter'}
                </span>
                <span className="text-primary-text text-sm font-medium">
                  Show anyway
                </span>
              </div>
            </div>
          )}
        </Frame>
      </Section>

      <Section
        title="Keywords"
        description="Matched against post text, content warnings, media descriptions, and poll options."
      >
        <Frame
          footer={
            <Button variant="outline" size="sm" onClick={addKeyword}>
              <Plus className="size-3.5" />
              Add keyword
            </Button>
          }
        >
          {keywords.length === 0 ? (
            <p className="text-muted-foreground px-4 py-6 text-center text-sm">
              No keywords yet — add at least one.
            </p>
          ) : (
            <>
              <div
                className={cn(
                  TABLE_HEAD_ROW_CLASS,
                  'flex items-center gap-3 rounded-t-lg px-4 py-2.5 font-medium'
                )}
              >
                <span className="min-w-0 flex-1">Keyword or phrase</span>
                <span className="w-24 text-center">Whole word</span>
                <span className="w-8" />
              </div>
              <div className="divide-y">
                {keywords.map((keyword, index) => (
                  <div
                    key={keyword.key}
                    className="flex items-center gap-3 px-4 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <Input
                        value={keyword.keyword}
                        placeholder="e.g. spoiler"
                        aria-label={`Keyword or phrase ${index + 1}`}
                        onChange={(event) =>
                          patchKeyword(keyword.key, {
                            keyword: event.target.value
                          })
                        }
                      />
                    </div>
                    <div className="flex w-24 justify-center">
                      <Switch
                        checked={keyword.wholeWord}
                        onCheckedChange={(checked) =>
                          patchKeyword(keyword.key, { wholeWord: checked })
                        }
                        aria-label={`Whole word for ${keyword.keyword || 'keyword'}`}
                      />
                    </div>
                    <button
                      type="button"
                      aria-label={`Remove keyword ${keyword.keyword}`}
                      onClick={() => removeKeyword(keyword.key)}
                      className="text-muted-foreground hover:bg-muted inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border transition-colors"
                    >
                      <X className="size-[15px]" />
                    </button>
                  </div>
                ))}
              </div>
              <p className="text-muted-foreground border-t px-4 py-3 text-xs">
                Whole word only matches when the keyword is surrounded by spaces
                or punctuation — off, it matches anywhere, even inside other
                words.
              </p>
            </>
          )}
        </Frame>
      </Section>

      <Frame className="px-4 py-3">
        <SaveBar
          // A filter with no non-empty keywords matches nothing, so block
          // saving until at least one keyword has text.
          dirty={dirty && hasKeyword}
          saving={saving}
          saved={false}
          error={error}
          onSave={handleSave}
        />
      </Frame>
    </div>
  )
}
