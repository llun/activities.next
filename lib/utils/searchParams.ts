import { z } from 'zod'

export const BooleanSearchParam = z
  .enum(['true', 'false'])
  .optional()
  .transform((value) => value === 'true')

export const urlSearchParamsToObject = (
  searchParams: URLSearchParams
): Record<string, string> => Object.fromEntries(searchParams.entries())
