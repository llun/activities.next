import { getBaseURL } from '@/lib/config'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { HttpMethod } from '@/lib/utils/http-headers'
import { apiErrorResponse, apiResponse } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

export const dynamic = 'force-dynamic'

// The query reads `createdAt` as epoch milliseconds on both backends (a SQLite
// zone-less `YYYY-MM-DD HH:MM:SS` value is taken as UTC there), so this is a
// stable ISO-8601 UTC string. A stored value that is not a date at all reads
// back as NaN; it is reported as null rather than failing the whole list.
const toIsoCreatedAt = (createdAt: number): string | null => {
  const date = new Date(createdAt)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

// List the signed-in account's passkeys, each labelled with the domain it was
// created on. better-auth's own list endpoint does not expose the rpID, so this
// reads the column directly. Rows created before multi-domain support (rpID is
// null) are attributed to the primary host, which is where they were registered.
export const GET = traceApiRoute(
  'listPasskeys',
  AuthenticatedGuard(async (req, { currentActor, database }) => {
    const account = currentActor.account
    if (!account) return apiErrorResponse(403)

    const primaryDomain = new URL(getBaseURL()).hostname
    const rows = await database.getAccountPasskeys({ accountId: account.id })

    const data = rows.map((row) => ({
      id: row.id,
      name: row.name ?? null,
      domain: row.rpID || primaryDomain,
      deviceType: row.deviceType,
      backedUp: row.backedUp,
      createdAt: toIsoCreatedAt(row.createdAt),
      aaguid: row.aaguid ?? null
    }))

    return apiResponse({
      req,
      allowedMethods: [HttpMethod.enum.GET],
      data
    })
  })
)
