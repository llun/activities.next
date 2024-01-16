import { NextRequest } from 'next/server'

import { headerHost } from './headerHost'

export const getRedirectUrl = (req: NextRequest, pathName: string) => {
  const host = headerHost(req.headers)
  return new URL(pathName, `https://${host}`).toString()
}
