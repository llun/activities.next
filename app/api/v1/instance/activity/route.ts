import { getDatabase } from '@/lib/database'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  ERROR_500,
  HTTP_STATUS,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const GET = traceApiRoute('getInstanceActivity', async (req) => {
  const database = getDatabase()
  if (!database) {
    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: ERROR_500,
      responseStatusCode: HTTP_STATUS.INTERNAL_SERVER_ERROR
    })
  }

  let data
  try {
    data = await database.getInstanceActivity()
  } catch {
    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: ERROR_500,
      responseStatusCode: HTTP_STATUS.INTERNAL_SERVER_ERROR
    })
  }

  return apiResponse({
    req,
    allowedMethods: CORS_HEADERS,
    data,
    additionalHeaders: [['Cache-Control', 'public, max-age=3600']]
  })
})
