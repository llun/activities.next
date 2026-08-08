import { z } from 'zod'

// Upper bound on how many notification requests a single bulk accept/dismiss
// may name. Mastodon does not document a cap; this matches the other batch
// ceilings in the API surface (MAX_BATCH_STATUSES, MAX_COLLECTION_ACCOUNT_IDS)
// so one request can't drive an unbounded number of lookups. An over-cap body
// fails safeParse, which the routes answer with a 422.
export const MAX_BULK_NOTIFICATION_REQUEST_IDS = 100

// Mastodon sends ids under `id[]` (array) or `id` (single string or array).
const normalizeIds = (v: string | string[] | undefined) =>
  v === undefined ? [] : Array.isArray(v) ? v : [v]

const IdsField = z.union([
  z.string(),
  z.array(z.string()).max(MAX_BULK_NOTIFICATION_REQUEST_IDS)
])

// Shared by the bulk accept and dismiss routes so their parsing — and their
// cap — cannot drift apart.
export const BulkNotificationRequestIdsBody = z
  .object({
    id: IdsField.optional(),
    'id[]': IdsField.optional()
  })
  .transform((value) => normalizeIds(value.id ?? value['id[]']))
