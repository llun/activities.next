import { NextResponse } from 'next/server'

import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import { defaultOptions } from '@/lib/utils/response'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const GET = async () => {
  return NextResponse.json(
    {
      accounts: [],
      statuses: [],
      hashtags: []
    },
    { status: 200 }
  )
}
