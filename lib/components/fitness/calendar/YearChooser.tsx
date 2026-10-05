'use client'

import { ChevronDown } from 'lucide-react'
import { useId } from 'react'

import { Button } from '@/lib/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from '@/lib/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

interface YearChooserProps {
  /** Years to offer, newest first (`yearsForChooser`). */
  years: readonly number[]
  /** The year shown on the trigger and checked in the list. */
  value: number | null
  /** Called with the chosen calendar year; the parent applies it. */
  onSelect: (year: number) => void
  /** Sizes the trigger at 44px regardless of the pointer. */
  touch?: boolean
  className?: string
  /** A visible label above the trigger; defaults to "Calendar year". */
  label?: string
}

/**
 * The direct historical-year chooser: a labelled menu of calendar years. It
 * is a radio list, so the current choice is announced and checked.
 */
export function YearChooser({
  years,
  value,
  onSelect,
  touch = false,
  className,
  label = 'Calendar year'
}: YearChooserProps) {
  const labelId = useId()
  const triggerId = useId()
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <span id={labelId} className="text-xs font-medium">
        {label}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            id={triggerId}
            type="button"
            variant="outline"
            aria-labelledby={`${labelId} ${triggerId}`}
            className={cn(
              'w-full justify-between font-normal',
              touch ? 'h-11' : 'pointer-coarse:h-11'
            )}
          >
            <span>{value ?? 'Select year'}</span>
            <ChevronDown
              className="text-muted-foreground size-4"
              aria-hidden="true"
            />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="max-h-60 w-(--radix-dropdown-menu-trigger-width) min-w-28"
        >
          <DropdownMenuRadioGroup
            value={value === null ? '' : String(value)}
            onValueChange={(next) => {
              const year = Number(next)
              if (Number.isInteger(year)) onSelect(year)
            }}
          >
            {years.map((year) => (
              <DropdownMenuRadioItem
                key={year}
                value={String(year)}
                className={touch ? 'min-h-11' : 'pointer-coarse:min-h-11'}
              >
                {year}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
