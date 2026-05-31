import { NextRequest } from 'next/server'

const FORM_URL_ENCODED_CONTENT_TYPE = 'application/x-www-form-urlencoded'
const MULTIPART_FORM_DATA_CONTENT_TYPE = 'multipart/form-data'

// Repeated form keys can arrive as either `languages[]` (Rails/Mastodon
// convention) or bare `languages`; collect both.
const LANGUAGE_FIELDS = ['languages', 'languages[]'] as const

const collectFollowFields = (
  get: (name: string) => unknown,
  getAll: (name: string) => unknown[],
  has: (name: string) => boolean
): Record<string, unknown> => {
  const body: Record<string, unknown> = {}

  const reblogs = get('reblogs')
  if (reblogs !== null && reblogs !== undefined) body.reblogs = reblogs

  const notify = get('notify')
  if (notify !== null && notify !== undefined) body.notify = notify

  // Distinguish an explicitly-present (possibly empty) languages list from an
  // absent one: a present empty list means "clear the filter", while an absent
  // field means "leave it unchanged".
  if (LANGUAGE_FIELDS.some((field) => has(field))) {
    body.languages = LANGUAGE_FIELDS.flatMap((field) => getAll(field))
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
  }

  return body
}

/**
 * Parses a POST /accounts/:id/follow request body across the content types
 * native Mastodon clients use: JSON, application/x-www-form-urlencoded, and
 * multipart/form-data. Only the fields the client actually sent are returned
 * (omit-if-absent), so re-following with one preference does not reset the
 * others. Repeated `languages[]` entries are preserved via getAll — flattening
 * (e.g. Object.fromEntries) would drop all but the last.
 *
 * A malformed JSON body is NOT swallowed: req.json() rejects and the caller is
 * expected to translate that into a 4xx, rather than silently treating a bad
 * request as a paramless follow.
 */
export const parseFollowRequestBody = async (
  req: NextRequest
): Promise<Record<string, unknown>> => {
  const contentType = req.headers.get('content-type')?.toLowerCase() ?? ''

  if (contentType.includes(FORM_URL_ENCODED_CONTENT_TYPE)) {
    const params = new URLSearchParams(await req.text())
    return collectFollowFields(
      (name) => params.get(name),
      (name) => params.getAll(name),
      (name) => params.has(name)
    )
  }

  if (contentType.includes(MULTIPART_FORM_DATA_CONTENT_TYPE)) {
    const form = await req.formData()
    return collectFollowFields(
      (name) => form.get(name),
      (name) => form.getAll(name),
      (name) => form.has(name)
    )
  }

  if (contentType.includes('application/json')) {
    // An empty body (a paramless follow that still carries a default
    // application/json header) is a valid default follow → {}. A non-empty
    // malformed body still throws so the route returns 422.
    const text = await req.text()
    if (text.trim() === '') return {}
    const json = JSON.parse(text) as Record<string, unknown>
    // A well-formed but non-object JSON body (null, a number, a string, an
    // array) has no follow fields; treat it as empty rather than letting the
    // `in`/index access below throw.
    if (!json || typeof json !== 'object' || Array.isArray(json)) {
      return {}
    }
    return collectFollowFields(
      (name) => json[name],
      (name) => {
        const value = json[name]
        if (Array.isArray(value)) return value
        return value === null || value === undefined ? [] : [value]
      },
      (name) => name in json
    )
  }

  // No body or an unrecognized content type: nothing to parse.
  return {}
}
