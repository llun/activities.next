import { getCompatibleJSON } from '@/lib/database/sql/utils/getCompatibleJSON'

export type ParsedStatusContent = string | Record<string, unknown> | null

const isParsedStatusContent = (
  value: unknown
): value is Exclude<ParsedStatusContent, null> =>
  typeof value === 'string' || (value !== null && typeof value === 'object')

export const parseStatusContent = (content: unknown): ParsedStatusContent => {
  if (!content) return null
  if (typeof content === 'string') {
    try {
      const parsed = getCompatibleJSON<unknown>(content)
      return isParsedStatusContent(parsed) ? parsed : null
    } catch {
      return content
    }
  }
  return isParsedStatusContent(content) ? content : null
}
