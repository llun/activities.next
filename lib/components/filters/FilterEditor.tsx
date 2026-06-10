'use client'

import { ArrowLeft, Plus, X } from 'lucide-react'
import { FC, type KeyboardEvent, useRef, useState } from 'react'

import type {
  ClientFilter,
  FilterInput,
  FilterKeywordInput
} from '@/lib/client'
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
import { FilterField, FilterSection } from './filterUi'

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
  const [action, setAction] = useState<FilterAction>(
    initial?.filter_action ?? 'warn'
  )
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

  const removeKeyword = (key: string) =>
    setKeywords((current) => {
      const target = current.find((keyword) => keyword.key === key)
      if (target?.id)
        setRemovedKeywordIds((ids) => [...ids, target.id as string])
      return current.filter((keyword) => keyword.key !== key)
    })

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
        <Button variant="outline" size="sm" onClick={onCancel}>
          <ArrowLeft className="size-3.5" />
          Back
        </Button>
        <h1 className="text-xl font-semibold tracking-tight">
          {isNew ? 'Add new filter' : `Edit “${initial?.title}”`}
        </h1>
      </div>

      <FilterSection
        title="Filter"
        description="Name this filter and choose how long it stays active."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <FilterField
            label="Title"
            htmlFor="filterTitle"
            help="Shown in place of hidden posts, e.g. “Filtered: Spoilers”."
          >
            <Input
              id="filterTitle"
              value={title}
              placeholder="e.g. Spoilers"
              onChange={(event) => setTitle(event.target.value)}
            />
          </FilterField>
          <FilterField
            label="Expire after"
            htmlFor="filterExpiry"
            help="Expired filters stop applying but are kept so you can reactivate them."
          >
            <Select
              id="filterExpiry"
              value={expiryValue}
              onChange={(event) => setExpiryValue(event.target.value)}
            >
              {EXPIRY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </FilterField>
        </div>
      </FilterSection>

      <FilterSection
        title="Filter contexts"
        description="Choose where this filter applies."
      >
        <div className="space-y-1">
          {FILTER_CONTEXTS.map((option) => (
            <label
              key={option.id}
              className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-[hsl(0_0%_97%)]"
            >
              <Checkbox
                className="size-[18px]"
                checked={context.includes(option.id)}
                onChange={() => toggleContext(option.id)}
              />
              <div className="min-w-0">
                <div className="text-sm font-medium">{option.label}</div>
                <div className="text-xs text-muted-foreground">
                  {option.hint}
                </div>
              </div>
            </label>
          ))}
        </div>
      </FilterSection>

      <FilterSection
        title="Filter action"
        description="What happens when a post matches."
      >
        <div
          className="grid gap-3 sm:grid-cols-2"
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
                  'rounded-xl border p-3 text-left transition-colors',
                  selected
                    ? 'border-primary bg-[hsl(24_95%_46%/0.04)] shadow-[0_0_0_3px_hsl(24_95%_46%/0.25)]'
                    : 'bg-background'
                )}
              >
                <div className="text-sm font-medium">{card.label}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {card.hint(scope)}
                </div>
              </button>
            )
          })}
        </div>
        {action === 'warn' && (
          <div className="rounded-lg border border-dashed p-3">
            <div className="text-[11px] font-medium uppercase tracking-wide text-[hsl(0_0%_55%)]">
              Preview
            </div>
            <div className="mt-2 flex items-center justify-between gap-3 rounded-lg bg-muted px-3 py-2.5">
              <span className="text-sm text-muted-foreground">
                Filtered: {title.trim() || 'Untitled filter'}
              </span>
              <span className="text-sm font-medium text-primary">
                Show anyway
              </span>
            </div>
          </div>
        )}
      </FilterSection>

      <FilterSection
        title="Keywords"
        description="Matched against post text, content warnings, media descriptions, and poll options."
        footer={
          <div className="flex w-full items-center justify-between gap-3">
            <Button variant="outline" size="sm" onClick={addKeyword}>
              <Plus className="size-3.5" />
              Add keyword
            </Button>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={onCancel} disabled={saving}>
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                // A filter with no non-empty keywords matches nothing, so block
                // saving until at least one keyword has text.
                disabled={saving || !hasKeyword}
              >
                {isNew ? 'Create filter' : 'Save changes'}
              </Button>
            </div>
          </div>
        }
      >
        {keywords.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            No keywords yet — add at least one.
          </p>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-3 px-1 text-[11px] font-medium uppercase tracking-wide text-[hsl(0_0%_55%)]">
              <span className="min-w-0 flex-1">Keyword or phrase</span>
              <span className="w-24 text-center">Whole word</span>
              <span className="w-8" />
            </div>
            {keywords.map((keyword) => (
              <div key={keyword.key} className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <Input
                    value={keyword.keyword}
                    placeholder="e.g. spoiler"
                    onChange={(event) =>
                      patchKeyword(keyword.key, { keyword: event.target.value })
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
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-muted"
                >
                  <X className="size-[15px]" />
                </button>
              </div>
            ))}
            <p className="text-[0.8rem] text-muted-foreground">
              Whole word only matches when the keyword is surrounded by spaces
              or punctuation — off, it matches anywhere, even inside other
              words.
            </p>
          </div>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </FilterSection>
    </div>
  )
}
