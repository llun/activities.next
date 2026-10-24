'use client'

import { ChevronDown, X } from 'lucide-react'
import { type FC, type ReactNode, useRef, useState } from 'react'

import { Button } from '@/lib/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from '@/lib/components/ui/popover'
import { cn } from '@/lib/utils'

export interface GalleryFilterMenuProps {
  label: string
  inactiveTriggerText: string
  active: boolean
  activeLabel: string
  onClear: () => void
  disabled?: boolean
  children: (controls: { close: () => void }) => ReactNode
  idPrefix?: string
  /** Render the list here (e.g. a modal's content) instead of the body, so a Radix scroll lock does not cancel wheel and touch scrolling. */
  portalContainer?: HTMLElement | null
  className?: string
}

export const GalleryFilterMenu: FC<GalleryFilterMenuProps> = ({
  label,
  inactiveTriggerText,
  active,
  activeLabel,
  onClear,
  disabled = false,
  children,
  idPrefix,
  portalContainer,
  className
}) => {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const slug = label.toLowerCase().replace(/\s+/g, '-')
  const triggerId = idPrefix ? `${idPrefix}-${slug}-trigger` : undefined

  return (
    <Popover open={open} onOpenChange={setOpen}>
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
        {/* One trigger element for both states, so focus survives a pick. */}
        <PopoverTrigger asChild>
          <Button
            ref={triggerRef}
            id={triggerId}
            variant={active ? 'ghost' : 'outline'}
            disabled={disabled}
            aria-label={`${label}: ${active ? activeLabel : inactiveTriggerText}`}
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
              className={cn(
                'size-4 shrink-0',
                active ? 'opacity-70' : 'text-muted-foreground'
              )}
            />
          </Button>
        </PopoverTrigger>
        {active ? (
          <>
            <div className="bg-primary/20 my-1.5 w-px" aria-hidden="true" />
            <button
              type="button"
              disabled={disabled}
              aria-label={`Clear ${activeLabel} filter`}
              onClick={(e) => {
                e.stopPropagation()
                setOpen(false)
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
      <PopoverContent
        container={portalContainer}
        align="start"
        sideOffset={6}
        // Inside a modal, keep the list within the dialog rather than the page.
        collisionBoundary={portalContainer ?? undefined}
        collisionPadding={8}
        aria-label={label}
        className="max-h-[min(24rem,var(--radix-popover-content-available-height))] w-72 max-w-(--radix-popover-content-available-width) overflow-y-auto rounded-xl p-2 shadow-lg sm:max-h-[min(calc(100vh-200px),var(--radix-popover-content-available-height))] sm:w-80"
      >
        {children({ close: () => setOpen(false) })}
      </PopoverContent>
    </Popover>
  )
}
