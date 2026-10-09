'use client'

import { Search, X } from 'lucide-react'
import {
  FC,
  Fragment,
  ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState
} from 'react'

import {
  GalleryTaxonEntity,
  SubjectSuggestionsEntity,
  TaxaSearchUnavailableError,
  searchGalleryTaxa
} from '@/lib/client'
import { Alert } from '@/lib/components/surface/Alert'
import { Button } from '@/lib/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle
} from '@/lib/components/ui/dialog'
import { Input } from '@/lib/components/ui/input'
import { Label } from '@/lib/components/ui/label'
import { Switch } from '@/lib/components/ui/switch'
import { cn } from '@/lib/utils'

import type { PickedSubject } from './mediaDetailsDraft'
import {
  candidateToPicked,
  capitalize,
  getHigherTaxon,
  groupToPicked,
  toPercent
} from './subjectChoices'

const SEARCH_DEBOUNCE_MS = 300
const MIN_QUERY_LENGTH = 2
const MAX_CUSTOM_NAME_LENGTH = 255

interface Props {
  /** The photo being named, so the author can look at it while choosing. */
  photo: { url: string; alt: string }
  position: { index: number; total: number }
  suggestions: SubjectSuggestionsEntity | null
  onCancel: () => void
  /** `applyToAll` is the "every shot in the post" switch. */
  onUse: (picked: PickedSubject, applyToAll: boolean) => void
}

type SearchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; taxa: GalleryTaxonEntity[] }
  | { status: 'unavailable' }
  | { status: 'error' }

const taxonToPicked = (taxon: GalleryTaxonEntity): PickedSubject => ({
  name: taxon.vernacularName ?? taxon.scientificName,
  scientificName: taxon.scientificName,
  category: taxon.category,
  taxonKey: taxon.taxonKey,
  taxonPath: taxon.taxonPath
})

const summary = (category: string, path: string[]) =>
  [capitalize(category), path[path.length - 1]].filter(Boolean).join(' · ')

const OptionRow: FC<{
  name: string
  value: string
  checked: boolean
  dashed?: boolean
  onSelect: () => void
  children: ReactNode
  aside?: ReactNode
}> = ({ name, value, checked, dashed, onSelect, children, aside }) => (
  <label
    className={cn(
      'flex cursor-pointer items-center gap-3 rounded-[10px] border p-3',
      dashed && 'border-dashed',
      checked ? 'border-primary bg-primary/5' : 'border-border',
      'focus-within:ring-[3px] focus-within:ring-ring/50'
    )}
  >
    <input
      type="radio"
      name={name}
      value={value}
      checked={checked}
      onChange={onSelect}
      className="size-[18px] shrink-0 accent-primary"
    />
    <span className="flex min-w-0 flex-1 flex-col gap-0.5">{children}</span>
    {aside}
  </label>
)

const MatchMeter: FC<{ percent: number }> = ({ percent }) => (
  <span className="flex w-20 shrink-0 flex-col items-end gap-1 sm:w-[84px]">
    <span
      className={cn(
        'text-xs font-semibold',
        percent >= 70 ? 'text-success-text' : 'text-muted-foreground'
      )}
    >
      {percent}% match
    </span>
    <span className="h-1 w-full rounded-sm bg-border" aria-hidden="true">
      <span
        className={cn(
          'block h-1 rounded-sm',
          percent >= 70 ? 'bg-success' : 'bg-muted-foreground/60'
        )}
        style={{ width: `${percent}%` }}
      />
    </span>
  </span>
)

