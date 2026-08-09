import { Database } from '@/lib/database/types'
import { Status } from '@/lib/types/domain/status'
import { urlToId } from '@/lib/utils/urlToId'

/**
 * Translates pagination boundary values — which are ActivityPub status URIs,
 * the currency of the SQL layer — into the ids clients actually page with.
 *
 * The id a client sends back must be the id it was shown, so a boundary status
 * resolves to the same value its serialized entity carries: its `publicId`.
 * Statuses on the page answer for free; a boundary that is NOT on the page (the
 * timeline builders fall back to the last SCANNED status id when a filter
 * emptied the window, so the cursor can be a status the client never saw) is
 * resolved in ONE batched query rather than one per cursor.
 *
 * A status with no `publicId` — a row written before the backfill landed, or an
 * ActivityPub-derived object that never had one — falls back to the legacy
 * colon form. That is still a valid cursor: the accept side resolves both forms.
 *
 * Returns a result array index-aligned with `uris`, with `null` preserved so
 * callers can keep using it as their "no cursor" signal.
 */
export const getClientStatusCursors = async (
  database: Pick<Database, 'getStatusPublicIds'>,
  statuses: Status[],
  uris: (string | null)[]
): Promise<(string | null)[]> => {
  const publicIdOnPage = new Map<string, string | null>()
  for (const status of statuses) {
    publicIdOnPage.set(status.id, status.publicId ?? null)
  }

  const offPageUris: string[] = []
  for (const uri of uris) {
    if (uri && !publicIdOnPage.has(uri)) offPageUris.push(uri)
  }
  const publicIdOffPage =
    offPageUris.length > 0
      ? await database.getStatusPublicIds({ statusIds: offPageUris })
      : new Map<string, string>()

  return uris.map((uri) => {
    if (!uri) return null
    const publicId = publicIdOnPage.has(uri)
      ? publicIdOnPage.get(uri)
      : publicIdOffPage.get(uri)
    return publicId ?? urlToId(uri)
  })
}
