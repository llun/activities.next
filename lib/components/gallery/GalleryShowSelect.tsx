'use client'

import { Check, ChevronDown } from 'lucide-react'
import { FC } from 'react'

import { Button } from '@/lib/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/lib/components/ui/dropdown-menu'
import type { GalleryShow } from '@/lib/types/database/gallery'
import { cn } from '@/lib/utils'

interface ShowOption {
  id: GalleryShow
  label: string
  /** One line that tells the options apart without opening anything. */
  hint: string
}

export const GALLERY_SHOW_OPTIONS: ShowOption[] = [
  {
    id: 'all',
    label: 'Everything',
    hint: 'Photos and videos you’ve posted or added'
  },
  {
    id: 'in_gallery',
    label: 'In gallery',
    hint: 'Posted and shown in your gallery'
  },
  {
    id: 'hidden',
    label: 'Hidden from gallery',
    hint: 'Posted, with Show in my gallery switched off'
  }
]

interface Props {
  value: GalleryShow
  onChange: (show: GalleryShow) => void
  className?: string
}

/**
 * The owner's "Show" filter for All media, drawn like the Category select
 * beside it (`SectionNavSelect`): an outline trigger over a menu whose current
 * row takes the orange wash. The trigger reads "Show <choice>", and every row
 * carries a one-line hint, so the options are told apart without opening
 * anything.
 */
export const GalleryShowSelect: FC<Props> = ({
  value,
  onChange,
  className
}) => {
  const active =
    GALLERY_SHOW_OPTIONS.find((option) => option.id === value) ??
    GALLERY_SHOW_OPTIONS[0]

  return (
    <nav aria-label="Show" className={cn('w-full sm:max-w-[260px]', className)}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            className="h-10 w-full justify-between rounded-lg"
          >
            <span>
              <span className="text-muted-foreground font-normal">Show</span>{' '}
              {active.label}
            </span>
            <ChevronDown className="text-muted-foreground size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          sideOffset={6}
          className="w-(--radix-dropdown-menu-trigger-width) min-w-64 rounded-xl shadow-lg"
        >
          {GALLERY_SHOW_OPTIONS.map((option) => {
            const isActive = option.id === active.id
            return (
              <DropdownMenuItem
                key={option.id}
                onSelect={() => onChange(option.id)}
                aria-current={isActive ? 'true' : undefined}
                className={cn(
                  'flex w-full items-start gap-2.5 rounded-lg px-3 py-2',
                  isActive &&
                    'bg-primary/10 text-primary-text focus:bg-primary/10 focus:text-primary-text focus:ring-primary/50 dark:focus:bg-primary/10 focus:ring-2'
                )}
              >
                <Check
                  className={cn(
                    'mt-0.5 size-4 shrink-0',
                    isActive ? 'text-primary' : 'invisible'
                  )}
                  aria-hidden="true"
                />
                <span className="min-w-0">
                  <span className="block font-medium">{option.label}</span>
                  <span
                    className={cn(
                      'block text-xs font-normal',
                      isActive
                        ? 'text-primary-text/80'
                        : 'text-muted-foreground'
                    )}
                  >
                    {option.hint}
                  </span>
                </span>
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </nav>
  )
}
