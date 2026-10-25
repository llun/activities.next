import type { FilterAction, FilterContext } from '@/lib/types/domain/filter'

import {
  CONTEXT_SHORT,
  FILTER_ACTION_LABELS,
  FILTER_CONTEXTS
} from './filterConstants'

export type ServerFilterAction = FilterAction | 'any'
export type ServerFilterStatus = 'any' | 'active' | 'expired'

export interface ServerFilterSelection {
  action: ServerFilterAction
  contexts: FilterContext[]
  status: ServerFilterStatus
}

export const DEFAULT_SERVER_FILTER_SELECTION: ServerFilterSelection = {
  action: 'any',
  contexts: [],
  status: 'any'
}

export const SERVER_FILTER_ACTION_OPTIONS: {
  value: ServerFilterAction
  label: string
}[] = [
  { value: 'any', label: 'Any' },
  { value: 'warn', label: FILTER_ACTION_LABELS.warn },
  { value: 'blur', label: FILTER_ACTION_LABELS.blur },
  { value: 'hide', label: FILTER_ACTION_LABELS.hide }
]

export const SERVER_FILTER_STATUS_OPTIONS: {
  value: ServerFilterStatus
  label: string
}[] = [
  { value: 'any', label: 'Any' },
  { value: 'active', label: 'Active' },
  { value: 'expired', label: 'Expired' }
]

export const SERVER_FILTER_CONTEXT_OPTIONS = FILTER_CONTEXTS.map(({ id }) => ({
  value: id,
  label: CONTEXT_SHORT[id]
}))

export const countActiveServerFilters = (
  selection: ServerFilterSelection
): number =>
  Number(selection.action !== 'any') +
  Number(selection.contexts.length > 0) +
  Number(selection.status !== 'any')
