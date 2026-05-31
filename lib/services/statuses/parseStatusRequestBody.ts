import { NextRequest } from 'next/server'

const FORM_URL_ENCODED_CONTENT_TYPE = 'application/x-www-form-urlencoded'
const MULTIPART_FORM_DATA_CONTENT_TYPE = 'multipart/form-data'

const STATUS_STRING_FIELDS = [
  'status',
  'in_reply_to_id',
  'spoiler_text',
  'visibility'
] as const

const MEDIA_ID_FIELDS = ['media_ids', 'media_ids[]'] as const

const collectStatusFields = (
  get: (name: string) => unknown,
  getAll: (name: string) => unknown[]
): Record<string, unknown> => {
  const body: Record<string, unknown> = {}

  for (const field of STATUS_STRING_FIELDS) {
    const value = get(field)
    if (typeof value === 'string') body[field] = value
  }

  const rawMediaIds = MEDIA_ID_FIELDS.flatMap((field) => getAll(field)).filter(
    (value): value is string => typeof value === 'string'
  )
  // Distinguish "client did not mention media_ids" (omit → preserve existing
  // media on edit) from "client sent an explicit, possibly empty media_ids"
  // (e.g. `media_ids[]=` to clear all attachments). Only the latter sets the
  // key, so a form client can clear media just as a JSON `media_ids: []` does.
  if (rawMediaIds.length > 0) {
    body.media_ids = rawMediaIds
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
  }

  return body
}

/**
 * Parses a status create/edit request body across the content types native
 * Mastodon clients use: JSON, application/x-www-form-urlencoded, and
 * multipart/form-data. Only the fields the client actually sent are returned,
 * so an edit request never clobbers columns it did not mention; the caller's
 * Zod schema applies any defaults. Repeated `media_ids[]` entries are preserved
 * via getAll — flattening (e.g. Object.fromEntries) would drop all but the last.
 */
export const parseStatusRequestBody = async (
  req: NextRequest
): Promise<Record<string, unknown>> => {
  const contentType = req.headers.get('content-type')?.toLowerCase() ?? ''

  if (contentType.includes(FORM_URL_ENCODED_CONTENT_TYPE)) {
    const params = new URLSearchParams(await req.text())
    return collectStatusFields(
      (name) => params.get(name),
      (name) => params.getAll(name)
    )
  }

  if (contentType.includes(MULTIPART_FORM_DATA_CONTENT_TYPE)) {
    const form = await req.formData()
    return collectStatusFields(
      (name) => form.get(name),
      (name) => form.getAll(name)
    )
  }

  // JSON (the spec default for many clients) or an unlabeled body: defer to the
  // caller's schema for validation. An empty body parses to an empty object.
  const text = await req.text()
  if (text.trim() === '') return {}
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    return {}
  }
}
