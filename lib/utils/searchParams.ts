import { z } from 'zod'

const TRUE_VALUES = new Set(['true', '1', 't', 'yes', 'y', 'on'])
const FALSE_VALUES = new Set(['false', '0', 'f', 'no', 'n', 'off'])

export const BooleanSearchParam = z
  .string()
  .optional()
  .transform((value, ctx) => {
    if (value === undefined) return undefined

    const normalizedValue = value.trim().toLowerCase()
    if (TRUE_VALUES.has(normalizedValue)) return true
    if (FALSE_VALUES.has(normalizedValue)) return false

    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Invalid boolean search parameter'
    })
    return z.NEVER
  })

export const urlSearchParamsToObject = (
  searchParams: URLSearchParams
): Record<string, string> => Object.fromEntries(searchParams.entries())
