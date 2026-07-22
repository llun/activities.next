import { NextRequest } from 'next/server'

import { handleAdminAccountStateChange } from '@/lib/services/admin/handleAdminAccountStateChange'
import { AdminApiGuard } from '@/lib/services/guards/AdminApiGuard'
import { HttpMethod } from '@/lib/utils/http-headers'
import { defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

type Params = { id: string }

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const POST = traceApiRoute(
  'adminUnsensitiveAccount',
  AdminApiGuard<Params>(
    CORS_HEADERS,
    async (req: NextRequest, { database, params, moderator }) => {
      const { id } = await params
      return handleAdminAccountStateChange({
        req,
        database,
        id,
        moderator,
        action: 'unsensitive',
        allowedMethods: CORS_HEADERS
      })
    },
    { resource: 'accounts' }
  )
)
