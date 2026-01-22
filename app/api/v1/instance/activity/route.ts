import { traceApiRoute } from '@/lib/utils/traceApiRoute'

export const GET = traceApiRoute('getInstanceActivity', async () => {
  return Response.json([])
})
