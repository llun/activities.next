import { z } from 'zod'

import {
  FITNESS_PRIVACY_RADIUS_OPTIONS,
  getFitnessPrivacyLocations,
  sanitizePrivacyLocationSettings,
  sanitizePrivacyRadiusMeters
} from '@/lib/services/fitness-files/privacy'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { logger } from '@/lib/utils/logger'
import {
  HTTP_STATUS,
  apiErrorResponse,
  apiResponse
} from '@/lib/utils/response'
import { toLoggableError } from '@/lib/utils/toLoggableError'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const PrivacyRadiusSchema = z
  .number()
  .refine(
    (value) =>
      FITNESS_PRIVACY_RADIUS_OPTIONS.includes(
        value as (typeof FITNESS_PRIVACY_RADIUS_OPTIONS)[number]
      ),
    {
      message: `Privacy radius must be one of ${FITNESS_PRIVACY_RADIUS_OPTIONS.join(', ')}`
    }
  )

const PrivacyLocationRadiusSchema = z
  .number()
  .refine(
    (value) =>
      value > 0 &&
      FITNESS_PRIVACY_RADIUS_OPTIONS.includes(
        value as (typeof FITNESS_PRIVACY_RADIUS_OPTIONS)[number]
      ),
    {
      message: `Privacy location radius must be one of ${FITNESS_PRIVACY_RADIUS_OPTIONS.filter((radius) => radius > 0).join(', ')}`
    }
  )

const FitnessGeneralSettingsRouteDescriptionRequest = z
  .object({
    generateRouteDescription: z.boolean()
  })
  .strict()

const FitnessGeneralSettingsLegacyRequest = z.object({
  privacyHomeLatitude: z.number().min(-90).max(90).nullable(),
  privacyHomeLongitude: z.number().min(-180).max(180).nullable(),
  privacyHideRadiusMeters: PrivacyRadiusSchema,
  generateRouteDescription: z.boolean().optional()
})

const FitnessGeneralSettingsListRequest = z.object({
  privacyLocations: z
    .array(
      z.object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        hideRadiusMeters: PrivacyLocationRadiusSchema
      })
    )
    .max(25),
  generateRouteDescription: z.boolean().optional()
})

type FitnessGeneralSettingsRequest =
  | z.infer<typeof FitnessGeneralSettingsLegacyRequest>
  | z.infer<typeof FitnessGeneralSettingsListRequest>
  | z.infer<typeof FitnessGeneralSettingsRouteDescriptionRequest>

const hasPrivacyLocationsPayload = (body: unknown) =>
  body !== null &&
  typeof body === 'object' &&
  Object.prototype.hasOwnProperty.call(body, 'privacyLocations')

const hasLegacyPrivacyPayload = (body: unknown) =>
  body !== null &&
  typeof body === 'object' &&
  (Object.prototype.hasOwnProperty.call(body, 'privacyHomeLatitude') ||
    Object.prototype.hasOwnProperty.call(body, 'privacyHomeLongitude') ||
    Object.prototype.hasOwnProperty.call(body, 'privacyHideRadiusMeters'))

const safeParseFitnessGeneralSettingsRequest = (
  body: unknown
):
  | { success: true; data: FitnessGeneralSettingsRequest }
  | { success: false } => {
  const listResult = FitnessGeneralSettingsListRequest.safeParse(body)
  if (listResult.success) return { success: true, data: listResult.data }
  if (hasPrivacyLocationsPayload(body)) return { success: false }

  const legacyResult = FitnessGeneralSettingsLegacyRequest.safeParse(body)
  if (legacyResult.success) return { success: true, data: legacyResult.data }
  if (hasLegacyPrivacyPayload(body)) return { success: false }

  const routeDescResult =
    FitnessGeneralSettingsRouteDescriptionRequest.safeParse(body)
  return routeDescResult.success
    ? { success: true, data: routeDescResult.data }
    : { success: false }
}

interface FitnessGeneralSettingsResponse {
  success?: boolean
  error?: string
  privacyLocations: Array<{
    latitude: number
    longitude: number
    hideRadiusMeters: number
  }>
  privacyHomeLatitude: number | null
  privacyHomeLongitude: number | null
  privacyHideRadiusMeters: number
  generateRouteDescription: boolean
}

const toPrivacyLocationsResponse = (
  settings:
    | {
        privacyLocations?: unknown
        privacyHomeLatitude?: number | null
        privacyHomeLongitude?: number | null
        privacyHideRadiusMeters?: number | null
        generateRouteDescription?: boolean | null
      }
    | null
    | undefined
): FitnessGeneralSettingsResponse => {
  const runtimeLocations = getFitnessPrivacyLocations(settings)
  const privacyLocations = runtimeLocations.map((location) => ({
    latitude: location.lat,
    longitude: location.lng,
    hideRadiusMeters: location.radiusMeters
  }))
  const firstLocation = privacyLocations[0]

  return {
    privacyLocations,
    privacyHomeLatitude: firstLocation?.latitude ?? null,
    privacyHomeLongitude: firstLocation?.longitude ?? null,
    privacyHideRadiusMeters: sanitizePrivacyRadiusMeters(
      firstLocation?.hideRadiusMeters
    ),
    generateRouteDescription: settings?.generateRouteDescription ?? false
  }
}

