'use client'

import { type FC } from 'react'

import { GalleryFilterChip } from '@/lib/components/gallery/filters/GalleryFilterChip'
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
      <GalleryFilterChip
        label={label}
        active={active}
        activeLabel={activeLabel}
        inactiveTriggerText={`Any ${kind}`}
        triggerAriaLabel={triggerLabel}
        clearAriaLabel={`Clear ${activeLabel} filter`}
        onClear={onClear}
        renderTrigger={(trigger) => (
          <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
        )}
      />

      <DropdownMenuContent align="start">
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
