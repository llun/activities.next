import type {
  FitnessRecords,
  FitnessRecordsRange
} from '@/lib/fitness/bestEfforts'

import { parseApiError } from './http'

export const getFitnessRecords = async (
  range: FitnessRecordsRange
): Promise<FitnessRecords> => {
  const response = await fetch(
    `/api/v1/fitness/records?range=${encodeURIComponent(range)}`,
    { method: 'GET', headers: { Accept: 'application/json' } }
  )
  if (!response.ok) {
    throw new Error(await parseApiError(response, 'Failed to load records.'))
  }
  return (await response.json()) as FitnessRecords
}
