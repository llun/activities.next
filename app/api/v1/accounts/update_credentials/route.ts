import { z } from 'zod'

import { buildCredentialAccount } from '@/lib/services/accounts/credentialAccount'
import {
  OAuthGuardAnyScope,
  corsErrorResponse
} from '@/lib/services/guards/OAuthGuard'
import { saveMedia } from '@/lib/services/medias'
import { MediaSchema } from '@/lib/services/medias/types'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { logger } from '@/lib/utils/logger'
import { apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.PATCH]

const guardOptions = { errorResponse: corsErrorResponse(CORS_HEADERS) }

const FieldAttribute = z.object({
  name: z.string().max(255),
  value: z.string().max(2047)
})

// Scalar (non-file) update_credentials params. `fields` are normalized from
// Mastodon's `fields_attributes` before parsing.
const UpdateCredentialsRequest = z.object({
  display_name: z.string().max(255).optional(),
  note: z.string().max(500).optional(),
  locked: z.union([z.boolean(), z.string()]).optional(),
  bot: z.union([z.boolean(), z.string()]).optional(),
  discoverable: z.union([z.boolean(), z.string()]).optional(),
  fields: FieldAttribute.array().max(4).optional(),
  source: z
    .object({
      privacy: z.enum(['public', 'unlisted', 'private', 'direct']).optional(),
      sensitive: z.union([z.boolean(), z.string()]).optional(),
      language: z.string().max(20).optional()
    })
    .optional()
})

export const OPTIONS = defaultOptions(CORS_HEADERS)

const parseBoolean = (
  value: string | boolean | undefined
): boolean | undefined => {
  if (value === undefined) return undefined
  if (typeof value === 'boolean') return value
  const normalized = value.trim().toLowerCase()
  if (['true', '1', 'on', 'yes'].includes(normalized)) return true
  if (['false', '0', 'off', 'no'].includes(normalized)) return false
  return undefined
}

// Sets a nested value from a bracketed form key path, e.g.
// `source[privacy]` or `fields_attributes[0][name]`.
const assignFieldsFromForm = (
  form: FormData
): {
  scalars: Record<string, unknown>
  avatar: File | null
  header: File | null
} => {
  const scalars: Record<string, unknown> = {}
  const source: Record<string, unknown> = {}
  const fieldsByIndex = new Map<string, { name?: string; value?: string }>()
  let avatar: File | null = null
  let header: File | null = null

  for (const [key, raw] of form.entries()) {
    if (key === 'avatar') {
      if (raw instanceof File && raw.size > 0) avatar = raw
      continue
    }
    if (key === 'header') {
      if (raw instanceof File && raw.size > 0) header = raw
      continue
    }
    if (typeof raw !== 'string') continue

    const sourceMatch = key.match(/^source\[(\w+)\]$/)
    if (sourceMatch) {
      source[sourceMatch[1]] = raw
      continue
    }

    const fieldMatch = key.match(/^fields_attributes\[(\d+)\]\[(name|value)\]$/)
    if (fieldMatch) {
      const [, index, prop] = fieldMatch
      const entry = fieldsByIndex.get(index) ?? {}
      entry[prop as 'name' | 'value'] = raw
      fieldsByIndex.set(index, entry)
      continue
    }

    scalars[key] = raw
  }

  if (Object.keys(source).length > 0) scalars.source = source
  if (fieldsByIndex.size > 0) {
    scalars.fields = [...fieldsByIndex.entries()]
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([, entry]) => ({
        name: entry.name ?? '',
        value: entry.value ?? ''
      }))
  }

  return { scalars, avatar, header }
}

// Normalizes a JSON body into the same scalar shape (mapping
// `fields_attributes` -> `fields`).
const normalizeJsonBody = (json: Record<string, unknown>) => {
  const { fields_attributes: fieldsAttributes, ...rest } = json
  const scalars: Record<string, unknown> = { ...rest }
  if (Array.isArray(fieldsAttributes)) scalars.fields = fieldsAttributes
  return scalars
}

