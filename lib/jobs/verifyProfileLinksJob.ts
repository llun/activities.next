import { z } from 'zod'

import { createJobHandle } from '@/lib/jobs/createJobHandle'
import { VERIFY_PROFILE_LINKS_JOB_NAME } from '@/lib/jobs/names'
import { PROFILE_FIELD_LIMIT } from '@/lib/services/accounts/profileFieldLimits'
import { getVerifiableFieldUrl } from '@/lib/services/profile-links/html'
import { verifyProfileLink } from '@/lib/services/profile-links/verifyProfileLink'
import { JobHandle } from '@/lib/services/queue/type'
import { getActorProfileUrl } from '@/lib/utils/getPersonFromActor'
import { withSpan } from '@/lib/utils/trace'

const JobData = z.object({
  actorId: z.string()
})

/**
 * Mastodon's rel="me" verification: for each profile link that is a single
 * https URL and not yet verified, fetch the page and look for a rel="me"
 * link back to the profile. A link back is the profile page URL or the actor
 * id. Only a field whose value still equals the one that was checked gets
 * `verifiedAt` (the write re-reads the row under a lock). A verified
 * link is not checked again, but a failed one is tried again whenever the
 * profile is saved or a remote profile is refreshed
 * (`queueProfileLinkVerification`), as on Mastodon, so adding the link back
 * to the site and saving again verifies it.
 */
export const verifyProfileLinksJob: JobHandle = createJobHandle(
  VERIFY_PROFILE_LINKS_JOB_NAME,
  async (database, message) => {
    await withSpan('job', 'verifyProfileLinks', {}, async (span) => {
      const parsed = JobData.safeParse(message.data)
      if (!parsed.success) {
        span.recordException(new Error('Malformed verify profile links job'))
        return
      }
      const { actorId } = parsed.data
      span.setAttribute('actorId', actorId)

      const actor = await database.getActorFromId({ id: actorId })
      if (!actor?.fields?.length) return

      const remote = !actor.privateKey
      // A remote actor's own `url` is not stored; Mastodon-compatible servers
      // serve the profile at /@username, and the actor id covers the rest.
      // A rename retires the old handle but keeps the actor id, so every
      // replaced ledger row's profile URL still counts as a link back: a page
      // linking to the previous profile keeps its verification.
      const previousProfileUrls = (
        await database.getActorHandles({ actorId: actor.id })
      )
        .filter((handle) => handle.replacedAt !== null)
        .map((handle) => `https://${handle.domain}/@${handle.username}`)
      const linkBacks = [
        getActorProfileUrl(actor),
        actor.id,
        ...previousProfileUrls
      ]

      // Only the first four fields are checked, even for a remote actor that keeps
      // more (Mastodon keeps 50): this bounds the outbound fetches per run.
      const candidates = actor.fields
        .slice(0, PROFILE_FIELD_LIMIT)
        .flatMap((field) => {
          if (field.verifiedAt) return []
          const url = getVerifiableFieldUrl(field.value, { remote })
          return url ? [{ value: field.value, url }] : []
        })
      // Stamp the check whatever the outcome, so a render path can bound how
      // often it queues this job (see queueProfileLinkVerification).
      let values: string[] = []
      try {
        const results = await Promise.all(
          candidates.map(async ({ value, url }) =>
            (await verifyProfileLink({ url, linkBacks })) ? value : null
          )
        )
        values = results.filter((value): value is string => value !== null)
      } finally {
        const now = Date.now()
        await database.markActorProfileFieldsVerified({
          actorId,
          values,
          verifiedAt: now,
          checkedAt: now
        })
      }
      span.setAttribute('verifiedCount', values.length)
    })
  }
)
