import { NextRequest } from 'next/server'

const FORM_URL_ENCODED_CONTENT_TYPE = 'application/x-www-form-urlencoded'
const MULTIPART_FORM_DATA_CONTENT_TYPE = 'multipart/form-data'

const STATUS_STRING_FIELDS = [
  'status',
  'in_reply_to_id',
  'quoted_status_id',
  'quote_approval_policy',
  'spoiler_text',
  'visibility',
  'language',
  'scheduled_at'
] as const

const MEDIA_ID_FIELDS = ['media_ids', 'media_ids[]'] as const
const POLL_OPTION_FIELDS = ['poll[options][]', 'poll[options]'] as const
const MEDIA_ATTRIBUTE_ID_FIELD = 'media_attributes[][id]'
const MEDIA_ATTRIBUTE_DESCRIPTION_FIELD = 'media_attributes[][description]'
const MEDIA_ATTRIBUTE_FOCUS_FIELD = 'media_attributes[][focus]'

const collectStatusFields = (
  get: (name: string) => unknown,
  getAll: (name: string) => unknown[]
): Record<string, unknown> => {
  const body: Record<string, unknown> = {}

  for (const field of STATUS_STRING_FIELDS) {
    const value = get(field)
    if (typeof value === 'string') body[field] = value
  }

  // `sensitive` is a boolean in JSON but arrives as a string in form bodies.
  const sensitive = get('sensitive')
  if (typeof sensitive === 'string') body.sensitive = sensitive

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

  // Reconstruct the nested `poll` object Mastodon form clients flatten into
  // `poll[options][]`, `poll[expires_in]`, `poll[multiple]`, `poll[hide_totals]`.
  const pollOptions = POLL_OPTION_FIELDS.flatMap((field) =>
    getAll(field)
  ).filter((value): value is string => typeof value === 'string')
  if (pollOptions.length > 0) {
    const poll: Record<string, unknown> = { options: pollOptions }
    const expiresIn = get('poll[expires_in]')
    if (typeof expiresIn === 'string') poll.expires_in = expiresIn
    const multiple = get('poll[multiple]')
    if (typeof multiple === 'string') poll.multiple = multiple
    const hideTotals = get('poll[hide_totals]')
    if (typeof hideTotals === 'string') poll.hide_totals = hideTotals
    body.poll = poll
  }

  // Reconstruct the `media_attributes` array-of-hashes Mastodon form clients
  // flatten into repeated `media_attributes[][id]` / `[][description]` /
  // `[][focus]` fields. With bare `[]` fields the description/focus values
  // associate with ids purely by position, so a partial submission (fewer
  // description/focus values than ids) is ambiguous: apply a field only when
  // EVERY id has a corresponding value, otherwise leave it untouched rather
  // than risk mapping a value to the wrong media. Clients needing per-item
  // control should send a JSON body — the nested array is unambiguous and
  // carries these values natively (skipping this path).
  const mediaAttributeIds = getAll(MEDIA_ATTRIBUTE_ID_FIELD).filter(
    (value): value is string => typeof value === 'string'
  )
  if (mediaAttributeIds.length > 0) {
    const descriptions = getAll(MEDIA_ATTRIBUTE_DESCRIPTION_FIELD).filter(
      (value): value is string => typeof value === 'string'
    )
    const focuses = getAll(MEDIA_ATTRIBUTE_FOCUS_FIELD).filter(
      (value): value is string => typeof value === 'string'
    )
    const alignedDescriptions = descriptions.length === mediaAttributeIds.length
    const alignedFocuses = focuses.length === mediaAttributeIds.length
    body.media_attributes = mediaAttributeIds.map((id, index) => ({
      id,
      ...(alignedDescriptions ? { description: descriptions[index] } : {}),
      ...(alignedFocuses ? { focus: focuses[index] } : {})
    }))
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
  // Let a malformed JSON body throw: both callers wrap this in a try/catch that
  // returns 400, the correct status for unparseable syntax — swallowing it to {}
  // would instead surface as a misleading 422. This also matches the urlencoded
  // and multipart paths, whose parse failures already propagate.
  const parsed: unknown = JSON.parse(text)
  // A well-formed but non-object root (null, array, string, number) is not a
  // status body; normalize it to {} so the Record contract holds and the
  // caller's schema rejects it as unprocessable rather than receiving a primitive.
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {}
  }
  return parsed as Record<string, unknown>
}
