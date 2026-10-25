'use client'

import { ChevronDown, X } from 'lucide-react'
import { type FC, type ReactElement, type ReactNode, useRef } from 'react'

import { Button } from '@/lib/components/ui/button'
import { cn } from '@/lib/utils'

export interface GalleryFilterChipProps {
  label: string
  active: boolean
  activeLabel: string
  inactiveTriggerText: string
  triggerAriaLabel: string
  clearAriaLabel: string
  onClear: () => void
  renderTrigger: (trigger: ReactElement) => ReactNode
  id?: string
  disabled?: boolean
  className?: string
}

export const GalleryFilterChip: FC<GalleryFilterChipProps> = ({
  label,
  active,
  activeLabel,
  inactiveTriggerText,
  triggerAriaLabel,
  clearAriaLabel,
  onClear,
  renderTrigger,
  id,
  disabled = false,
  className
}) => {
  const triggerRef = useRef<HTMLButtonElement>(null)

  return (
    <div
      role={active ? 'group' : undefined}
      aria-label={active ? `${label} filter` : undefined}
      className={cn(
        'inline-flex h-10 items-stretch rounded-lg',
        active &&
          'border-primary bg-primary/10 text-primary-text border text-sm font-medium shadow-xs transition-colors',
        active && disabled && 'pointer-events-none opacity-50',
        className
      )}
    >
      {renderTrigger(
        <Button
          ref={triggerRef}
          {...(id ? { id } : {})}
          type="button"
          variant={active ? 'ghost' : 'outline'}
          disabled={disabled}
          aria-label={triggerAriaLabel}
          className={cn(
            'h-full justify-between gap-2 rounded-lg font-normal',
            active &&
              'hover:bg-primary/15 hover:text-primary-text gap-1.5 rounded-r-none px-3 font-medium'
          )}
        >
          <span className={cn('truncate', active && 'max-w-[180px]')}>
            {active ? activeLabel : inactiveTriggerText}
          </span>
          <ChevronDown
            aria-hidden="true"
            className={cn(
              'size-4 shrink-0',
              active ? 'opacity-70' : 'text-muted-foreground'
            )}
          />
        </Button>
      )}
      {active ? (
        <>
          <div className="bg-primary/20 my-1.5 w-px" aria-hidden="true" />
          <button
            type="button"
            disabled={disabled}
            aria-label={clearAriaLabel}
            onClick={(event) => {
              event.stopPropagation()
              onClear()
              triggerRef.current?.focus()
            }}
            className="hover:bg-primary/20 focus-visible:ring-primary/50 flex items-center justify-center rounded-r-lg px-2.5 py-2 focus-visible:ring-2 focus-visible:outline-none"
          >
            <X className="size-3.5 shrink-0" />
          </button>
        </>
      ) : null}
    </div>
  )
}