type NormalizedSettingsPayload =
  | {
      error: string
    }
  | {
      privacyLocations?: Array<{
        latitude: number
        longitude: number
        hideRadiusMeters: number
      }>
      privacyHomeLatitude?: number | null
      privacyHomeLongitude?: number | null
      privacyHideRadiusMeters?: number
      generateRouteDescription?: boolean
    }

const toSettingsPayload = (
  parsed: FitnessGeneralSettingsRequest
): NormalizedSettingsPayload => {
  if ('privacyLocations' in parsed) {
    const privacyLocations = sanitizePrivacyLocationSettings(
      parsed.privacyLocations
    )
    const firstLocation = privacyLocations[0]

    return {
      privacyLocations,
      privacyHomeLatitude: firstLocation?.latitude ?? null,
      privacyHomeLongitude: firstLocation?.longitude ?? null,
      privacyHideRadiusMeters: sanitizePrivacyRadiusMeters(
        firstLocation?.hideRadiusMeters
      ),
      ...(parsed.generateRouteDescription !== undefined
        ? { generateRouteDescription: parsed.generateRouteDescription }
        : {})
    }
  }

  if ('privacyHomeLatitude' in parsed) {
    const hasLatitude = parsed.privacyHomeLatitude !== null
    const hasLongitude = parsed.privacyHomeLongitude !== null

    if (hasLatitude !== hasLongitude) {
      return {
        error: 'Latitude and longitude must be provided together'
      }
    }

    if (parsed.privacyHideRadiusMeters > 0 && !(hasLatitude && hasLongitude)) {
      return {
        error:
          'A home location is required when privacy radius is greater than 0'
      }
    }

    const privacyLocations =
      hasLatitude &&
      hasLongitude &&
      parsed.privacyHomeLatitude !== null &&
      parsed.privacyHomeLongitude !== null &&
      parsed.privacyHideRadiusMeters > 0
        ? [
            {
              latitude: parsed.privacyHomeLatitude,
              longitude: parsed.privacyHomeLongitude,
              hideRadiusMeters: parsed.privacyHideRadiusMeters
            }
          ]
        : []

    return {
      privacyLocations,
      privacyHomeLatitude: parsed.privacyHomeLatitude,
      privacyHomeLongitude: parsed.privacyHomeLongitude,
      privacyHideRadiusMeters: parsed.privacyHideRadiusMeters,
      ...(parsed.generateRouteDescription !== undefined
        ? { generateRouteDescription: parsed.generateRouteDescription }
        : {})
    }
  }

  return {
    generateRouteDescription: parsed.generateRouteDescription
  }
}

export const GET = traceApiRoute(
  'getFitnessGeneralSettings',
  AuthenticatedGuard(async (req, context) => {
    const { currentActor, database } = context

    const settings = await database.getFitnessSettings({
      actorId: currentActor.id,
      serviceType: 'general'
    })

    return apiResponse({
      req,
      allowedMethods: [],
      data: toPrivacyLocationsResponse(settings),
      responseStatusCode: 200
    })
  })
)

export const POST = traceApiRoute(
  'saveFitnessGeneralSettings',
  AuthenticatedGuard(async (req, context) => {
    const { currentActor, database } = context

    let body: unknown
    try {
      body = await req.json()
    } catch (_error) {
      return apiErrorResponse(HTTP_STATUS.BAD_REQUEST)
    }

    const parsed = safeParseFitnessGeneralSettingsRequest(body)
    if (!parsed.success) {
      return apiErrorResponse(HTTP_STATUS.UNPROCESSABLE_ENTITY)
    }

    const normalized = toSettingsPayload(parsed.data)
    if ('error' in normalized) {
      return apiResponse({
        req,
        allowedMethods: [],
        data: { error: normalized.error },
        responseStatusCode: 400
      })
    }

    try {
      const existing = await database.getFitnessSettings({
        actorId: currentActor.id,
        serviceType: 'general'
      })

      const saved = existing
        ? await database.updateFitnessSettings({
            id: existing.id,
            ...(normalized.privacyLocations !== undefined
              ? {
                  privacyLocations: normalized.privacyLocations,
                  privacyHomeLatitude: normalized.privacyHomeLatitude,
                  privacyHomeLongitude: normalized.privacyHomeLongitude,
                  privacyHideRadiusMeters: normalized.privacyHideRadiusMeters
                }
              : {}),
            ...(normalized.generateRouteDescription !== undefined
              ? {
                  generateRouteDescription: normalized.generateRouteDescription
                }
              : {})
          })
        : await database.createFitnessSettings({
            actorId: currentActor.id,
            serviceType: 'general',
            privacyLocations: normalized.privacyLocations ?? [],
            privacyHomeLatitude: normalized.privacyHomeLatitude ?? undefined,
            privacyHomeLongitude: normalized.privacyHomeLongitude ?? undefined,
            privacyHideRadiusMeters: normalized.privacyHideRadiusMeters ?? 0,
            generateRouteDescription:
              normalized.generateRouteDescription ?? false
          })

      if (!saved) {
        return apiErrorResponse(HTTP_STATUS.INTERNAL_SERVER_ERROR)
      }

      return apiResponse({
        req,
        allowedMethods: [],
        data: {
          success: true,
          ...toPrivacyLocationsResponse(saved)
        },
        responseStatusCode: 200
      })
    } catch (error) {
      logger.error({
        message: 'Failed to save fitness general settings',
        actorId: currentActor.id,
        err: toLoggableError(error)
      })
      return apiErrorResponse(HTTP_STATUS.INTERNAL_SERVER_ERROR)
    }
  })
)
