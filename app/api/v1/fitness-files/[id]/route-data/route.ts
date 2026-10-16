import { NextRequest } from 'next/server'

import { getConfig } from '@/lib/config'
import { DEFAULT_FITNESS_MAX_FILE_SIZE } from '@/lib/config/fitnessStorage'
import { SERVICE_NAME } from '@/lib/constants'
import { getDatabase } from '@/lib/database'
import { Database } from '@/lib/database/types'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getFitnessFile } from '@/lib/services/fitness-files'
import {
  PRE_PARSED_ROUTE_DATA_VERSION,
  ROUTE_DATA_RESPONSE_VERSION,
  createPreParsedRouteDataPayload,
  loadPreParsedRouteData,
  resolveRouteDataFromPreParsed,
  savePreParsedRouteData
} from '@/lib/services/fitness-files/fileRouteDataCache'
import {
  isParseableFitnessFileType,
  parseFitnessFile
} from '@/lib/services/fitness-files/parseFitnessFile'
import { getFitnessPrivacyLocations } from '@/lib/services/fitness-files/privacy'
import { FitnessFile } from '@/lib/types/database/fitnessFile'
import { FollowStatus } from '@/lib/types/domain/follow'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { getVisibility } from '@/lib/utils/getVisibility'
import { HttpMethod, getCORSHeaders } from '@/lib/utils/http-headers'
import { logger } from '@/lib/utils/logger'
import {
  ERROR_400,
  ERROR_404,
  ERROR_500,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { readResponseArrayBufferWithLimit } from '@/lib/utils/streamLimit'
import { toLoggableError } from '@/lib/utils/toLoggableError'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

interface Params {
  id: string
}

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

const getFetchResponseErrorDetail = async (
  response: Response
): Promise<string> => {
  const responseText = await response.text().catch(() => '')
  if (!responseText) {
    return response.statusText || 'Unknown fetch error'
  }

  try {
    const parsedError = JSON.parse(responseText) as {
      message?: string
      error?: string
      status?: string
    }
    return (
      parsedError.message ||
      parsedError.error ||
      parsedError.status ||
      responseText
    )
  } catch {
    return responseText
  }
}

const getFitnessFileBuffer = async (
  fitnessFileId: string,
  fileMetadata: FitnessFile,
  database: Database
) => {
  const result = await getFitnessFile(database, fitnessFileId, fileMetadata)
  if (!result) {
    return null
  }

  if (result.type === 'buffer') {
    return result.buffer
  }

  const response = await fetch(result.redirectUrl)
  if (!response.ok) {
    const detail = await getFetchResponseErrorDetail(response)
    throw new Error(
      `Failed to download fitness file from redirect URL (${response.status}): ${detail}`
    )
  }

  return Buffer.from(
    await readResponseArrayBufferWithLimit(
      response,
      getConfig().fitnessStorage?.maxFileSize ??
        fileMetadata.bytes ??
        DEFAULT_FITNESS_MAX_FILE_SIZE,
      'Fitness redirect body'
    )
  )
}

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const GET = traceApiRoute(
  'getFitnessRouteData',
  async (req: NextRequest, context: { params: Promise<Params> }) => {
    const database = getDatabase()
    if (!database) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_500,
        responseStatusCode: 500
      })
    }

    const { id } = await context.params

    try {
      const session = await getServerAuthSession()
      const currentActor = await getActorFromSession(database, session)
      const currentAccountId = currentActor?.account?.id

      const fileMetadata = await database.getFitnessFile({ id })
      if (!fileMetadata) {
        logger.warn({
          message: 'Fitness file not found',
          fileId: id
        })
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: 404
        })
      }

      const fileActor = await database.getActorFromId({
        id: fileMetadata.actorId
      })
      const ownerAccountId = fileActor?.account?.id
      const isOwnerAccount = Boolean(
        currentAccountId && ownerAccountId === currentAccountId
      )
      let isPubliclyAccessible = false

      if (!isOwnerAccount) {
        if (!fileMetadata.statusId) {
          logger.warn({
            message: 'Fitness file not found or not authorized',
            fileId: id,
            actorId: currentActor?.id ?? null,
            accountId: currentAccountId ?? null
          })
          return apiResponse({
            req,
            allowedMethods: CORS_HEADERS,
            data: ERROR_404,
            responseStatusCode: 404
          })
        }

        const status = await database.getStatus({
          statusId: fileMetadata.statusId,
          withReplies: false
        })
        const visibility = status ? getVisibility(status.to, status.cc) : null
        isPubliclyAccessible =
          visibility === 'public' || visibility === 'unlisted'

        let hasAccess = isPubliclyAccessible

        if (status && !hasAccess) {
          if (currentActor?.id === status.actorId) {
            hasAccess = true
          } else {
            const hasFollowersUrl = [...status.to, ...status.cc].some((item) =>
              item.endsWith('/followers')
            )

            if (hasFollowersUrl && currentActor) {
              const follow = await database.getAcceptedOrRequestedFollow({
                actorId: currentActor.id,
                targetActorId: status.actorId
              })
              hasAccess = follow?.status === FollowStatus.enum.Accepted
            } else if (currentActor) {
              hasAccess =
                status.to.includes(currentActor.id) ||
                status.cc.includes(currentActor.id)
            }
          }
        }

        if (!status || !hasAccess) {
          logger.warn({
            message: 'Fitness file not found or not authorized',
            fileId: id,
            actorId: currentActor?.id ?? null,
            accountId: currentAccountId ?? null,
            visibility
          })
          return apiResponse({
            req,
            allowedMethods: CORS_HEADERS,
            data: ERROR_404,
            responseStatusCode: 404
          })
        }
      }

      if (!isParseableFitnessFileType(fileMetadata.fileType)) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_400,
          responseStatusCode: 400
        })
      }

      const privacySettings = await database.getFitnessSettings({
        actorId: fileMetadata.actorId,
        serviceType: 'general'
      })
      const isAnonymousPublicRequest = isPubliclyAccessible && !currentActor
      const privacyLocations = getFitnessPrivacyLocations(privacySettings)
      const privacyHash = getHashFromString(
        JSON.stringify(privacyLocations)
      ).slice(0, 16)
      const buildEtag = (timestamp: number) =>
        `W/"route-v${PRE_PARSED_ROUTE_DATA_VERSION}-r${ROUTE_DATA_RESPONSE_VERSION}-${id}-${timestamp}-${isOwnerAccount ? 'owner' : 'viewer'}-${privacyHash}"`

      const cacheControl = isAnonymousPublicRequest
        ? 'public, max-age=60, must-revalidate'
        : 'private, no-cache'

      const cachedMetadata = await database.getFitnessFileRouteDataMetadata({
        fitnessFileId: id
      })
      const hasCurrentCachedMetadata =
        cachedMetadata?.sourceVersion === PRE_PARSED_ROUTE_DATA_VERSION

      if (hasCurrentCachedMetadata) {
        const cachedEtag = buildEtag(cachedMetadata.updatedAt)
        if (req.headers.get('if-none-match') === cachedEtag) {
          return new Response(null, {
            status: 304,
            headers: new Headers([
              ['Server', SERVICE_NAME],
              ...Object.entries(getCORSHeaders(CORS_HEADERS, req.headers)),
              ['ETag', cachedEtag],
              ['Cache-Control', cacheControl],
              ['Vary', 'Authorization, Cookie']
            ])
          })
        }
      }

      let preParsed = await loadPreParsedRouteData(database, id)
      let cacheTimestamp =
        preParsed && hasCurrentCachedMetadata ? cachedMetadata.updatedAt : null
      if (!preParsed) {
        const fitnessFileBuffer = await getFitnessFileBuffer(
          id,
          fileMetadata,
          database
        )
        if (!fitnessFileBuffer) {
          logger.warn({
            message: 'Fitness file not found',
            fileId: id
          })
          return apiResponse({
            req,
            allowedMethods: CORS_HEADERS,
            data: ERROR_404,
            responseStatusCode: 404
          })
        }

        const activityData = await parseFitnessFile({
          fileType: fileMetadata.fileType,
          buffer: fitnessFileBuffer
        })

        preParsed = createPreParsedRouteDataPayload(activityData)

        try {
          const savedRow = await savePreParsedRouteData(database, {
            fitnessFileId: id,
            actorId: fileMetadata.actorId,
            payload: preParsed
          })
          cacheTimestamp = savedRow?.updatedAt ?? null
        } catch (error) {
          logger.warn({
            message: 'Failed to lazily cache pre-parsed fitness route data',
            fitnessFileId: id,
            err: toLoggableError(error)
          })
        }
      }

      const etag = buildEtag(cacheTimestamp ?? fileMetadata.updatedAt)
      if (req.headers.get('if-none-match') === etag) {
        return new Response(null, {
          status: 304,
          headers: new Headers([
            ['Server', SERVICE_NAME],
            ...Object.entries(getCORSHeaders(CORS_HEADERS, req.headers)),
            ['ETag', etag],
            ['Cache-Control', cacheControl],
            ['Vary', 'Authorization, Cookie']
          ])
        })
      }

      const payload = resolveRouteDataFromPreParsed(preParsed, {
        canViewHiddenZone: isOwnerAccount,
        privacyLocations
      })

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: payload,
        additionalHeaders: [
          ['ETag', etag],
          ['Cache-Control', cacheControl],
          ['Vary', 'Authorization, Cookie']
        ]
      })
    } catch (error) {
      const err = error as Error
      logger.error({
        message: 'Error retrieving fitness route data',
        fileId: id,
        error: err.message,
        err: toLoggableError(error)
      })
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_500,
        responseStatusCode: 500
      })
    }
  }
)
