'use client'

import { SlidersHorizontal } from 'lucide-react'
import { type FC, useState } from 'react'

import { Button } from '@/lib/components/ui/button'

import { ServerFilterMenu } from './ServerFilterMenu'
import { ServerFilterSheet } from './ServerFilterSheet'
import {
  type ServerFilterSelection,
  countActiveServerFilters
} from './serverFilterControls'

interface ServerFilterBarProps {
  selection: ServerFilterSelection
  onChange: (selection: ServerFilterSelection) => void
  onClear: () => void
}

export const ServerFilterBar: FC<ServerFilterBarProps> = ({
  selection,
  onChange,
  onClear
}) => {
  const [sheetOpen, setSheetOpen] = useState(false)
  const activeCount = countActiveServerFilters(selection)

  return (
    <div className="flex flex-col gap-2">
      <div className="hidden flex-wrap items-center gap-2 sm:flex">
        <ServerFilterMenu
          kind="action"
          selection={selection}
          onChange={onChange}
          onClear={() => onChange({ ...selection, action: 'any' })}
        />
        <ServerFilterMenu
          kind="context"
          selection={selection}
          onChange={onChange}
          onClear={() => onChange({ ...selection, contexts: [] })}
        />
        <ServerFilterMenu
          kind="status"
          selection={selection}
          onChange={onChange}
          onClear={() => onChange({ ...selection, status: 'any' })}
        />
        {activeCount > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClear}
            className="h-10"
          >
            Clear filters
          </Button>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-2 sm:hidden">
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setSheetOpen(true)
          }}
          className="h-10 rounded-lg font-normal"
        >
          <SlidersHorizontal className="size-4" aria-hidden="true" />
          {activeCount > 0 ? `Filters · ${activeCount}` : 'Filters'}
        </Button>
        {activeCount > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClear}
            className="h-10"
          >
            Clear filters
          </Button>
        ) : null}
      </div>

      <ServerFilterSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        selection={selection}
        onApply={onChange}
      />
    </div>
  )
}
