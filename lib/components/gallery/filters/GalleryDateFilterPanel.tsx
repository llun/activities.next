'use client'

import { Check } from 'lucide-react'
import { type FC, useEffect, useId, useMemo, useState } from 'react'

import { Button } from '@/lib/components/ui/button'
import { Input } from '@/lib/components/ui/input'
import type { GalleryMonthFacet } from '@/lib/services/gallery/galleryEntities'
import { cn } from '@/lib/utils'

import { formatMonthFacetLabel } from './galleryMediaFilterLabels'
import type { GalleryDateFilter } from './galleryMediaFilterState'

export interface GalleryDateFilterPanelProps {
  value: GalleryDateFilter | null
  months: GalleryMonthFacet[]
  today?: Date
  onSelect: (filter: GalleryDateFilter | null) => void
  className?: string
}

export const GalleryDateFilterPanel: FC<GalleryDateFilterPanelProps> = ({
  value,
  months,
  today: _today = new Date(),
  onSelect,
  className
}) => {
  const fromInputId = useId()
  const toInputId = useId()

  const [from, setFrom] = useState(value?.kind === 'custom' ? value.from : '')
  const [to, setTo] = useState(value?.kind === 'custom' ? value.to : '')

  useEffect(() => {
    if (value?.kind === 'custom') {
      setFrom(value.from)
      setTo(value.to)
    } else {
      setFrom('')
      setTo('')
    }
  }, [value])

  const yearFacets = useMemo(() => {
    const yearCounts = new Map<number, number>()
    for (const facet of months) {
      const year = Number(facet.month.split('-')[0])
      if (!Number.isNaN(year) && year > 0) {
        yearCounts.set(year, (yearCounts.get(year) ?? 0) + facet.count)
      }
    }
    return Array.from(yearCounts.entries())
      .map(([year, count]) => ({ year, count }))
      .sort((a, b) => b.year - a.year)
  }, [months])

  const rangeInverted = Boolean(from && to && from > to)

  const handleApplyCustom = () => {
    const trimmedFrom = from.trim()
    const trimmedTo = to.trim()
    if (!trimmedFrom && !trimmedTo) {
      onSelect(null)
      return
    }
    // ISO dates compare lexically; the server answers 422 for from > to.
    if (trimmedFrom && trimmedTo && trimmedFrom > trimmedTo) return
    onSelect({
      kind: 'custom',
      from: trimmedFrom,
      to: trimmedTo
    })
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleApplyCustom()
    }
  }

  const isAnyTimeActive = value === null
  const isThisMonthActive = value?.kind === 'this_month'
  const isThisYearActive = value?.kind === 'this_year'

  return (
    <div
      role="group"
      aria-label="Date filter options"
      className={cn('flex flex-col gap-3 p-1', className)}
    >
      {/* Presets Group */}
      <div className="flex flex-col gap-0.5">
        <button
          type="button"
          aria-pressed={isAnyTimeActive}
          onClick={() => onSelect(null)}
          className={cn(
            'hover:bg-muted/60 flex w-full items-center justify-between gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors',
            isAnyTimeActive &&
              'bg-primary/10 text-primary-text hover:bg-primary/15'
          )}
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <Check
              className={cn(
                'size-4 shrink-0',
                isAnyTimeActive ? 'text-primary' : 'invisible'
              )}
              aria-hidden="true"
            />
            <span className="truncate font-medium">Any time</span>
          </div>
        </button>

        <button
          type="button"
          aria-pressed={isThisMonthActive}
          onClick={() => onSelect({ kind: 'this_month' })}
          className={cn(
            'hover:bg-muted/60 flex w-full items-center justify-between gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors',
            isThisMonthActive &&
              'bg-primary/10 text-primary-text hover:bg-primary/15'
          )}
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <Check
              className={cn(
                'size-4 shrink-0',
                isThisMonthActive ? 'text-primary' : 'invisible'
              )}
              aria-hidden="true"
            />
            <span className="truncate font-medium">This month</span>
          </div>
        </button>

        <button
          type="button"
          aria-pressed={isThisYearActive}
          onClick={() => onSelect({ kind: 'this_year' })}
          className={cn(
            'hover:bg-muted/60 flex w-full items-center justify-between gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors',
            isThisYearActive &&
              'bg-primary/10 text-primary-text hover:bg-primary/15'
          )}
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <Check
              className={cn(
                'size-4 shrink-0',
                isThisYearActive ? 'text-primary' : 'invisible'
              )}
              aria-hidden="true"
            />
            <span className="truncate font-medium">This year</span>
          </div>
        </button>

        {yearFacets.map(({ year, count }) => {
          const isActive = value?.kind === 'year' && value.year === year
          return (
            <button
              key={year}
              type="button"
              aria-pressed={isActive}
              onClick={() => onSelect({ kind: 'year', year })}
              className={cn(
                'hover:bg-muted/60 flex w-full items-center justify-between gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors',
                isActive &&
                  'bg-primary/10 text-primary-text hover:bg-primary/15'
              )}
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <Check
                  className={cn(
                    'size-4 shrink-0',
                    isActive ? 'text-primary' : 'invisible'
                  )}
                  aria-hidden="true"
                />
                <span className="truncate font-medium">{year}</span>
              </div>
              <span
                className={cn(
                  'ml-2 shrink-0 text-xs tabular-nums',
                  isActive ? 'text-primary-text/80' : 'text-muted-foreground'
                )}
              >
                {count.toLocaleString('en-US')}
              </span>
            </button>
          )
        })}
      </div>

      {/* Month Group */}
      {months.length > 0 ? (
        <>
          <div aria-hidden="true" className="border-border my-1 border-t" />
          <div className="flex flex-col gap-1">
            <div className="text-muted-foreground px-3 py-1 text-xs font-semibold tracking-wider uppercase">
              Month
            </div>
            <div className="flex flex-col gap-0.5">
              {months.map((facet) => {
                const isActive =
                  value?.kind === 'month' && value.month === facet.month
                return (
                  <button
                    key={facet.month}
                    type="button"
                    aria-pressed={isActive}
                    onClick={() =>
                      onSelect({ kind: 'month', month: facet.month })
                    }
                    className={cn(
                      'hover:bg-muted/60 flex w-full items-center justify-between gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors',
                      isActive &&
                        'bg-primary/10 text-primary-text hover:bg-primary/15'
                    )}
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <Check
                        className={cn(
                          'size-4 shrink-0',
                          isActive ? 'text-primary' : 'invisible'
                        )}
                        aria-hidden="true"
                      />
                      <span className="truncate font-medium">
                        {formatMonthFacetLabel(facet.month)}
                      </span>
                    </div>
                    <span
                      className={cn(
                        'ml-2 shrink-0 text-xs tabular-nums',
                        isActive
                          ? 'text-primary-text/80'
                          : 'text-muted-foreground'
                      )}
                    >
                      {facet.count.toLocaleString('en-US')}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </>
      ) : null}

      {/* Custom Group */}
      <div aria-hidden="true" className="border-border my-1 border-t" />
      <div className="flex flex-col gap-2">
        <div className="text-muted-foreground px-3 py-1 text-xs font-semibold tracking-wider uppercase">
          Custom
        </div>
        <div className="flex flex-col gap-2 px-1">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label
                htmlFor={fromInputId}
                className="text-muted-foreground mb-1 block text-xs font-medium"
              >
                From
              </label>
              <Input
                id={fromInputId}
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                onKeyDown={handleKeyDown}
                className="h-8 text-xs"
              />
            </div>
            <div>
              <label
                htmlFor={toInputId}
                className="text-muted-foreground mb-1 block text-xs font-medium"
              >
                To
              </label>
              <Input
                id={toInputId}
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                onKeyDown={handleKeyDown}
                className="h-8 text-xs"
              />
            </div>
          </div>
          {rangeInverted ? (
            <p role="alert" className="text-destructive-text px-1 text-xs">
              The start date must be on or before the end date.
            </p>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={rangeInverted}
            onClick={handleApplyCustom}
            className={cn(
              'h-8 w-full text-xs font-medium',
              value?.kind === 'custom' && 'border-primary text-primary-text'
            )}
          >
            Apply
          </Button>
        </div>
      </div>
    </div>
  )
}
