import { toNextJsHandler } from 'better-auth/next-js'

import { getAuth } from '@/lib/services/auth/auth'

export const dynamic = 'force-dynamic'

export const { GET, POST } = toNextJsHandler(getAuth())
