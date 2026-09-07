import type { UserCreatableGearKind } from '@/lib/services/fitness-files/sportTypes'
import type {
  GearComponentEntity,
  GearEntity
} from '@/lib/services/fitness-gears/gearEntities'
import type { Status } from '@/lib/types/domain/status'

import { parseApiError } from './http'

export interface CreateFitnessGearInput {
  // Not `FitnessGearKind`: a device is never created from the client — the
  // import path resolves it from the file's own recorded identity, and the
  // route answers 422 for one.
  kind: UserCreatableGearKind
  name: string
  brand?: string | null
  model?: string | null
  bikeType?: string | null
  weightKilograms?: number | null
  defaultSports?: string[]
  alertDistanceMeters?: number | null
  notes?: string | null
  // The manufacturer's page, linked from the gear's own page. Every kind may
  // carry one; a device's is seeded from the brand map when the import creates
  // the row, and a bike's or a pair of shoes' is typed into the gear form.
  productUrl?: string | null
}

// Every field is optional, matching `UpdateGearRequest`: the PATCH route uses
// presence semantics, so a caller changing one field (the Strava page's default
// gear editor sends only `defaultSports`) leaves every other column alone
// rather than rewriting it from whatever the caller last read. Note the limit —
// this protects the fields a caller OMITS, not the one it sends: a field the
// caller builds by read-modify-write, as that editor does with the
// `defaultSports` array, is still last-write-wins against a concurrent edit of
// the same field. `kind` is immutable and absent by design.
export type UpdateFitnessGearInput = Partial<
  Omit<CreateFitnessGearInput, 'kind'>
>

/**
 * A page of a gear's activity history, as the posts they were published as —
 * the same `Status` shape the timelines render.
 *
 * `nextOffset` counts ACTIVITY ROWS, not the statuses in this page. An activity
 * whose post was deleted keeps counting toward the gear's totals (deleting a
 * status only nulls `fitness_files.statusId`) but has no post left to show, so
 * paging from `statuses.length` would re-request every row in between.
 */
export interface GearActivityStatusesPage {
  statuses: Status[]
  hasMore: boolean
  nextOffset: number
}

export interface CreateFitnessGearComponentInput {
  componentType: string
  brand?: string | null
  model?: string | null
  addedAt?: number | null
  removedAt?: number | null
  serviceDistanceMeters?: number | null
}

export const getFitnessGearList = async (): Promise<GearEntity[]> => {
  const response = await fetch('/api/v1/fitness/gear', {
    method: 'GET',
    headers: { Accept: 'application/json' }
  })
  if (!response.ok) {
    throw new Error(await parseApiError(response, 'Failed to load gear.'))
  }
  const data = (await response.json()) as { gear: GearEntity[] }
  return data.gear
}

export const createFitnessGear = async (
  params: CreateFitnessGearInput
): Promise<GearEntity> => {
  const response = await fetch('/api/v1/fitness/gear', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  })
  if (!response.ok) {
    throw new Error(await parseApiError(response, 'Failed to save gear.'))
  }
  const data = (await response.json()) as { gear: GearEntity }
  return data.gear
}

