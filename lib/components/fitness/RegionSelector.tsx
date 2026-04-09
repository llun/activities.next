'use client'

import {
  FC,
  KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState
} from 'react'

import { ALL_REGIONS, MapRegion, RegionType } from '@/lib/fitness/regions'

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
  return TYPE_ORDER.map(
    (type): [RegionType, MapRegion[]] => [type, groups.get(type) ?? []]
  ).filter(([, items]) => items.length > 0)
}

export const RegionSelector: FC<Props> = ({ selectedIds, onChange }) => {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [focusedIndex, setFocusedIndex] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const selectedSet = new Set(selectedIds)

  const filteredRegions = ALL_REGIONS.filter((r) => {
    if (!query.trim()) return true
    return r.name.toLowerCase().includes(query.trim().toLowerCase())
  })

  const flatList = filteredRegions

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
      setFocusedIndex((i) => Math.min(i + 1, flatList.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setFocusedIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && focusedIndex >= 0) {
      e.preventDefault()
      const region = flatList[focusedIndex]
      if (region) toggle(region.id)
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  // Scroll focused item into view
  useEffect(() => {
    if (!listRef.current || focusedIndex < 0) return
    const item = listRef.current.children[focusedIndex] as
      | HTMLElement
      | undefined
    item?.scrollIntoView?.({ block: 'nearest' })
  }, [focusedIndex])

  // Reset focus when filtered list changes
  useEffect(() => {
    setFocusedIndex(-1)
  }, [query])

  const grouped = groupRegions(filteredRegions)

  // Flat index map: maps flat index → region id (for keyboard nav)
  let flatIdx = 0
  const indexMap: string[] = []
  for (const [, items] of grouped) {
    for (const item of items) {
      indexMap.push(item.id)
      flatIdx++
    }
  }
  void flatIdx

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
          const region = ALL_REGIONS.find((r) => r.id === id)
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
                className="ml-0.5 rounded-full hover:text-foreground text-muted-foreground leading-none"
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
          role="combobox"
          aria-autocomplete="list"
        />
      </div>

      {/* Dropdown */}
      {open && (
        <ul
          ref={listRef}
          role="listbox"
          aria-label="Regions"
          aria-multiselectable="true"
          className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded border bg-background shadow-md"
        >
          {filteredRegions.length === 0 && (
            <li className="px-3 py-2 text-sm text-muted-foreground">
              No regions match &ldquo;{query}&rdquo;
            </li>
          )}
          {grouped.map(([type, items]) => (
            <li key={type}>
              <div className="sticky top-0 bg-muted/80 px-3 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {TYPE_LABELS[type]}
              </div>
              <ul>
                {items.map((region) => {
                  const flatI = indexMap.indexOf(region.id)
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
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
