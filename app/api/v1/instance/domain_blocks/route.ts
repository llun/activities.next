import { traceApiRoute } from '@/lib/utils/traceApiRoute'

export const runtime = 'nodejs'

export const GET = traceApiRoute('getInstanceDomainBlocks', async () => {
  return Response.json([])
})
