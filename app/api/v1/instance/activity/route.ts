import { traceApiRoute } from '@/lib/utils/traceApiRoute'

export const runtime = 'nodejs'

export const GET = traceApiRoute('getInstanceActivity', async () => {
  return Response.json([])
})
