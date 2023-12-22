import getConfig from 'next/config'
import { NextRequest } from 'next/server'

import { headerHost } from '../../../../../../lib/services/guards/headerHost'

export const allowOrigin = (request: NextRequest) => {
  if (process.env.NODE_ENV !== 'production') return '*'

  const defaultAllowOrigin = `https://${getConfig().host}`
  const requestHost = headerHost(request.headers)
  if (!requestHost || Array.isArray(requestHost)) return defaultAllowOrigin

  const allowMediaDomains = getConfig().allowMediaDomains || []
  if (!allowMediaDomains.includes(requestHost)) {
    return defaultAllowOrigin
  }

  return `https://${requestHost}`
}
