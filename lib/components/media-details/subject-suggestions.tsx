'use client'

import { Check, Loader2, Search, Sparkles } from 'lucide-react'
import { FC } from 'react'

import type { SubjectSuggestionsEntity } from '@/lib/client'
import { Button } from '@/lib/components/ui/button'
import { cn } from '@/lib/utils'

import {
  MediaDetailsDraft,
  PickedSubject,
  isSubjectPicked
} from './mediaDetailsDraft'
import {
  candidateToPicked,
  getSubjectChoices,
  groupToPicked,
  toPercent
} from './subjectChoices'

interface Props {
  suggestions: SubjectSuggestionsEntity | null
  /** The author's confidence floor, in percent. */
  threshold: number
  draft: MediaDetailsDraft
  /** Whether the server can suggest at all (a model is set up and on). */
  canSuggest: boolean
  /** A suggestion request is running. */
  suggesting: boolean
  error: string | null
  /** Whether GBIF search is on; the "Search subjects" control needs it. */
  canSearch: boolean
  onPick: (picked: PickedSubject) => void
  onSuggest: () => void
  onSearch: () => void
}

/** "Zosterops japonicus · Animalia › Aves › …" under the chosen subject. */
export const TaxonPathLine: FC<{
  scientificName: string
  path: string[]
}> = ({ scientificName, path }) => {
  if (!scientificName && path.length === 0) return null
  return (
    <p className="text-xs text-muted-foreground">
      {scientificName ? <i>{scientificName}</i> : null}
      {scientificName && path.length > 0 ? ' · ' : null}
      {path.join(' › ')}
    </p>
  )
}

const chipClass = (selected: boolean, dashed = false) =>
  cn(
    'inline-flex min-h-9 items-center gap-2 rounded-full border px-3 text-sm outline-none',
    'focus-visible:ring-[3px] focus-visible:ring-ring/50',
    dashed && 'border-dashed',
    selected
      ? 'border-primary bg-primary/5 font-semibold'
      : 'bg-background hover:bg-accent/50'
  )

export const SubjectSuggestions: FC<Props> = ({
  suggestions,
  threshold,
  draft,
  canSuggest,
  suggesting,
  error,
  canSearch,
  onPick,
  onSuggest,
  onSearch
}) => {
  const choices = getSubjectChoices(suggestions, threshold)
  const hasChips = choices.species.length > 0 || choices.group !== null
  const groupPick = choices.group
    ? groupToPicked(choices.group.label, choices.group.category)
    : null

  return (
    <div className="space-y-3">
      {suggestions ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Sparkles
            aria-hidden="true"
            className="size-3.5 shrink-0 text-green-700 dark:text-green-400"
          />
          <span>
            Suggested by {suggestions.model}
            {suggestions.checkedAgainst === 'gbif'
              ? ' · checked against GBIF'
              : ''}
          </span>
        </p>
      ) : null}

      {suggesting ? (
        <p
          role="status"
          className="flex items-center gap-2 text-sm text-muted-foreground"
        >
          <Loader2 className="size-3.5 animate-spin" />
          Reading details…
        </p>
      ) : null}

      {hasChips ? (
        <div
          role="group"
          aria-label="Suggested subjects"
          className="flex flex-wrap gap-2"
        >
          {choices.species.map((candidate) => {
            const picked = candidateToPicked(candidate)
            const selected = isSubjectPicked(draft, picked)
            return (
              <button
                key={`${candidate.name}-${candidate.taxonKey ?? ''}`}
                type="button"
                aria-pressed={selected}
                onClick={() => onPick(picked)}
                className={chipClass(selected)}
              >
                {selected ? (
                  <Check
                    aria-hidden="true"
                    className="size-3.5 text-primary-text"
                  />
                ) : null}
                {candidate.name}{' '}
                <span
                  className={cn(
                    'font-medium',
                    selected
                      ? 'text-green-700 dark:text-green-400'
                      : 'text-muted-foreground'
                  )}
                >
                  {toPercent(candidate.confidence)}%
                </span>
              </button>
            )
          })}
          {choices.group && groupPick ? (
            <button
              type="button"
              aria-pressed={isSubjectPicked(draft, groupPick)}
              onClick={() => onPick(groupPick)}
              className={chipClass(isSubjectPicked(draft, groupPick), true)}
            >
              {choices.group.named
                ? `Just “${choices.group.label}”`
                : `${choices.group.label}?`}
            </button>
          ) : null}
        </div>
      ) : null}

      {canSuggest && !suggestions && !suggesting ? (
        <Button type="button" variant="outline" size="sm" onClick={onSuggest}>
          <Sparkles />
          Suggest subjects
        </Button>
      ) : null}

      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}

      {canSearch ? (
        <button
          type="button"
          onClick={onSearch}
          className="flex h-[38px] w-full items-center gap-2 rounded-lg border bg-background px-3 text-left text-sm text-muted-foreground outline-none hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <Search aria-hidden="true" className="size-4 shrink-0" />
          <span className="truncate">
            Search subjects, like “sunset” or “Ficus”
          </span>
        </button>
      ) : null}
    </div>
  )
}