export const SpeciesPickerDialog: FC<Props> = ({
  photo,
  position,
  suggestions,
  onCancel,
  onUse
}) => {
  const uid = useId()
  const searchRef = useRef<HTMLInputElement>(null)
  const candidates = suggestions?.candidates ?? []
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState<SearchState>({ status: 'idle' })
  // `c0`..`c2` best matches, `t<key>` a search result. The most likely
  // candidate starts selected, as the board shows. The broad "Just …" pick is
  // a separate flag: it is derived from the species last selected.
  const [species, setSpecies] = useState<string | null>(
    candidates.length > 0 ? 'c0' : null
  )
  const [groupSelected, setGroupSelected] = useState(false)
  const selected = groupSelected ? 'group' : species
  const select = (key: string) => {
    setSpecies(key)
    setGroupSelected(false)
  }
  const [applyToAll, setApplyToAll] = useState(false)

  const trimmed = query.trim()
  useEffect(() => {
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setSearch({ status: 'idle' })
      return
    }
    setSearch({ status: 'loading' })
    const controller = new AbortController()
    const timer = setTimeout(() => {
      searchGalleryTaxa(trimmed, { signal: controller.signal }).then(
        (taxa) => {
          // A newer query has taken over; this answer is stale.
          if (!controller.signal.aborted) setSearch({ status: 'ready', taxa })
        },
        (error: unknown) => {
          if (controller.signal.aborted) return
          setSearch(
            error instanceof TaxaSearchUnavailableError
              ? { status: 'unavailable' }
              : { status: 'error' }
          )
        }
      )
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [trimmed])

  // A species already under "Best matches" is not listed twice.
  const shownKeys = new Set(
    candidates.map((candidate) => candidate.taxonKey).filter(Boolean)
  )
  const results =
    search.status === 'ready'
      ? search.taxa.filter((taxon) => !shownKeys.has(taxon.taxonKey))
      : []

  // What each radio would pick.
  const picks = useMemo(() => {
    const map = new Map<string, PickedSubject>()
    candidates.forEach((candidate, index) =>
      map.set(`c${index}`, candidateToPicked(candidate))
    )
    results.forEach((taxon) =>
      map.set(`t${taxon.taxonKey}`, taxonToPicked(taxon))
    )
    return map
  }, [candidates, results])

  // Not a species ("sunset"): the author's own words, with no category.
  const customPick: PickedSubject | null =
    trimmed.length >= MIN_QUERY_LENGTH
      ? {
          name: trimmed.slice(0, MAX_CUSTOM_NAME_LENGTH),
          scientificName: '',
          category: '',
          taxonKey: '',
          taxonPath: []
        }
      : null

  // The broad pick follows the species last selected (else the best match), so
  // "Not sure of the species?" always refers to what is on screen.
  const base = species ? picks.get(species) : picks.get('c0')
  // (A custom name has no taxon to take a genus from, so it has no broad pick.)
  const higher = base
    ? getHigherTaxon(base.scientificName, base.taxonPath)
    : null
  const groupPick: PickedSubject | null =
    base && higher
      ? {
          ...groupToPicked(higher.name, base.category),
          scientificName: higher.name,
          taxonPath: base.taxonPath
        }
      : null

  const chosen = groupSelected
    ? groupPick
    : species === 'custom'
      ? customPick
      : species
        ? (picks.get(species) ?? null)
        : null
  // The group pick's name is the genus or family, which the path may already
  // end with; the species' own scientific name closes the path otherwise.
  const pathNames = chosen
    ? [
        ...chosen.taxonPath,
        ...(chosen.scientificName ? [chosen.scientificName] : []),
        ...(groupSelected && !chosen.scientificName ? [chosen.name] : [])
      ].filter((name, index, all) => all.indexOf(name) === index)
    : []
  const noun =
    chosen?.category && chosen.category !== 'other'
      ? chosen.category
      : 'subject'
  const radioName = `${uid}-species`

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}
    >
      <DialogContent
        showCloseButton={false}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          searchRef.current?.focus()
        }}
        className="flex max-h-[92dvh] max-w-[calc(100%-1rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[600px]"
      >
        <DialogDescription className="sr-only">
          Choose the species that is in this photo, or search for it.
        </DialogDescription>
        <header className="flex items-center justify-between border-b px-5 py-4">
          <DialogTitle className="text-lg leading-6">
            What’s in this photo?
          </DialogTitle>
          <DialogClose asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Close"
            >
              <X />
            </Button>
          </DialogClose>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
          <div className="flex items-center gap-4">
            <img
              src={photo.url}
              alt={photo.alt}
              className="h-[99px] w-[132px] shrink-0 rounded-lg bg-muted object-cover"
            />
            <div className="flex min-w-0 flex-col gap-1.5">
              <p className="text-[13px] text-muted-foreground">
                Photo {position.index + 1} of {position.total}
              </p>
              <p className="text-sm">
                Pick the closest match. Your choice is what gets posted; the
                suggestion is only a starting point.
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`${uid}-search`} className="text-[13px]">
              Search species
            </Label>
            <div className="relative">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                id={`${uid}-search`}
                ref={searchRef}
                value={query}
                autoComplete="off"
                onChange={(event) => setQuery(event.target.value)}
                className="h-10 pl-9"
              />
            </div>
          </div>

          {candidates.length > 0 ? (
            <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
              <legend className="pb-2 text-[13px] font-medium text-muted-foreground">
                Best matches
              </legend>
              {candidates.map((candidate, index) => (
                <OptionRow
                  key={`${candidate.name}-${index}`}
                  name={radioName}
                  value={`c${index}`}
                  checked={selected === `c${index}`}
                  onSelect={() => select(`c${index}`)}
                  aside={
                    <MatchMeter percent={toPercent(candidate.confidence)} />
                  }
                >
                  <span className="text-[15px] font-semibold">
                    {candidate.name}
                  </span>
                  <span className="text-[13px] text-muted-foreground">
                    {candidate.scientificName ? (
                      <>
                        <i>{candidate.scientificName}</i> ·{' '}
                      </>
                    ) : null}
                    {summary(candidate.category, candidate.taxonPath)}
                  </span>
                </OptionRow>
              ))}
            </fieldset>
          ) : null}

          {trimmed.length >= MIN_QUERY_LENGTH ? (
            <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
              <legend className="pb-2 text-[13px] font-medium text-muted-foreground">
                Search results
              </legend>
              {search.status === 'loading' ? (
                <div role="status" aria-label="Searching species">
                  {[0, 1, 2].map((row) => (
                    <div
                      key={row}
                      className="skeleton mb-2 h-[62px] rounded-[10px]"
                    />
                  ))}
                </div>
              ) : null}
              {search.status === 'unavailable' ? (
                <p role="status" className="text-sm text-muted-foreground">
                  Species search isn’t available. You can still type the name
                  yourself.
                </p>
              ) : null}
              {search.status === 'error' ? (
                <Alert title="Species could not be searched. Try again." />
              ) : null}
              {search.status === 'ready' && search.taxa.length === 0 ? (
                <p role="status" className="text-sm text-muted-foreground">
                  No species found for “{trimmed}”.
                </p>
              ) : null}
              {results.map((taxon) => (
                <OptionRow
                  key={taxon.taxonKey}
                  name={radioName}
                  value={`t${taxon.taxonKey}`}
                  checked={selected === `t${taxon.taxonKey}`}
                  onSelect={() => select(`t${taxon.taxonKey}`)}
                >
                  <span className="text-[15px] font-semibold">
                    {taxon.vernacularName ?? taxon.scientificName}
                  </span>
                  <span className="text-[13px] text-muted-foreground">
                    {taxon.vernacularName ? (
                      <>
                        <i>{taxon.scientificName}</i> ·{' '}
                      </>
                    ) : null}
                    {summary(taxon.category, taxon.taxonPath)}
                  </span>
                </OptionRow>
              ))}
              {customPick ? (
                <OptionRow
                  name={radioName}
                  value="custom"
                  dashed
                  checked={selected === 'custom'}
                  onSelect={() => select('custom')}
                >
                  <span className="text-[15px] font-medium">
                    Use “{customPick.name}”
                  </span>
                  <span className="text-[13px] text-muted-foreground">
                    Not a species? Use your own words.
                  </span>
                </OptionRow>
              ) : null}
            </fieldset>
          ) : null}

          {groupPick && higher ? (
            <OptionRow
              name={radioName}
              value="group"
              dashed
              checked={selected === 'group'}
              onSelect={() => setGroupSelected(true)}
            >
              <span className="text-[15px] font-medium">
                Just “{groupPick.name}”
              </span>
              <span className="text-[13px] text-muted-foreground">
                Not sure of the species? Tag the {higher.rank} only.
              </span>
            </OptionRow>
          ) : null}

          {pathNames.length > 0 ? (
            <nav
              aria-label="Taxonomy"
              className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"
            >
              {pathNames.map((name, index) => {
                const last = index === pathNames.length - 1
                return (
                  <Fragment key={`${name}-${index}`}>
                    {index > 0 ? <span aria-hidden="true">›</span> : null}
                    <span className={cn(last && 'italic text-foreground')}>
                      {name}
                    </span>
                  </Fragment>
                )
              })}
            </nav>
          ) : null}

          {position.total > 1 ? (
            <div className="flex items-center justify-between gap-4 border-t pt-3">
              <Label
                htmlFor={`${uid}-all`}
                className="flex min-w-0 cursor-pointer flex-col items-start gap-0.5"
              >
                <span className="text-sm font-medium">
                  Use for every shot of this {noun} in the post
                </span>
                <span className="text-[13px] font-normal text-muted-foreground">
                  Handy for a burst of the same subject.
                </span>
              </Label>
              <Switch
                id={`${uid}-all`}
                checked={applyToAll}
                onCheckedChange={setApplyToAll}
              />
            </div>
          ) : null}
        </div>

        <footer className="flex flex-col gap-3 border-t bg-muted/40 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-xs text-muted-foreground">
            Names from the GBIF Backbone Taxonomy
          </span>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!chosen}
              onClick={() => chosen && onUse(chosen, applyToAll)}
            >
              {chosen ? `Use ${chosen.name}` : 'Use'}
            </Button>
          </div>
        </footer>
      </DialogContent>
    </Dialog>
  )
}
