import { NextRequest } from 'next/server'

import { Database } from '@/lib/database/types'
import { hydrateAdminAccounts } from '@/lib/services/admin/serializeAdminAccounts'
import { headerHost } from '@/lib/services/guards/headerHost'
import { GetAdminAccountsParams } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { buildPaginationLinkHeader } from '@/lib/utils/paginationLinkHeader'
import { apiResponse } from '@/lib/utils/response'
import { urlToId } from '@/lib/utils/urlToId'

// Shared list responder for both the v1 and v2 admin accounts routes: run the
// keyset query, serialize, and attach the Mastodon Link header. The cursor ids
// are Mastodon ids (urlToId(actor.id)); the client sends them back and the
// route decodes them with safeIdToUrl.
export const listAdminAccountsResponse = async ({
  req,
  database,
  params,
  path,
  allowedMethods
}: {
  req: NextRequest
  database: Database
  params: GetAdminAccountsParams
  path: string
  allowedMethods: HttpMethod[]
}): Promise<Response> => {
  const limit = params.limit ?? 100
  const records = await database.getAdminAccounts(params)
  const entities = await hydrateAdminAccounts(database, records)

  const nextMaxId =
    records.length === limit
      ? urlToId(records[records.length - 1].actor.id)
      : null
  const prevMinId = records.length > 0 ? urlToId(records[0].actor.id) : null

  return apiResponse({
    req,
    allowedMethods,
    data: entities,
    additionalHeaders: buildPaginationLinkHeader({
      host: headerHost(req.headers),
      path,
      limit,
      nextMaxId,
      prevMinId
    })
  })
}
