'use client'

import { Check, Search, X } from 'lucide-react'
import { type FC, useId, useMemo, useState } from 'react'

import { Input } from '@/lib/components/ui/input'
import { cn } from '@/lib/utils'

export interface GalleryFilterOptionItem {
  id: string
  label: string
  subLabel?: string | null
  count?: number
  active: boolean
  onSelect: () => void
  searchTerms?: string[]
}

export interface GalleryFilterOptionAction {
  label: string
  count?: number
  active: boolean
  onSelect: () => void
}

export interface GalleryFilterOptionListProps {
  searchPlaceholder: string
  searchAriaLabel: string
  anyOption: GalleryFilterOptionAction
  items: GalleryFilterOptionItem[]
  noneOption?: GalleryFilterOptionAction
  className?: string
}

const normalizeSearchText = (text: string | null | undefined): string =>
  (text ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('en-US')

export const GalleryFilterOptionList: FC<GalleryFilterOptionListProps> = ({
  searchPlaceholder,
  searchAriaLabel,
  anyOption,
  items,
  noneOption,
  className
}) => {
  const [searchQuery, setSearchQuery] = useState('')
  const searchInputId = useId()

  const normalizedQuery = useMemo(
    () => normalizeSearchText(searchQuery),
    [searchQuery]
  )

  const filteredItems = useMemo(() => {
    if (!normalizedQuery) {
      return items
    }
    return items.filter((item) => {
      if (normalizeSearchText(item.label).includes(normalizedQuery)) {
        return true
      }
      if (
        item.subLabel &&
        normalizeSearchText(item.subLabel).includes(normalizedQuery)
      ) {
        return true
      }
      if (
        item.searchTerms &&
        item.searchTerms.some((term) =>
          normalizeSearchText(term).includes(normalizedQuery)
        )
      ) {
        return true
      }
      return false
    })
  }, [items, normalizedQuery])

  const showAnyOption =
    normalizedQuery === '' ||
    normalizeSearchText(anyOption.label).includes(normalizedQuery)

  const showNoneOption =
    Boolean(noneOption) &&
    (normalizedQuery === '' ||
      (noneOption &&
        normalizeSearchText(noneOption.label).includes(normalizedQuery)))

  const hasVisibleOptions =
    showAnyOption || filteredItems.length > 0 || showNoneOption

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="relative px-1 pt-1">
        <Search
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
          aria-hidden="true"
        />
        <Input
          id={searchInputId}
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={searchPlaceholder}
          aria-label={searchAriaLabel}
          className="h-9 pr-8 pl-8"
        />
        {searchQuery ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => setSearchQuery('')}
            className="text-muted-foreground hover:text-foreground absolute top-1/2 right-3 -translate-y-1/2 p-0.5"
          >
            <X className="size-3.5" />
          </button>
        ) : null}
      </div>

      <div
        role="group"
        aria-label={`${searchAriaLabel} options`}
        className="max-h-72 overflow-y-auto p-1"
      >
        {showAnyOption ? (
          <button
            type="button"
            aria-pressed={anyOption.active}
            onClick={anyOption.onSelect}
            className={cn(
              'hover:bg-muted/60 flex w-full items-center justify-between gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors',
              anyOption.active &&
                'bg-primary/10 text-primary-text hover:bg-primary/15'
            )}
          >
            <div className="flex min-w-0 items-center gap-2.5">
              <Check
                className={cn(
                  'size-4 shrink-0',
                  anyOption.active ? 'text-primary' : 'invisible'
                )}
                aria-hidden="true"
              />
              <span className="truncate font-medium">{anyOption.label}</span>
            </div>
            {typeof anyOption.count === 'number' ? (
              <span
                className={cn(
                  'ml-2 shrink-0 text-xs tabular-nums',
                  anyOption.active
                    ? 'text-primary-text/80'
                    : 'text-muted-foreground'
                )}
              >
                {anyOption.count.toLocaleString('en-US')}
              </span>
            ) : null}
          </button>
        ) : null}

        {filteredItems.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={item.active}
            onClick={item.onSelect}
            className={cn(
              'hover:bg-muted/60 flex w-full items-start justify-between gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors',
              item.active &&
                'bg-primary/10 text-primary-text hover:bg-primary/15'
            )}
          >
            <div className="flex min-w-0 items-start gap-2.5">
              <Check
                className={cn(
                  'mt-0.5 size-4 shrink-0',
                  item.active ? 'text-primary' : 'invisible'
                )}
                aria-hidden="true"
              />
              <div className="min-w-0">
                <div className="truncate font-medium">{item.label}</div>
                {item.subLabel ? (
                  <div
                    className={cn(
                      'truncate text-xs',
                      item.active
                        ? 'text-primary-text/80'
                        : 'text-muted-foreground'
                    )}
                  >
                    {item.subLabel}
                  </div>
                ) : null}
              </div>
            </div>
            {typeof item.count === 'number' ? (
              <span
                className={cn(
                  'ml-2 shrink-0 text-xs tabular-nums',
                  item.active ? 'text-primary-text/80' : 'text-muted-foreground'
                )}
              >
                {item.count.toLocaleString('en-US')}
              </span>
            ) : null}
          </button>
        ))}

        {noneOption && showNoneOption ? (
          <>
            {filteredItems.length > 0 || showAnyOption ? (
              <div aria-hidden="true" className="border-border my-1 border-t" />
            ) : null}
            <button
              type="button"
              aria-pressed={noneOption.active}
              onClick={noneOption.onSelect}
              className={cn(
                'hover:bg-muted/60 flex w-full items-center justify-between gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors',
                noneOption.active &&
                  'bg-primary/10 text-primary-text hover:bg-primary/15'
              )}
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <Check
                  className={cn(
                    'size-4 shrink-0',
                    noneOption.active ? 'text-primary' : 'invisible'
                  )}
                  aria-hidden="true"
                />
                <span className="truncate font-medium">{noneOption.label}</span>
              </div>
              {typeof noneOption.count === 'number' ? (
                <span
                  className={cn(
                    'ml-2 shrink-0 text-xs tabular-nums',
                    noneOption.active
                      ? 'text-primary-text/80'
                      : 'text-muted-foreground'
                  )}
                >
                  {noneOption.count.toLocaleString('en-US')}
                </span>
              ) : null}
            </button>
          </>
        ) : null}

        {!hasVisibleOptions ? (
          <div className="text-muted-foreground py-6 text-center text-sm">
            No matches found
          </div>
        ) : null}
      </div>
    </div>
  )
}
