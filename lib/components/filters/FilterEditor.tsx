'use client'

import { Plus, X } from 'lucide-react'
import { FC, useRef, useState } from 'react'

import type {
  ClientFilter,
  FilterInput,
  FilterKeywordInput
} from '@/lib/client'
import { BackLink } from '@/lib/components/back-link'
import { PageHeader } from '@/lib/components/page-header'
import { FormGroup } from '@/lib/components/surface/FormGroup'
import { FormRow } from '@/lib/components/surface/FormRow'
import { Frame } from '@/lib/components/surface/Frame'
import { RadioCard } from '@/lib/components/surface/RadioCard'
import { SaveBar } from '@/lib/components/surface/SaveBar'
import { TABLE_HEAD_ROW_CLASS } from '@/lib/components/surface/TableFrame'
import { Button } from '@/lib/components/ui/button'
import { Input } from '@/lib/components/ui/input'
import { RadioGroup } from '@/lib/components/ui/radio-group'
import { Select } from '@/lib/components/ui/select'
import { Switch } from '@/lib/components/ui/switch'
import type { FilterAction, FilterContext } from '@/lib/types/domain/filter'
import { cn } from '@/lib/utils'

import {
  EXPIRY_OPTIONS,
  FILTER_ACTION_LABELS,
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
    label: FILTER_ACTION_LABELS.warn,
    hint: () =>
      'Matching posts collapse behind the filter title, with a “Show anyway” option.'
  },
  {
    id: 'hide',
    label: FILTER_ACTION_LABELS.hide,
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
      {/* Below md the Back is its own "Back" row above the heading; from md
          up it is the icon beside the heading, as on the other sub-pages. The
          Settings or Admin layout owns the page's h1, so the title is the
          section-mode h2. */}
      <div className="flex items-start gap-3 max-md:flex-col max-md:gap-1">
        <BackLink
          href={scope === 'server' ? '/admin/filters' : '/settings/filters'}
          accessibleName="Back to filters"
          iconOnlyFrom="md"
          className="md:rounded-lg md:p-2 md:hover:bg-muted"
          disabled={saving}
          onClick={() => {
            if (!saving) onCancel()
          }}
        />
        <PageHeader
          className="flex-1"
          title={isNew ? 'Add filter' : `Edit “${initial?.title}”`}
        />
      </div>

      <Frame
        form
        stickyFooter
        footer={
          <SaveBar
            // A filter with no non-empty keywords matches nothing, so block
            // saving until at least one keyword has text, and say so rather
            // than claim there is nothing to save.
            dirty={dirty}
            disabledReason={hasKeyword ? undefined : 'Add a keyword to save'}
            saving={saving}
            saved={false}
            error={error}
            onSave={handleSave}
          />
        }
      >
        <FormGroup
          title="Filter"
          description="Name this filter and choose how long it stays active."
        >
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
        </FormGroup>

        <FormGroup
          title="Filter contexts"
          description="Choose where this filter applies."
        >
          {FILTER_CONTEXTS.map((option) => (
            <FormRow
              key={option.id}
              label={option.label}
              htmlFor={`filterContext-${option.id}`}
              hint={option.hint}
              inline
            >
              {({ describedBy }) => (
                <Switch
                  id={`filterContext-${option.id}`}
                  aria-describedby={describedBy}
                  checked={context.includes(option.id)}
                  onCheckedChange={() => toggleContext(option.id)}
                />
              )}
            </FormRow>
          ))}
        </FormGroup>

        <FormGroup
          title="Filter action"
          headingId="filter-action-heading"
          description="What happens when a post matches."
        >
          <RadioGroup
            aria-labelledby="filter-action-heading"
            value={action}
            onValueChange={(value) => setAction(value as FilterAction)}
            className="gap-2 px-4 pt-2"
          >
            {ACTION_CARDS.map((card) => (
              <RadioCard
                key={card.id}
                id={`filter-action-${card.id}`}
                value={card.id}
                title={card.label}
                hint={card.hint(scope)}
              />
            ))}
          </RadioGroup>
          {action === 'warn' && (
            // The bare bar a warned post collapses to, as the Filter management
            // board draws it: no dashed frame, no caption.
            <div className="px-4 pt-1.5 pb-1">
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
        </FormGroup>

        <FormGroup
          title="Keywords"
          description="Matched against post text, content warnings, media descriptions, and poll options."
        >
          {keywords.length === 0 ? (
            <p className="text-muted-foreground px-4 py-4 text-sm">
              No keywords yet — add at least one.
            </p>
          ) : (
            <div className="mx-4 mt-2 mb-1 overflow-hidden rounded-md border">
              <div
                className={cn(
                  TABLE_HEAD_ROW_CLASS,
                  'flex items-center gap-3 px-4 py-2.5 font-medium'
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
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove keyword ${keyword.keyword}`}
                      onClick={() => removeKeyword(keyword.key)}
                      className="shrink-0 text-muted-foreground"
                    >
                      <X />
                    </Button>
                  </div>
                ))}
              </div>
              <p className="text-muted-foreground border-t px-4 py-3 text-xs">
                Whole word only matches when the keyword is surrounded by spaces
                or punctuation — off, it matches anywhere, even inside other
                words.
              </p>
            </div>
          )}
          <div className="px-4 py-2.5">
            <Button variant="outline" size="sm" onClick={addKeyword}>
              <Plus className="size-3.5" />
              Add keyword
            </Button>
          </div>
        </FormGroup>
      </Frame>
    </div>
  )
}
