import { deleteFitnessFile as deleteFitnessFileFromStorage } from '@/lib/services/fitness-files'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import { logger } from '@/lib/utils/logger'
import {
  HTTP_STATUS,
  apiErrorResponse,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

interface Params {
  fitnessFileId: string
}

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.DELETE]

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const DELETE = traceApiRoute(
  'deleteFitnessFile',
  AuthenticatedGuard<Params>(async (req, context) => {
    const { database, currentActor, params } = context
    const { fitnessFileId } = (await params) ?? { fitnessFileId: undefined }

    const account = currentActor.account
    if (!account) {
      logger.warn({
        message: 'Unauthorized delete fitness file request - no account'
      })
      return apiErrorResponse(HTTP_STATUS.UNAUTHORIZED)
    }

    if (!fitnessFileId) {
      logger.warn({ message: 'Bad request - missing fitnessFileId' })
      return apiErrorResponse(HTTP_STATUS.BAD_REQUEST)
    }

    try {
      const fitnessFile = await database.getFitnessFile({ id: fitnessFileId })
      if (!fitnessFile) {
        logger.warn({
          message: 'Fitness file not found',
          fitnessFileId,
          accountId: account.id
        })
        return apiErrorResponse(HTTP_STATUS.NOT_FOUND)
      }

      const fitnessFileActor = await database.getActorFromId({
        id: fitnessFile.actorId
      })
      if (fitnessFileActor?.account?.id !== account.id) {
        logger.warn({
          message: 'Fitness file not owned by account',
          fitnessFileId,
          accountId: account.id
        })
        return apiErrorResponse(HTTP_STATUS.NOT_FOUND)
      }

      const deleted = await deleteFitnessFileFromStorage(
        database,
        fitnessFileId,
        fitnessFile
      )
      if (!deleted) {
        logger.error({
          message: 'Failed to delete fitness file',
          fitnessFileId,
          accountId: account.id
        })
        return apiErrorResponse(HTTP_STATUS.INTERNAL_SERVER_ERROR)
      }

      logger.info({
        message: 'Fitness file deleted successfully',
        fitnessFileId,
        accountId: account.id
      })

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: { success: true }
      })
    } catch (error) {
      const err = error as Error
      logger.error({
        message: 'Error deleting fitness file',
        fitnessFileId,
        accountId: account.id,
        error: err.message
      })
      return apiErrorResponse(HTTP_STATUS.INTERNAL_SERVER_ERROR)
    }
  }),
  {
    addAttributes: async (_req, context) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { currentActor, params } = context as any
      const { fitnessFileId } = (await params) ?? { fitnessFileId: undefined }
      const account = currentActor?.account

      const attributes: Record<string, string | number | boolean> = {}
      if (fitnessFileId) {
        attributes.fitnessFileId = fitnessFileId
      }
      if (account?.id) {
        attributes.accountId = account.id
      }
      return attributes
    }
  }
)
