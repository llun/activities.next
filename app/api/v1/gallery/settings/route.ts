import { getConfig } from '@/lib/config'
import { Database } from '@/lib/database/types'
import { GallerySettingsEntity } from '@/lib/services/gallery/galleryEntities'
import { getGalleryLookupAvailability } from '@/lib/services/gallery/galleryLookupAvailability'
import { UpdateGallerySettingsRequest } from '@/lib/services/gallery/galleryRequests'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { GallerySettings } from '@/lib/types/database/gallery'
import {
  HTTP_STATUS,
  apiErrorResponse,
  apiResponse
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const toEntity = async (
  database: Database,
  settings: GallerySettings
): Promise<GallerySettingsEntity> => ({
  ...settings,
  altTextAvailable: Boolean(getConfig().altText),
  ...(await getGalleryLookupAvailability(database))
})

export const GET = traceApiRoute(
  'getGallerySettings',
  AuthenticatedGuard(async (req, context) => {
    const { currentActor, database } = context

    const settings = await database.getGallerySettings({
      actorId: currentActor.id
    })

    return apiResponse({
      req,
      allowedMethods: [],
      data: await toEntity(database, settings),
      responseStatusCode: 200
    })
  })
)

export const PUT = traceApiRoute(
  'updateGallerySettings',
  AuthenticatedGuard(async (req, context) => {
    const { currentActor, database } = context

    let body: unknown
    try {
      body = await req.json()
    } catch (_error) {
      return apiErrorResponse(HTTP_STATUS.BAD_REQUEST)
    }

    const parsed = UpdateGallerySettingsRequest.safeParse(body)
    if (!parsed.success) {
      return apiErrorResponse(HTTP_STATUS.UNPROCESSABLE_ENTITY)
    }

    const settings = await database.updateGallerySettings({
      actorId: currentActor.id,
      ...parsed.data
    })

    return apiResponse({
      req,
      allowedMethods: [],
      data: await toEntity(database, settings),
      responseStatusCode: 200
    })
  })
)
