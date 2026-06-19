import { getBaseURL } from '@/lib/config'
import { getKnex } from '@/lib/database'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { HttpMethod } from '@/lib/utils/http-headers'
import { apiErrorResponse, apiResponse } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

export const dynamic = 'force-dynamic'

type PasskeyRow = {
  id: string
  name: string | null
  rpID: string | null
  deviceType: string
  backedUp: boolean | number | null
  createdAt: string | Date
  aaguid: string | null
}

// List the signed-in account's passkeys, each labelled with the domain it was
// created on. better-auth's own list endpoint does not expose the rpID, so this
// reads the column directly. Rows created before multi-domain support (rpID is
// null) are attributed to the primary host, which is where they were registered.
export const GET = traceApiRoute(
  'listPasskeys',
  AuthenticatedGuard(async (req, { currentActor }) => {
    const account = currentActor.account
    if (!account) return apiErrorResponse(403)

    const primaryDomain = new URL(getBaseURL()).hostname
    const rows: PasskeyRow[] = await getKnex()('passkey')
      .where('userId', account.id)
      .select(
        'id',
        'name',
        'rpID',
        'deviceType',
        'backedUp',
        'createdAt',
        'aaguid'
      )
      .orderBy('createdAt', 'asc')

    const data = rows.map((row) => ({
      id: row.id,
      name: row.name ?? null,
      domain: row.rpID || primaryDomain,
      deviceType: row.deviceType,
      backedUp: Boolean(row.backedUp),
      createdAt:
        row.createdAt instanceof Date
          ? row.createdAt.toISOString()
          : row.createdAt,
      aaguid: row.aaguid ?? null
    }))

    return apiResponse({
      req,
      allowedMethods: [HttpMethod.enum.GET],
      data
    })
  })
)
