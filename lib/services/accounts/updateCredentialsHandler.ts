import { z } from 'zod'

import { buildCredentialAccount } from '@/lib/services/accounts/credentialAccount'
import { localizeAccount } from '@/lib/services/accounts/localizeAccount'
import { buildProfile } from '@/lib/services/accounts/profile'
import {
  OAuthGuardAnyScope,
  corsErrorResponse
} from '@/lib/services/guards/OAuthGuard'
import { headerHost } from '@/lib/services/guards/headerHost'
import { saveMedia } from '@/lib/services/medias'
import { MediaSchema } from '@/lib/services/medias/types'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { logger } from '@/lib/utils/logger'
import { apiResponse } from '@/lib/utils/response'

export const UPDATE_CREDENTIALS_CORS_HEADERS = [
  HttpMethod.enum.OPTIONS,
  HttpMethod.enum.PATCH
]

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
  indexable: z.union([z.boolean(), z.string()]).optional(),
  hide_collections: z.union([z.boolean(), z.string()]).optional(),
  // Mastodon caps attribution domains at 100 entries; a hostname fits in 255.
  attribution_domains: z.string().max(255).array().max(100).optional(),
  fields: FieldAttribute.array().max(4).optional(),
  // Mastodon 4.6 PATCH /api/v1/profile appearance params. Accepted on both
  // PATCH endpoints so they share one param surface; update_credentials
  // clients simply never send them. Descriptions cap at 1500 chars (Mastodon's
  // media-description limit). Booleans accept the string forms exactly like
  // locked/bot/discoverable because form bodies deliver strings.
  avatar_description: z.string().max(1500).optional(),
  header_description: z.string().max(1500).optional(),
  show_media: z.union([z.boolean(), z.string()]).optional(),
  show_media_replies: z.union([z.boolean(), z.string()]).optional(),
  show_featured: z.union([z.boolean(), z.string()]).optional(),
  source: z
    .object({
      privacy: z.enum(['public', 'unlisted', 'private', 'direct']).optional(),
      sensitive: z.union([z.boolean(), z.string()]).optional(),
      language: z.string().max(20).optional()
    })
    .optional()
})

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

    // Rails-style repeated array param (`attribution_domains[]`). The generic
    // scalar fallthrough below is last-write-wins, so arrays are collected
    // explicitly. The bare key is accepted too for lenient clients.
    if (key === 'attribution_domains[]' || key === 'attribution_domains') {
      const domains = Array.isArray(scalars.attribution_domains)
        ? (scalars.attribution_domains as string[])
        : []
      domains.push(raw)
      scalars.attribution_domains = domains
      continue
    }

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

// Shared handler for PATCH /api/v1/accounts/update_credentials and
// PATCH /api/v1/profile. Updates the current actor's profile fields (display
// name / note / fields / privacy / avatar / header / appearance flags / ...).
// The response entity differs per route: update_credentials returns the
// CredentialAccount (default `responseEntity: 'credential_account'`), profile
// returns the Mastodon 4.6 Profile entity (`responseEntity: 'profile'`).
// The CORS allow-list also differs (update_credentials = OPTIONS,PATCH;
// profile = OPTIONS,GET,PATCH), so it is passed in.
// Scope: write:accounts (satisfied by the aggregate `write`).
export const updateCredentialsHandler = (
  corsHeaders: HttpMethod[],
  {
    responseEntity = 'credential_account'
  }: { responseEntity?: 'credential_account' | 'profile' } = {}
) =>
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
              allowedMethods: corsHeaders,
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
          allowedMethods: corsHeaders,
          data: { error: 'Invalid input' },
          responseStatusCode: 422
        })
      }

      const {
        display_name,
        note,
        locked,
        bot,
        discoverable,
        indexable,
        hide_collections,
        attribution_domains,
        fields,
        source,
        avatar_description,
        header_description,
        show_media,
        show_media_replies,
        show_featured
      } = parsed.data

      // Persist avatar/header through the shared media-save pipeline and store
      // the resulting URLs as actor settings. An invalid file (wrong type/too
      // large) is a 422; a valid file with no storage configured leaves the
      // existing image unchanged (saveMedia returns null).
      let iconUrl: string | undefined
      let headerImageUrl: string | undefined
      for (const [file, assign] of [
        [avatarFile, (url: string) => (iconUrl = url)],
        [headerFile, (url: string) => (headerImageUrl = url)]
      ] as const) {
        if (!file) continue
        const media = MediaSchema.safeParse({ file })
        if (!media.success) {
          return apiResponse({
            req,
            allowedMethods: corsHeaders,
            data: { error: 'Invalid image file' },
            responseStatusCode: 422
          })
        }
        const saved = await saveMedia(database, currentActor, media.data)
        if (saved) assign(saved.url)
      }

      const manuallyApprovesFollowers = parseBoolean(locked)
      const botFlag = parseBoolean(bot)
      const discoverableFlag = parseBoolean(discoverable)
      const indexableFlag = parseBoolean(indexable)
      const hideCollectionsFlag = parseBoolean(hide_collections)
      const showMediaFlag = parseBoolean(show_media)
      const showMediaRepliesFlag = parseBoolean(show_media_replies)
      const showFeaturedFlag = parseBoolean(show_featured)
      const sensitiveFlag = parseBoolean(source?.sensitive)
      // Normalize attribution domains: trim, lowercase, drop empties, dedupe.
      // An explicit empty array clears the stored list.
      const attributionDomains =
        attribution_domains !== undefined
          ? [
              ...new Set(
                attribution_domains
                  .map((domain) => domain.trim().toLowerCase())
                  .filter((domain) => domain.length > 0)
              )
            ]
          : undefined

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
        ...(indexableFlag !== undefined ? { indexable: indexableFlag } : null),
        ...(hideCollectionsFlag !== undefined
          ? { hideCollections: hideCollectionsFlag }
          : null),
        ...(attributionDomains !== undefined ? { attributionDomains } : null),
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
        ...(headerImageUrl !== undefined ? { headerImageUrl } : null),
        ...(avatar_description !== undefined
          ? { avatarDescription: avatar_description }
          : null),
        ...(header_description !== undefined
          ? { headerDescription: header_description }
          : null),
        ...(showMediaFlag !== undefined ? { showMedia: showMediaFlag } : null),
        ...(showMediaRepliesFlag !== undefined
          ? { showMediaReplies: showMediaRepliesFlag }
          : null),
        ...(showFeaturedFlag !== undefined
          ? { showFeatured: showFeaturedFlag }
          : null)
      })

      const [account, followRequestsCount] = await Promise.all([
        database.getMastodonActorFromId({ id: currentActor.id }),
        database.getFollowRequestsCount({ targetActorId: currentActor.id })
      ])
      if (!account) {
        logger.error({ message: 'updateCredentialsHandler: actor not found' })
        return apiResponse({
          req,
          allowedMethods: corsHeaders,
          data: { error: 'Account not found' },
          responseStatusCode: 500
        })
      }
      if (responseEntity === 'profile') {
        const settings = await database.getActorSettings({
          actorId: currentActor.id
        })
        return apiResponse({
          req,
          allowedMethods: corsHeaders,
          data: buildProfile({ account, settings })
        })
      }
      // Render the acct relative to the domain the client connected through,
      // matching getCredentialAccountHandler (verify_credentials).
      return apiResponse({
        req,
        allowedMethods: corsHeaders,
        data: buildCredentialAccount({
          account: localizeAccount(account, headerHost(req.headers)),
          followRequestsCount
        })
      })
    },
    { errorResponse: corsErrorResponse(corsHeaders) }
  )
