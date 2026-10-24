'use client'

import { ChevronDown } from 'lucide-react'
import type { FC } from 'react'

import { Button } from '@/lib/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from '@/lib/components/ui/dropdown-menu'
import type { GalleryMediaSort } from '@/lib/types/database/gallery'
import { cn } from '@/lib/utils'

import { GALLERY_SORT_OPTIONS } from './galleryMediaFilterState'

export interface GallerySortMenuProps {
  value: GalleryMediaSort
  onChange: (sort: GalleryMediaSort) => void
  compact?: boolean
  className?: string
  disabled?: boolean
}

export const GallerySortMenu: FC<GallerySortMenuProps> = ({
  value,
  onChange,
  compact = false,
  className,
  disabled
}) => {
  const activeOption =
    GALLERY_SORT_OPTIONS.find((option) => option.id === value) ??
    GALLERY_SORT_OPTIONS[0]

  return (
    <div
      role="group"
      aria-label="Sort"
      className={cn('inline-flex', className)}
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            disabled={disabled}
            className="h-10 justify-between gap-2 rounded-lg font-normal"
          >
            {!compact ? (
              <span>
                <span className="text-muted-foreground font-normal">Sort:</span>{' '}
                <span className="font-medium">{activeOption.trigger}</span>
              </span>
            ) : (
              <span className="font-medium">{activeOption.short}</span>
            )}
            <ChevronDown className="text-muted-foreground size-4 shrink-0" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          sideOffset={6}
          className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-xl shadow-lg"
        >
          <DropdownMenuRadioGroup
            value={activeOption.id}
            onValueChange={(next) => onChange(next as GalleryMediaSort)}
          >
            {GALLERY_SORT_OPTIONS.map((option) => (
              <DropdownMenuRadioItem
                key={option.id}
                value={option.id}
                className={cn(
                  'rounded-lg px-3 py-2 text-sm',
                  option.id === activeOption.id &&
                    'bg-primary/10 text-primary-text focus:bg-primary/10 focus:text-primary-text'
                )}
              >
                <span className="font-medium">{option.label}</span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
