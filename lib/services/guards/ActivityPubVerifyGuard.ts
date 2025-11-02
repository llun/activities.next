import { NextRequest } from 'next/server'

import { getDatabase } from '@/lib/database'
import { apiErrorResponse } from '@/lib/utils/response'
import { parse, verify } from '@/lib/utils/signature'

import { getSenderPublicKey } from './getSenderPublicKey'
import { headerHost } from './headerHost'
import { ActivityPubVerifiedSenderHandle, AppRouterParams } from './types'

export const ActivityPubVerifySenderGuard =
  <P>(handle: ActivityPubVerifiedSenderHandle<P>) =>
  async (request: NextRequest, context: AppRouterParams<P>) => {
    const database = getDatabase()
    if (!database) return apiErrorResponse(500)

    const requestSignature = request.headers.get('signature')
    if (!requestSignature) return apiErrorResponse(400)

    const signatureParts = await parse(requestSignature)
    if (!signatureParts.keyId) return apiErrorResponse(400)

    const host = headerHost(request.headers)
    const requestUrl = new URL(request.url, `http://${host}`)
    const publicKey = await getSenderPublicKey(database, signatureParts.keyId)
    if (
      !(await verify(
        `${request.method.toLowerCase()} ${requestUrl.pathname}`,
        request.headers,
        publicKey
      ))
    ) {
      return apiErrorResponse(400)
    }

    return handle(request, { database, params: context.params })
  }
