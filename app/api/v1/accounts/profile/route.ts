import { z } from 'zod'

import {
  normalizeProfileFieldRows,
  parseProfileFieldsForm
} from '@/lib/services/accounts/profileFields'
import { parseProfileImageUrl } from '@/lib/services/accounts/profileImageUrl'
import { publishActorUpdate } from '@/lib/services/actors/actorUpdate'
import { hasFederatedProfileChange } from '@/lib/services/actors/hasFederatedProfileChange'
import { getServedHostConfig } from '@/lib/services/domains/servedDomainSnapshot'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { headerHost } from '@/lib/services/guards/headerHost'
import { queueProfileLinkVerification } from '@/lib/services/profile-links/queueProfileLinkVerification'
import {
  ActorSettings,
  POST_LINE_LIMIT_VALUES,
  PostLineLimit
} from '@/lib/types/database/rows'
import { Actor } from '@/lib/types/domain/actor'
import { SavedProfile } from '@/lib/types/domain/savedProfile'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'
import {
  HTTP_STATUS,
  apiErrorResponse,
  apiResponse
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

// The settings form's own fields, and nothing else. `publicKey`,
// `followersUrl`, `inboxUrl` and `sharedInboxUrl` were accepted here as free
// strings and passed straight to `updateActor`, which persists all four — so
// any signed-in user could rewrite the public key and inbox endpoints their own
// actor publishes. No form has ever sent them; Zod strips them as unknown keys.
const ProfileRequest = z.object({
  name: z.string().optional(),
  summary: z.string().optional(),
  iconUrl: z.string().optional(),
  headerImageUrl: z.string().optional(),
  manuallyApprovesFollowers: z.string().optional(),
  postLineLimit: z.string().optional()
})

export const POST = traceApiRoute(
  'updateProfile',
  AuthenticatedGuard(async (req, context) => {
    const { currentActor, database } = context
    const body = await req.formData()
    const json = Object.fromEntries(body.entries())

    const parsed = ProfileRequest.safeParse(json)
    if (!parsed.success) {
      return apiErrorResponse(HTTP_STATUS.UNPROCESSABLE_ENTITY)
    }
    // Handle checkbox behavior:
    // 1. If 'on', it's checked -> true
    // 2. If missing but marker is present, it's unchecked -> false
    // 3. If missing and marker is missing, it's a partial update -> undefined (don't update)

    // Extract raw value to avoid passing string "on" to updateActor which expects boolean
    const {
      manuallyApprovesFollowers: rawValue,
      postLineLimit: rawPostLineLimit,
      iconUrl: rawIconUrl,
      headerImageUrl: rawHeaderImageUrl,
      ...safeParsed
    } = parsed.data

    // Only a URL shaped like one this instance serves its own media from — a
    // host and path check, not a lookup. An absent field is left alone (the
    // General form no longer sends the images, Edit profile saves them through
    // PATCH), while an empty one is the user clearing the image —
    // `parseProfileImageUrl` answers null for it and `updateActor` reads that
    // as an explicit clear.
    // The actor's stored values are passed so a form resubmitting one it did
    // not change is treated as "no change" rather than re-validated — see
    // `parseProfileImageUrl`, where the single settings form makes that
    // load-bearing.
    // The served domains (database ones included): an actor on an added
    // domain gets media URLs on that domain.
    const config = getServedHostConfig()
    const iconUrl = parseProfileImageUrl(
      rawIconUrl,
      config,
      currentActor.iconUrl
    )
    const headerImageUrl = parseProfileImageUrl(
      rawHeaderImageUrl,
      config,
      currentActor.headerImageUrl
    )
    if (!iconUrl.valid || !headerImageUrl.valid) {
      return apiErrorResponse(HTTP_STATUS.UNPROCESSABLE_ENTITY)
    }

    const profileFields = parseProfileFieldsForm(json)
    if (profileFields.status === 'invalid') {
      return apiErrorResponse(HTTP_STATUS.UNPROCESSABLE_ENTITY)
    }

    let manuallyApprovesFollowers: boolean | undefined
    if (rawValue === 'on') {
      manuallyApprovesFollowers = true
    } else if (json.manuallyApprovesFollowers_marker === 'true') {
      manuallyApprovesFollowers = false
    }

    let postLineLimit: PostLineLimit | undefined
    if (rawPostLineLimit !== undefined && rawPostLineLimit !== '') {
      const numValue = parseInt(rawPostLineLimit, 10)
      if (
        !isNaN(numValue) &&
        POST_LINE_LIMIT_VALUES.includes(numValue as PostLineLimit)
      ) {
        postLineLimit = numValue as PostLineLimit
      }
    }

    // Changes are measured against the stored actor as read under the save's
    // own row lock (`before`), not a read made earlier: a concurrent save may
    // have committed in between, and the guard's actor is a partial one anyway.
    const { before, after: updatedActor } =
      await database.updateActorWithPrevious({
        actorId: currentActor.id,
        ...safeParsed,
        ...(iconUrl.value !== undefined ? { iconUrl: iconUrl.value } : null),
        ...(headerImageUrl.value !== undefined
          ? { headerImageUrl: headerImageUrl.value }
          : null),
        ...(manuallyApprovesFollowers !== undefined
          ? { manuallyApprovesFollowers }
          : null),
        ...(postLineLimit !== undefined ? { postLineLimit } : null),
        ...(profileFields.status === 'ok'
          ? { fields: profileFields.fields }
          : null)
      })
    // Only a change to what the federated Person carries is sent: this form
    // also saves the post line limit, which remote servers never see. `before`
    // and `after` are read in one transaction under the row lock, so a null
    // `before` next to a saved actor cannot happen; publishing then is only a
    // defensive default.
    if (
      updatedActor &&
      (!before || hasFederatedProfileChange(before, updatedActor))
    ) {
      await publishActorUpdate({ actorId: currentActor.id })
    }
    // Links are checked only for an actor that was saved.
    if (updatedActor && profileFields.status === 'ok') {
      await queueProfileLinkVerification({
        actorId: currentActor.id,
        before: before?.fields,
        after: profileFields.fields,
        remote: false
      })
    }

    const host = headerHost(req.headers)
    const url = new URL('/settings', `https://${host}`)
    // 303 so the browser GETs /settings; a 307 would re-POST the form to the
    // page, which answers 404
    return Response.redirect(url.toString(), 303)
  })
)

// The JSON editor's save. Every key is optional and an absent key leaves the
// stored value alone. As in the form above, only these keys are read; Zod
// strips anything else (the key and inbox endpoints included).
const DESCRIPTION_MAX_LENGTH = 1500
const NAME_MAX_LENGTH = 255
const SUMMARY_MAX_LENGTH = 500

const ProfilePatchRequest = z.object({
  // The actor the editor was loaded for. When it is not the session's current
  // actor any more (switched in another tab or the switcher), nothing is saved.
  // Absent for callers that do not care.
  actorId: z.string().optional(),
  // The length caps are checked below, and only against a value that differs
  // from the stored one, so an untouched long bio can be saved again.
  name: z.string().optional(),
  summary: z.string().optional(),
  fields: z.array(z.object({ name: z.string(), value: z.string() })).optional(),
  iconUrl: z.string().nullable().optional(),
  headerImageUrl: z.string().nullable().optional(),
  avatarDescription: z.string().trim().max(DESCRIPTION_MAX_LENGTH).optional(),
  headerDescription: z.string().trim().max(DESCRIPTION_MAX_LENGTH).optional(),
  showReplies: z.boolean().optional(),
  showMedia: z.boolean().optional(),
  showGallery: z.boolean().optional(),
  showFitness: z.boolean().optional()
})

const toSavedProfile = (
  actor: Actor,
  settings: ActorSettings | undefined
): SavedProfile => ({
  name: actor.name ?? '',
  summary: actor.summary ?? '',
  fields: (actor.fields ?? []).map((field) => ({
    name: field.name,
    value: field.value,
    verifiedAt: field.verifiedAt ? getISOTimeUTC(field.verifiedAt) : null
  })),
  iconUrl: actor.iconUrl ?? null,
  headerImageUrl: actor.headerImageUrl ?? null,
  // Tab flags come from the saved row (read in the save's transaction); only
  // the alt texts, which the Actor does not carry, come from the settings.
  avatarDescription: settings?.avatarDescription ?? '',
  headerDescription: settings?.headerDescription ?? '',
  showReplies: actor.showReplies ?? true,
  showMedia: actor.showMedia ?? true,
  showGallery: actor.showGallery ?? true,
  showFitness: actor.showFitness ?? true
})

export const PATCH = traceApiRoute(
  'patchAccountProfile',
  AuthenticatedGuard(async (req, context) => {
    const { currentActor, database } = context
    const invalid = (message: string) =>
      apiResponse({
        req,
        allowedMethods: ['PATCH'],
        data: { error: message },
        responseStatusCode: HTTP_STATUS.UNPROCESSABLE_ENTITY
      })

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return apiErrorResponse(HTTP_STATUS.BAD_REQUEST)
    }

    const parsed = ProfilePatchRequest.safeParse(body)
    if (!parsed.success) {
      return invalid(
        parsed.error.issues[0]
          ? `Invalid ${parsed.error.issues[0].path.join('.') || 'request'}`
          : 'Invalid request'
      )
    }
    const {
      actorId: expectedActorId,
      fields: submittedFields,
      ...rest
    } = parsed.data
    if (expectedActorId !== undefined && expectedActorId !== currentActor.id) {
      return apiResponse({
        req,
        allowedMethods: ['PATCH'],
        data: { error: 'Actor changed' },
        responseStatusCode: HTTP_STATUS.CONFLICT
      })
    }

    // The guard's actor is a partial one (no links, discovery flags or
    // attribution domains), so validate and echo against the stored actor. This
    // read can be stale by the time of the write, so it only serves those
    // checks: whether to federate is decided from the row read under the
    // save's lock.
    const before = await database.getActorFromId({ id: currentActor.id })
    if (!before) {
      return apiResponse({
        req,
        allowedMethods: ['PATCH'],
        data: { error: 'Not found' },
        responseStatusCode: HTTP_STATUS.NOT_FOUND
      })
    }

    // Echo semantics, as for the image URLs: re-sending the stored value is
    // not a proposal, so it is accepted even when it predates the cap.
    if (
      rest.name !== undefined &&
      rest.name !== (before.name ?? '') &&
      rest.name.length > NAME_MAX_LENGTH
    ) {
      return invalid('Invalid name')
    }
    if (
      rest.summary !== undefined &&
      rest.summary !== (before.summary ?? '') &&
      rest.summary.length > SUMMARY_MAX_LENGTH
    ) {
      return invalid('Invalid summary')
    }

    // Same validation and echo semantics as the form: a URL this instance
    // serves, an echo of the stored value is "no change", and null clears.
    const config = getServedHostConfig()
    const iconUrl = parseProfileImageUrl(rest.iconUrl, config, before.iconUrl)
    if (!iconUrl.valid) return invalid('Invalid iconUrl')
    const headerImageUrl = parseProfileImageUrl(
      rest.headerImageUrl,
      config,
      before.headerImageUrl
    )
    if (!headerImageUrl.valid) return invalid('Invalid headerImageUrl')

    const profileFields =
      submittedFields === undefined
        ? null
        : normalizeProfileFieldRows(submittedFields)
    if (profileFields?.status === 'invalid') return invalid('Invalid fields')

    // An empty body (or one of unknown keys only) writes nothing.
    const hasChange = Object.keys(parsed.data).some((key) => key !== 'actorId')

    let saved: Actor = before
    if (hasChange) {
      const { before: lockedBefore, after: updatedActor } =
        await database.updateActorWithPrevious({
          actorId: currentActor.id,
          ...(rest.name !== undefined ? { name: rest.name } : null),
          ...(rest.summary !== undefined ? { summary: rest.summary } : null),
          ...(iconUrl.value !== undefined ? { iconUrl: iconUrl.value } : null),
          ...(headerImageUrl.value !== undefined
            ? { headerImageUrl: headerImageUrl.value }
            : null),
          ...(profileFields?.status === 'ok'
            ? { fields: profileFields.fields }
            : null),
          ...(rest.avatarDescription !== undefined
            ? { avatarDescription: rest.avatarDescription }
            : null),
          ...(rest.headerDescription !== undefined
            ? { headerDescription: rest.headerDescription }
            : null),
          ...(rest.showReplies !== undefined
            ? { showReplies: rest.showReplies }
            : null),
          ...(rest.showMedia !== undefined
            ? { showMedia: rest.showMedia }
            : null),
          ...(rest.showGallery !== undefined
            ? { showGallery: rest.showGallery }
            : null),
          ...(rest.showFitness !== undefined
            ? { showFitness: rest.showFitness }
            : null)
        })
      if (!updatedActor) {
        return apiResponse({
          req,
          allowedMethods: ['PATCH'],
          data: { error: 'Not found' },
          responseStatusCode: HTTP_STATUS.NOT_FOUND
        })
      }
      saved = updatedActor
      // At most one Update(Person), and none for a save of tabs, alt texts
      // or unchanged values: remote servers never see those. A null
      // `lockedBefore` next to a saved actor cannot happen (both are read in
      // one transaction under the row lock); publishing then is only a
      // defensive default.
      if (
        !lockedBefore ||
        hasFederatedProfileChange(lockedBefore, updatedActor)
      ) {
        await publishActorUpdate({ actorId: currentActor.id })
      }
      if (profileFields?.status === 'ok') {
        await queueProfileLinkVerification({
          actorId: currentActor.id,
          before: (lockedBefore ?? before).fields,
          after: profileFields.fields,
          remote: false
        })
      }
    }

    const settings = await database.getActorSettings({
      actorId: currentActor.id
    })
    return apiResponse({
      req,
      allowedMethods: ['PATCH'],
      data: toSavedProfile(saved, settings)
    })
  })
)
