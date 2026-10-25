'use client'

import { ChevronDown, X } from 'lucide-react'
import { type FC } from 'react'

import { Button } from '@/lib/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/lib/components/ui/dropdown-menu'
import type { FilterContext } from '@/lib/types/domain/filter'
import { cn } from '@/lib/utils'

import {
  SERVER_FILTER_ACTION_OPTIONS,
  SERVER_FILTER_CONTEXT_OPTIONS,
  SERVER_FILTER_STATUS_OPTIONS,
  type ServerFilterSelection
} from './serverFilterControls'

type FilterMenuKind = 'action' | 'context' | 'status'

interface ServerFilterMenuProps {
  kind: FilterMenuKind
  selection: ServerFilterSelection
  onChange: (selection: ServerFilterSelection) => void
  onClear: () => void
}

const LABELS: Record<FilterMenuKind, string> = {
  action: 'Action',
  context: 'Context',
  status: 'Status'
}

export const ServerFilterMenu: FC<ServerFilterMenuProps> = ({
  kind,
  selection,
  onChange,
  onClear
}) => {
  const label = LABELS[kind]
  const active =
    kind === 'action'
      ? selection.action !== 'any'
      : kind === 'context'
        ? selection.contexts.length > 0
        : selection.status !== 'any'

  const activeLabel =
    kind === 'action'
      ? (SERVER_FILTER_ACTION_OPTIONS.find(
          (option) => option.value === selection.action
        )?.label ?? 'Any')
      : kind === 'context'
        ? SERVER_FILTER_CONTEXT_OPTIONS.filter((option) =>
            selection.contexts.includes(option.value)
          )
            .map((option) => option.label)
            .join(', ') || 'Any'
        : (SERVER_FILTER_STATUS_OPTIONS.find(
            (option) => option.value === selection.status
          )?.label ?? 'Any')

  const triggerLabel = active ? `${label}: ${activeLabel}` : `Any ${kind}`

  return (
    <DropdownMenu>
      <div
        role={active ? 'group' : undefined}
        aria-label={active ? `${label} filter` : undefined}
        className={cn(
          'inline-flex h-10 items-stretch rounded-lg',
          active &&
            'border-primary bg-primary/10 text-primary-text border text-sm font-medium shadow-xs transition-colors'
        )}
      >
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant={active ? 'ghost' : 'outline'}
            aria-label={triggerLabel}
            className={cn(
              'h-full justify-between gap-2 rounded-lg font-normal',
              active &&
                'hover:bg-primary/15 hover:text-primary-text gap-1.5 rounded-r-none px-3 font-medium text-primary-text'
            )}
          >
            <span className={cn('truncate', active && 'max-w-[260px]')}>
              {triggerLabel}
            </span>
            <ChevronDown
              aria-hidden="true"
              className={cn(
                'size-4 shrink-0',
                active ? 'text-primary' : 'text-muted-foreground'
              )}
            />
          </Button>
        </DropdownMenuTrigger>
        {active ? (
          <>
            <div className="bg-primary/20 my-1.5 w-px" aria-hidden="true" />
            <button
              type="button"
              aria-label={`Clear ${kind} filter`}
              onClick={(event) => {
                event.stopPropagation()
                onClear()
              }}
              className="hover:bg-primary/20 focus-visible:ring-primary/50 flex items-center justify-center rounded-r-lg px-2.5 py-2 focus-visible:ring-2 focus-visible:outline-none"
            >
              <X className="text-primary size-3.5 shrink-0" />
            </button>
          </>
        ) : null}
      </div>

      <DropdownMenuContent align="start" aria-label={`${label} filter`}>
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        {kind === 'action' ? (
          <DropdownMenuRadioGroup
            value={selection.action}
            onValueChange={(action) =>
              onChange({
                ...selection,
                action: action as ServerFilterSelection['action']
              })
            }
          >
            {SERVER_FILTER_ACTION_OPTIONS.map((option) => (
              <DropdownMenuRadioItem key={option.value} value={option.value}>
                {option.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        ) : null}

        {kind === 'context' ? (
          <>
            <DropdownMenuSeparator />
            {SERVER_FILTER_CONTEXT_OPTIONS.map((option) => (
              <DropdownMenuCheckboxItem
                key={option.value}
                checked={selection.contexts.includes(option.value)}
                onCheckedChange={(checked) => {
                  const contexts = checked
                    ? [...selection.contexts, option.value]
                    : selection.contexts.filter(
                        (context: FilterContext) => context !== option.value
                      )
                  onChange({ ...selection, contexts })
                }}
                onSelect={(event) => event.preventDefault()}
              >
                {option.label}
              </DropdownMenuCheckboxItem>
            ))}
          </>
        ) : null}

        {kind === 'status' ? (
          <DropdownMenuRadioGroup
            value={selection.status}
            onValueChange={(status) =>
              onChange({
                ...selection,
                status: status as ServerFilterSelection['status']
              })
            }
          >
            {SERVER_FILTER_STATUS_OPTIONS.map((option) => (
              <DropdownMenuRadioItem key={option.value} value={option.value}>
                {option.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
