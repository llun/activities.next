import { z } from 'zod'

import {
  FITNESS_PRIVACY_RADIUS_OPTIONS,
  sanitizePrivacyRadiusMeters
} from '@/lib/services/fitness-files/privacy'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { apiResponse } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const FitnessGeneralSettingsRequest = z.object({
  privacyHomeLatitude: z.number().min(-90).max(90).nullable(),
  privacyHomeLongitude: z.number().min(-180).max(180).nullable(),
  privacyHideRadiusMeters: z
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
})

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
      data: {
        privacyHomeLatitude: settings?.privacyHomeLatitude ?? null,
        privacyHomeLongitude: settings?.privacyHomeLongitude ?? null,
        privacyHideRadiusMeters: sanitizePrivacyRadiusMeters(
          settings?.privacyHideRadiusMeters
        )
      },
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
      const parsed = FitnessGeneralSettingsRequest.parse(body)

      const hasLatitude = parsed.privacyHomeLatitude !== null
      const hasLongitude = parsed.privacyHomeLongitude !== null

      if (hasLatitude !== hasLongitude) {
        return apiResponse({
          req,
          allowedMethods: [],
          data: {
            error: 'Latitude and longitude must be provided together'
          },
          responseStatusCode: 400
        })
      }

      if (
        parsed.privacyHideRadiusMeters > 0 &&
        !(hasLatitude && hasLongitude)
      ) {
        return apiResponse({
          req,
          allowedMethods: [],
          data: {
            error:
              'A home location is required when privacy radius is greater than 0'
          },
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
            privacyHomeLatitude: parsed.privacyHomeLatitude,
            privacyHomeLongitude: parsed.privacyHomeLongitude,
            privacyHideRadiusMeters: parsed.privacyHideRadiusMeters
          })
        : await database.createFitnessSettings({
            actorId: currentActor.id,
            serviceType: 'general',
            privacyHomeLatitude: parsed.privacyHomeLatitude ?? undefined,
            privacyHomeLongitude: parsed.privacyHomeLongitude ?? undefined,
            privacyHideRadiusMeters: parsed.privacyHideRadiusMeters
          })

      return apiResponse({
        req,
        allowedMethods: [],
        data: {
          success: true,
          privacyHomeLatitude: saved?.privacyHomeLatitude ?? null,
          privacyHomeLongitude: saved?.privacyHomeLongitude ?? null,
          privacyHideRadiusMeters: sanitizePrivacyRadiusMeters(
            saved?.privacyHideRadiusMeters
          )
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
