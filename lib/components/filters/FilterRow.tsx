'use client'

import { Filter as FilterIcon, Pencil, Trash2 } from 'lucide-react'
import { FC } from 'react'

import type { ClientFilter } from '@/lib/client'
import { Button } from '@/lib/components/ui/button'
import type { FilterContext } from '@/lib/types/domain/filter'
import { cn } from '@/lib/utils'

import {
  CONTEXT_SHORT,
  FILTER_CONTEXTS,
  formatExpiry,
  isFilterExpired
} from './filterConstants'

type BadgeTone = 'orange' | 'red' | 'gray'

const BADGE_TONE_CLASSES: Record<BadgeTone, string> = {
  orange: 'bg-[hsl(24_95%_46%/0.12)] text-[hsl(24_95%_40%)]',
  red: 'bg-[hsl(0_84.2%_60.2%/0.12)] text-[hsl(0_72%_45%)]',
  gray: 'bg-[hsl(0_0%_94%)] text-[hsl(0_0%_35%)]'
}

const Badge: FC<{ tone: BadgeTone; children: string }> = ({
  tone,
  children
}) => (
  <span
    className={cn(
      'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
      BADGE_TONE_CLASSES[tone]
    )}
  >
    {children}
  </span>
)

const ContextChips: FC<{ context: FilterContext[] }> = ({ context }) => {
  const showsEverywhere = context.length === FILTER_CONTEXTS.length
  const labels = showsEverywhere
    ? ['Everywhere']
    : context.map((value) => CONTEXT_SHORT[value])
  return (
    <span className="inline-flex flex-wrap gap-1">
      {labels.map((label) => (
        <span
          key={label}
          className="inline-flex items-center rounded-full bg-[hsl(0_0%_94%)] px-2 py-0.5 text-[11px] font-medium text-[hsl(0_0%_35%)]"
        >
          {label}
        </span>
      ))}
    </span>
  )
}

interface FilterRowProps {
  filter: ClientFilter
  currentTime: number
  onEdit: () => void
  onDelete: () => void
  deleting?: boolean
}

export const FilterRow: FC<FilterRowProps> = ({
  filter,
  currentTime,
  onEdit,
  onDelete,
  deleting = false
}) => {
  const keywordCount = filter.keywords.length
  const expired = isFilterExpired(filter.expires_at, currentTime)

  return (
    <div className="flex items-center gap-3 rounded-lg border p-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <FilterIcon className="size-[17px]" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium">{filter.title}</span>
          {filter.filter_action === 'hide' ? (
            <Badge tone="red">Hide completely</Badge>
          ) : (
            <Badge tone="orange">Hide with warning</Badge>
          )}
          {expired && <Badge tone="gray">Expired</Badge>}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span>
            {keywordCount} {keywordCount === 1 ? 'keyword' : 'keywords'}
          </span>
          <span aria-hidden="true">·</span>
          <ContextChips context={filter.context} />
          <span aria-hidden="true">·</span>
          <span>{formatExpiry(filter.expires_at, currentTime)}</span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={onEdit}
          // Freeze edits while any delete is in flight so a failed-delete
          // rollback can't discard a concurrent edit/create.
          disabled={deleting}
        >
          <Pencil className="size-3.5" />
          Edit
        </Button>
        <button
          type="button"
          aria-label={`Delete filter ${filter.title}`}
          onClick={onDelete}
          disabled={deleting}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[hsl(0_84.2%_60.2%/0.4)] text-[hsl(0_72%_45%)] transition-colors hover:bg-[hsl(0_72%_45%/0.08)] disabled:pointer-events-none disabled:opacity-50"
        >
          <Trash2 className="size-[15px]" />
        </button>
      </div>
    </div>
  )
}
