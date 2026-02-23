import { z } from 'zod'

import {
  FITNESS_PRIVACY_RADIUS_OPTIONS,
  getFitnessPrivacyLocations,
  sanitizePrivacyLocationSettings,
  sanitizePrivacyRadiusMeters
} from '@/lib/services/fitness-files/privacy'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { apiResponse } from '@/lib/utils/response'
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

const FitnessGeneralSettingsLegacyRequest = z.object({
  privacyHomeLatitude: z.number().min(-90).max(90).nullable(),
  privacyHomeLongitude: z.number().min(-180).max(180).nullable(),
  privacyHideRadiusMeters: PrivacyRadiusSchema
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
    .max(25)
})

type FitnessGeneralSettingsRequest =
  | z.infer<typeof FitnessGeneralSettingsLegacyRequest>
  | z.infer<typeof FitnessGeneralSettingsListRequest>

const parseFitnessGeneralSettingsRequest = (
  body: unknown
): FitnessGeneralSettingsRequest => {
  if (
    body &&
    typeof body === 'object' &&
    Object.prototype.hasOwnProperty.call(body, 'privacyLocations')
  ) {
    return FitnessGeneralSettingsListRequest.parse(body)
  }

  return FitnessGeneralSettingsLegacyRequest.parse(body)
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
}

const toPrivacyLocationsResponse = (
  settings:
    | {
        privacyLocations?: unknown
        privacyHomeLatitude?: number | null
        privacyHomeLongitude?: number | null
        privacyHideRadiusMeters?: number | null
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
    )
  }
}

const toSettingsPayload = (
  parsed: FitnessGeneralSettingsRequest
):
  | {
      error: string
    }
  | {
      privacyLocations: Array<{
        latitude: number
        longitude: number
        hideRadiusMeters: number
      }>
      privacyHomeLatitude: number | null
      privacyHomeLongitude: number | null
      privacyHideRadiusMeters: number
    } => {
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
      )
    }
  }

  const hasLatitude = parsed.privacyHomeLatitude !== null
  const hasLongitude = parsed.privacyHomeLongitude !== null

  if (hasLatitude !== hasLongitude) {
    return {
      error: 'Latitude and longitude must be provided together'
    }
  }

  if (parsed.privacyHideRadiusMeters > 0 && !(hasLatitude && hasLongitude)) {
    return {
      error: 'A home location is required when privacy radius is greater than 0'
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
    privacyHideRadiusMeters: parsed.privacyHideRadiusMeters
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

    try {
      const body = await req.json()
      const parsed = parseFitnessGeneralSettingsRequest(body)
      const normalized = toSettingsPayload(parsed)
      if ('error' in normalized) {
        return apiResponse({
          req,
          allowedMethods: [],
          data: { error: normalized.error },
          responseStatusCode: 400
        })
      }

      const existing = await database.getFitnessSettings({
        actorId: currentActor.id,
        serviceType: 'general'
      })

      const saved = existing
        ? await database.updateFitnessSettings({
            id: existing.id,
            privacyLocations: normalized.privacyLocations,
            privacyHomeLatitude: normalized.privacyHomeLatitude,
            privacyHomeLongitude: normalized.privacyHomeLongitude,
            privacyHideRadiusMeters: normalized.privacyHideRadiusMeters
          })
        : await database.createFitnessSettings({
            actorId: currentActor.id,
            serviceType: 'general',
            privacyLocations: normalized.privacyLocations,
            privacyHomeLatitude: normalized.privacyHomeLatitude ?? undefined,
            privacyHomeLongitude: normalized.privacyHomeLongitude ?? undefined,
            privacyHideRadiusMeters: normalized.privacyHideRadiusMeters
          })

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
      if (error instanceof z.ZodError) {
        const errorMessage =
          error.issues.length > 0 ? error.issues[0].message : 'Invalid input'
        return apiResponse({
          req,
          allowedMethods: [],
          data: { error: errorMessage },
          responseStatusCode: 400
        })
      }

      return apiResponse({
        req,
        allowedMethods: [],
        data: { error: 'Failed to save fitness general settings' },
        responseStatusCode: 500
      })
    }
  })
)
