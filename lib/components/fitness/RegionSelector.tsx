'use client'

import {
  FC,
  KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'

import {
  ALL_REGIONS,
  MapRegion,
  REGION_MAP,
  RegionType
} from '@/lib/fitness/regions'

interface Props {
  /** Currently selected region IDs */
  selectedIds: string[]
  onChange: (ids: string[]) => void
}

const TYPE_LABELS: Record<RegionType, string> = {
  continent: 'Continents',
  subregion: 'Regions',
  country: 'Countries'
}

const TYPE_ORDER: RegionType[] = ['continent', 'subregion', 'country']

const groupRegions = (regions: MapRegion[]): [RegionType, MapRegion[]][] => {
  const groups = new Map<RegionType, MapRegion[]>()
  for (const type of TYPE_ORDER) {
    groups.set(type, [])
  }
  for (const region of regions) {
    groups.get(region.type)?.push(region)
  }
  return TYPE_ORDER.map((type): [RegionType, MapRegion[]] => [
    type,
    groups.get(type) ?? []
  ]).filter(([, items]) => items.length > 0)
}

export const RegionSelector: FC<Props> = ({ selectedIds, onChange }) => {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [focusedIndex, setFocusedIndex] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])

  const filteredRegions = useMemo(
    () =>
      ALL_REGIONS.filter((r) => {
        if (!query.trim()) return true
        return r.name.toLowerCase().includes(query.trim().toLowerCase())
      }),
    [query]
  )

  const grouped = useMemo(
    () => groupRegions(filteredRegions),
    [filteredRegions]
  )

  /** Flat ordered list of region IDs, matching DOM order in the dropdown. */
  const indexMap = useMemo<string[]>(() => {
    const ids: string[] = []
    for (const [, items] of grouped) {
      for (const item of items) {
        ids.push(item.id)
      }
    }
    return ids
  }, [grouped])

  /** O(1) id → flat index lookup (replaces O(n) indexOf calls per render). */
  const indexByIdMap = useMemo(
    () => new Map<string, number>(indexMap.map((id, i) => [id, i])),
    [indexMap]
  )

  const toggle = useCallback(
    (id: string) => {
      if (selectedSet.has(id)) {
        onChange(selectedIds.filter((s) => s !== id))
      } else {
        onChange([...selectedIds, id])
      }
    },
    [selectedIds, selectedSet, onChange]
  )

  const removeTag = (id: string) => {
    onChange(selectedIds.filter((s) => s !== id))
  }

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setFocusedIndex((i) => Math.min(i + 1, indexMap.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setFocusedIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && focusedIndex >= 0) {
      e.preventDefault()
      const id = indexMap[focusedIndex]
      if (id) toggle(id)
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  // Scroll focused option into view using querySelectorAll so grouping wrappers
  // don't skew the index (fixes broken scroll when list is grouped).
  useEffect(() => {
    if (!listRef.current || focusedIndex < 0) return
    const options =
      listRef.current.querySelectorAll<HTMLElement>('[role="option"]')
    options[focusedIndex]?.scrollIntoView?.({ block: 'nearest' })
  }, [focusedIndex])

  // Reset focus when the filtered list changes
  useEffect(() => {
    setFocusedIndex(-1)
  }, [query])

  return (
    <div ref={containerRef} className="relative">
      {/* Selected tags + input */}
      <div
        className="flex min-h-[34px] flex-wrap items-center gap-1 rounded border bg-background px-2 py-1 text-sm focus-within:ring-1 focus-within:ring-ring"
        onClick={() => {
          setOpen(true)
          inputRef.current?.focus()
        }}
      >
        {selectedIds.map((id) => {
          // Use REGION_MAP for O(1) lookup instead of ALL_REGIONS.find (O(n)).
          const region = REGION_MAP.get(id)
          if (!region) return null
          return (
            <span
              key={id}
              className="flex items-center gap-0.5 rounded bg-muted px-1.5 py-0.5 text-xs"
            >
              {region.name}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  removeTag(id)
                }}
                className="ml-0.5 rounded-full text-muted-foreground leading-none hover:text-foreground"
                aria-label={`Remove ${region.name}`}
              >
                ×
              </button>
            </span>
          )
        })}
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={selectedIds.length === 0 ? 'Search regions…' : ''}
          className="min-w-[100px] flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
          aria-label="Search regions"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-controls={open ? 'region-listbox' : undefined}
          role="combobox"
          aria-autocomplete="list"
        />
      </div>

      {/* Dropdown — flat listbox with role="presentation" group headers so
          role="option" elements are direct logical children of the listbox,
          satisfying ARIA 1.1 listbox pattern. */}
      {open && (
        <ul
          id="region-listbox"
          ref={listRef}
          role="listbox"
          aria-label="Regions"
          aria-multiselectable="true"
          className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded border bg-background shadow-md"
        >
          {filteredRegions.length === 0 && (
            <li
              role="presentation"
              className="px-3 py-2 text-sm text-muted-foreground"
            >
              No regions match &ldquo;{query}&rdquo;
            </li>
          )}
          {grouped.map(([type, items]) => (
            <>
              {/* Group header — role="presentation" keeps it out of the
                  accessibility tree for option navigation. */}
              <li
                key={`${type}-header`}
                role="presentation"
                aria-hidden="true"
                className="sticky top-0 bg-muted/80 px-3 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground"
              >
                {TYPE_LABELS[type]}
              </li>
              {items.map((region) => {
                const flatI = indexByIdMap.get(region.id) ?? -1
                const isSelected = selectedSet.has(region.id)
                const isFocused = flatI === focusedIndex
                return (
                  <li
                    key={region.id}
                    role="option"
                    aria-selected={isSelected}
                    data-focused={isFocused}
                    onMouseEnter={() => setFocusedIndex(flatI)}
                    onClick={() => toggle(region.id)}
                    className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm ${
                      isFocused ? 'bg-accent' : ''
                    }`}
                  >
                    <span
                      className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-sm border text-xs ${
                        isSelected
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-input'
                      }`}
                    >
                      {isSelected && '✓'}
                    </span>
                    {region.name}
                  </li>
                )
              })}
            </>
          ))}
        </ul>
      )}
    </div>
  )
}
