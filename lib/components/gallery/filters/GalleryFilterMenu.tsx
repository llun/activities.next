'use client'

import { type FC, type ReactNode, useState } from 'react'

import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from '@/lib/components/ui/popover'

import { GalleryFilterChip } from './GalleryFilterChip'

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

  const slug = label.toLowerCase().replace(/\s+/g, '-')
  const triggerId = idPrefix ? `${idPrefix}-${slug}-trigger` : undefined

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <GalleryFilterChip
        label={label}
        active={active}
        activeLabel={activeLabel}
        inactiveTriggerText={inactiveTriggerText}
        triggerAriaLabel={`${label}: ${active ? activeLabel : inactiveTriggerText}`}
        clearAriaLabel={`Clear ${activeLabel} filter`}
        onClear={() => {
          setOpen(false)
          onClear()
        }}
        renderTrigger={(trigger) => (
          <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        )}
        id={triggerId}
        disabled={disabled}
        className={className}
      />
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
