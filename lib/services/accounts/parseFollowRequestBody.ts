import { NextRequest } from 'next/server'

const FORM_URL_ENCODED_CONTENT_TYPE = 'application/x-www-form-urlencoded'
const MULTIPART_FORM_DATA_CONTENT_TYPE = 'multipart/form-data'

// Repeated form keys can arrive as either `languages[]` (Rails/Mastodon
// convention) or bare `languages`; collect both.
const LANGUAGE_FIELDS = ['languages', 'languages[]'] as const

const collectFollowFields = (
  get: (name: string) => unknown,
  getAll: (name: string) => unknown[]
): Record<string, unknown> => {
  const body: Record<string, unknown> = {}

  const reblogs = get('reblogs')
  if (reblogs !== null && reblogs !== undefined) body.reblogs = reblogs

  const notify = get('notify')
  if (notify !== null && notify !== undefined) body.notify = notify

  const languages = LANGUAGE_FIELDS.flatMap((field) => getAll(field))
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
  if (languages.length > 0) body.languages = languages

  return body
}

/**
 * Parses a POST /accounts/:id/follow request body across the content types
 * native Mastodon clients use: JSON, application/x-www-form-urlencoded, and
 * multipart/form-data. Only the fields the client actually sent are returned
 * (omit-if-absent), so re-following with one preference does not reset the
 * others. Repeated `languages[]` entries are preserved via getAll — flattening
 * (e.g. Object.fromEntries) would drop all but the last.
 */
export const parseFollowRequestBody = async (
  req: NextRequest
): Promise<Record<string, unknown>> => {
  const contentType = req.headers.get('content-type')?.toLowerCase() ?? ''

  if (contentType.includes(FORM_URL_ENCODED_CONTENT_TYPE)) {
    const params = new URLSearchParams(await req.text())
    return collectFollowFields(
      (name) => params.get(name),
      (name) => params.getAll(name)
    )
  }

  if (contentType.includes(MULTIPART_FORM_DATA_CONTENT_TYPE)) {
    const form = await req.formData()
    return collectFollowFields(
      (name) => form.get(name),
      (name) => form.getAll(name)
    )
  }

  if (contentType.includes('application/json')) {
    const json = (await req.json().catch(() => ({}))) as Record<string, unknown>
    return collectFollowFields(
      (name) => json[name],
      (name) => {
        const value = json[name]
        if (Array.isArray(value)) return value
        return value === null || value === undefined ? [] : [value]
      }
    )
  }

  // No body or an unrecognized content type: nothing to parse.
  return {}
}
