import { NextRequest } from 'next/server'

import { ERROR_400, ERROR_500, defaultStatusOption } from '@/lib/errors'
import { getStorage } from '@/lib/storage'
import { parse, verify } from '@/lib/utils/signature'

import { getSenderPublicKey } from './getSenderPublicKey'
import { headerHost } from './headerHost'
import { ActivityPubVerifiedSenderHandle, AppRouterParams } from './types'

export const ActivityPubVerifySenderGuard =
  <P>(handle: ActivityPubVerifiedSenderHandle<P>) =>
    async (request: NextRequest, params?: AppRouterParams<P>) => {
      const storage = await getStorage()
      if (!storage) {
        return Response.json(ERROR_500, defaultStatusOption(500))
      }

      const requestSignature = request.headers.get('signature')
      if (!requestSignature) {
        return Response.json(ERROR_400, defaultStatusOption(400))
      }

      const signatureParts = await parse(requestSignature)
      if (!signatureParts.keyId) {
        return Response.json(ERROR_400, defaultStatusOption(400))
      }

      const host = headerHost(request.headers)
      const requestUrl = new URL(request.url, `http://${host}`)
      const publicKey = await getSenderPublicKey(storage, signatureParts.keyId)
      if (
        !verify(
          `${request.method.toLowerCase()} ${requestUrl.pathname}`,
          request.headers,
          publicKey
        )
      ) {
        return Response.json(ERROR_400, defaultStatusOption(400))
      }

      return handle(request, { storage }, params)
    }
