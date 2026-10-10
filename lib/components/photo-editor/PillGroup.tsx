'use client'

import { type KeyboardEvent, useRef } from 'react'

import { Button } from '@/lib/components/ui/button'
import { cn } from '@/lib/utils'

export interface PillItem {
  value: string
  label: string
}

interface Props {
  'aria-label': string
  items: ReadonlyArray<PillItem>
  value: string
  onValueChange: (value: string) => void
  disabled?: boolean
  /**
   * Smaller side padding, and every pill shares the row equally, for a group
   * that has to fit one line on a phone.
   */
  compact?: boolean
  className?: string
}

/**
 * A radiogroup of pill chips (the design's Aspect and category rows). They
 * wrap onto more lines instead of scrolling, so nothing is ever clipped; each
 * is at least 40 px tall on a phone. One tab stop; the arrow keys move and
 * choose, Home and End jump.
 */
export const PillGroup = ({
  items,
  value,
  onValueChange,
  disabled,
  compact,
  className,
  ...rest
}: Props) => {
  const group = useRef<HTMLDivElement>(null)
  const current = items.some((item) => item.value === value)
    ? value
    : items[0]?.value

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = items.findIndex((item) => item.value === current)
    const last = items.length - 1
    const target =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? index >= last
          ? 0
          : index + 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? index <= 0
            ? last
            : index - 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : -1
    if (target < 0) return
    event.preventDefault()
    const next = items[target]
    onValueChange(next.value)
    group.current
      ?.querySelector<HTMLElement>(`[data-pill="${CSS.escape(next.value)}"]`)
      ?.focus()
  }

  return (
    <div
      ref={group}
      role="radiogroup"
      aria-label={rest['aria-label']}
      onKeyDown={onKeyDown}
      className={cn('flex flex-wrap gap-2', compact && 'gap-1.5', className)}
    >
      {items.map((item) => {
        const active = item.value === current
        return (
          <Button
            key={item.value}
            type="button"
            variant="pill"
            size="sm"
            role="radio"
            aria-checked={active}
            data-state={active ? 'checked' : 'unchecked'}
            data-pill={item.value}
            tabIndex={active ? 0 : -1}
            disabled={disabled}
            onClick={() => onValueChange(item.value)}
            className={cn(
              'max-md:min-h-10',
              compact && 'min-w-0 flex-1 px-2 text-[13px]',
              active &&
                'border-primary bg-primary/10 font-semibold text-primary-text hover:bg-primary/15 dark:border-primary dark:bg-primary/15'
            )}
          >
            {item.label}
          </Button>
        )
      })}
    </div>
  )
}