export const updateFitnessGear = async (
  gearId: string,
  params: UpdateFitnessGearInput
): Promise<GearEntity> => {
  const response = await fetch(
    `/api/v1/fitness/gear/${encodeURIComponent(gearId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    }
  )
  if (!response.ok) {
    throw new Error(await parseApiError(response, 'Failed to save gear.'))
  }
  const data = (await response.json()) as { gear: GearEntity }
  return data.gear
}

export const deleteFitnessGear = async (gearId: string): Promise<void> => {
  const response = await fetch(
    `/api/v1/fitness/gear/${encodeURIComponent(gearId)}`,
    { method: 'DELETE' }
  )
  if (!response.ok) {
    throw new Error(await parseApiError(response, 'Failed to delete gear.'))
  }
}

export const setFitnessGearRetired = async (
  gearId: string,
  retired: boolean
): Promise<GearEntity> => {
  const response = await fetch(
    `/api/v1/fitness/gear/${encodeURIComponent(gearId)}/retire`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ retired })
    }
  )
  if (!response.ok) {
    throw new Error(
      await parseApiError(
        response,
        retired ? 'Failed to retire gear.' : 'Failed to unretire gear.'
      )
    )
  }
  const data = (await response.json()) as { gear: GearEntity }
  return data.gear
}

export const getFitnessGearActivities = async (
  gearId: string,
  { limit, offset }: { limit?: number; offset?: number } = {}
): Promise<GearActivityStatusesPage> => {
  const query = new URLSearchParams()
  if (limit !== undefined) query.set('limit', String(limit))
  if (offset !== undefined) query.set('offset', String(offset))
  const search = query.size > 0 ? `?${query.toString()}` : ''

  const response = await fetch(
    `/api/v1/fitness/gear/${encodeURIComponent(gearId)}/activities${search}`,
    { method: 'GET', headers: { Accept: 'application/json' } }
  )
  if (!response.ok) {
    throw new Error(await parseApiError(response, 'Failed to load activities.'))
  }
  return (await response.json()) as GearActivityStatusesPage
}

export const getFitnessGearComponents = async (
  gearId: string
): Promise<GearComponentEntity[]> => {
  const response = await fetch(
    `/api/v1/fitness/gear/${encodeURIComponent(gearId)}/components`,
    { method: 'GET', headers: { Accept: 'application/json' } }
  )
  if (!response.ok) {
    throw new Error(await parseApiError(response, 'Failed to load components.'))
  }
  const data = (await response.json()) as { components: GearComponentEntity[] }
  return data.components
}

export const createFitnessGearComponent = async (
  gearId: string,
  params: CreateFitnessGearComponentInput
): Promise<GearComponentEntity> => {
  const response = await fetch(
    `/api/v1/fitness/gear/${encodeURIComponent(gearId)}/components`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    }
  )
  if (!response.ok) {
    throw new Error(await parseApiError(response, 'Failed to save component.'))
  }
  const data = (await response.json()) as { component: GearComponentEntity }
  return data.component
}

export const updateFitnessGearComponent = async (
  gearId: string,
  componentId: string,
  params: Partial<CreateFitnessGearComponentInput>
): Promise<GearComponentEntity> => {
  const response = await fetch(
    `/api/v1/fitness/gear/${encodeURIComponent(gearId)}/components/${encodeURIComponent(componentId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    }
  )
  if (!response.ok) {
    throw new Error(await parseApiError(response, 'Failed to save component.'))
  }
  const data = (await response.json()) as { component: GearComponentEntity }
  return data.component
}

export const deleteFitnessGearComponent = async (
  gearId: string,
  componentId: string
): Promise<void> => {
  const response = await fetch(
    `/api/v1/fitness/gear/${encodeURIComponent(gearId)}/components/${encodeURIComponent(componentId)}`,
    { method: 'DELETE' }
  )
  if (!response.ok) {
    throw new Error(
      await parseApiError(response, 'Failed to delete component.')
    )
  }
}

export const retireFitnessGearComponent = async (
  gearId: string,
  componentId: string
): Promise<GearComponentEntity> => {
  const response = await fetch(
    `/api/v1/fitness/gear/${encodeURIComponent(gearId)}/components/${encodeURIComponent(componentId)}/retire`,
    {
      method: 'POST'
    }
  )
  if (!response.ok) {
    throw new Error(
      await parseApiError(response, 'Failed to retire component.')
    )
  }
  const data = (await response.json()) as { component: GearComponentEntity }
  return data.component
}

/**
 * Puts a retired part back on by opening a new install period at today, rather
 * than reopening the closed one — which is why it is its own endpoint and not a
 * `PATCH { removedAt: null }`.
 */
export const refitFitnessGearComponent = async (
  gearId: string,
  componentId: string
): Promise<GearComponentEntity> => {
  const response = await fetch(
    `/api/v1/fitness/gear/${encodeURIComponent(gearId)}/components/${encodeURIComponent(componentId)}/refit`,
    {
      method: 'POST'
    }
  )
  if (!response.ok) {
    throw new Error(await parseApiError(response, 'Failed to refit component.'))
  }
  const data = (await response.json()) as { component: GearComponentEntity }
  return data.component
}

export const updateFitnessFileGear = async (
  fitnessFileId: string,
  gearId: string | null
): Promise<{ id: string; gearId: string | null }> => {
  const response = await fetch(
    `/api/v1/fitness-files/${encodeURIComponent(fitnessFileId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gearId })
    }
  )
  if (!response.ok) {
    throw new Error(await parseApiError(response, 'Failed to update gear.'))
  }
  return (await response.json()) as { id: string; gearId: string | null }
}
