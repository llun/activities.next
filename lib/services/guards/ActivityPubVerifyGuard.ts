import { NextRequest } from 'next/server'

import { getStorage } from '@/lib/storage'
import { apiErrorResponse } from '@/lib/utils/response'
import { parse, verify } from '@/lib/utils/signature'

import { getSenderPublicKey } from './getSenderPublicKey'
import { headerHost } from './headerHost'
import { ActivityPubVerifiedSenderHandle, AppRouterParams } from './types'

export const ActivityPubVerifySenderGuard =
  <P>(handle: ActivityPubVerifiedSenderHandle<P>) =>
  async (request: NextRequest, params: AppRouterParams<P>) => {
    const storage = await getStorage()
    if (!storage) return apiErrorResponse(500)

    const requestSignature = request.headers.get('signature')
    if (!requestSignature) return apiErrorResponse(400)

    const signatureParts = await parse(requestSignature)
    if (!signatureParts.keyId) return apiErrorResponse(400)

    const host = headerHost(request.headers)
    const requestUrl = new URL(request.url, `http://${host}`)
    const publicKey = await getSenderPublicKey(storage, signatureParts.keyId)
    if (
      !(await verify(
        `${request.method.toLowerCase()} ${requestUrl.pathname}`,
        request.headers,
        publicKey
      ))
    ) {
      return apiErrorResponse(400)
    }

    return handle(request, { storage }, params)
  }