export const PATCH = traceApiRoute(
  'updateCredentials',
  OAuthGuardAnyScope(
    [Scope.enum.write, Scope.enum['write:accounts']],
    async (req, context) => {
      const { currentActor, database } = context

      let scalars: Record<string, unknown> = {}
      let avatarFile: File | null = null
      let headerFile: File | null = null

      const contentType = (req.headers.get('content-type') ?? '').toLowerCase()
      if (contentType.includes('application/json')) {
        const text = await req.text()
        if (text.trim() !== '') {
          let json: unknown
          try {
            json = JSON.parse(text)
          } catch {
            return apiResponse({
              req,
              allowedMethods: CORS_HEADERS,
              data: { error: 'Invalid request body' },
              responseStatusCode: 400
            })
          }
          if (typeof json === 'object' && json !== null) {
            scalars = normalizeJsonBody(json as Record<string, unknown>)
          }
        }
      } else {
        try {
          const form = await req.formData()
          const parsedForm = assignFieldsFromForm(form)
          scalars = parsedForm.scalars
          avatarFile = parsedForm.avatar
          headerFile = parsedForm.header
        } catch {
          scalars = {}
        }
      }

      const parsed = UpdateCredentialsRequest.safeParse(scalars)
      if (!parsed.success) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: { error: 'Invalid input' },
          responseStatusCode: 422
        })
      }

      const { display_name, note, locked, bot, discoverable, fields, source } =
        parsed.data

      // Persist avatar/header through the shared media-save pipeline and store
      // the resulting URLs as actor settings. If storage is unconfigured
      // saveMedia returns null and the existing image is kept.
      let iconUrl: string | undefined
      let headerImageUrl: string | undefined
      if (avatarFile) {
        const media = MediaSchema.safeParse({ file: avatarFile })
        if (media.success) {
          const saved = await saveMedia(database, currentActor, media.data)
          if (saved) iconUrl = saved.url
        }
      }
      if (headerFile) {
        const media = MediaSchema.safeParse({ file: headerFile })
        if (media.success) {
          const saved = await saveMedia(database, currentActor, media.data)
          if (saved) headerImageUrl = saved.url
        }
      }

      const manuallyApprovesFollowers = parseBoolean(locked)
      const botFlag = parseBoolean(bot)
      const discoverableFlag = parseBoolean(discoverable)
      const sensitiveFlag = parseBoolean(source?.sensitive)

      await database.updateActor({
        actorId: currentActor.id,
        ...(display_name !== undefined ? { name: display_name } : null),
        ...(note !== undefined ? { summary: note } : null),
        ...(manuallyApprovesFollowers !== undefined
          ? { manuallyApprovesFollowers }
          : null),
        ...(botFlag !== undefined ? { bot: botFlag } : null),
        ...(discoverableFlag !== undefined
          ? { discoverable: discoverableFlag }
          : null),
        ...(fields !== undefined ? { fields } : null),
        ...(source?.privacy !== undefined
          ? { defaultPrivacy: source.privacy }
          : null),
        ...(sensitiveFlag !== undefined
          ? { defaultSensitive: sensitiveFlag }
          : null),
        ...(source?.language !== undefined
          ? { defaultLanguage: source.language }
          : null),
        ...(iconUrl !== undefined ? { iconUrl } : null),
        ...(headerImageUrl !== undefined ? { headerImageUrl } : null)
      })

      const [account, followRequestsCount] = await Promise.all([
        database.getMastodonActorFromId({ id: currentActor.id }),
        database.getFollowRequestsCount({ targetActorId: currentActor.id })
      ])
      if (!account) {
        logger.error({ message: 'update_credentials: actor not found' })
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: { error: 'Account not found' },
          responseStatusCode: 500
        })
      }
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: buildCredentialAccount({ account, followRequestsCount })
      })
    },
    guardOptions
  )
)
