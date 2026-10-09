import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { ACTOR3_ID } from '@/lib/stub/seed/actor3'
import { Status, StatusNote } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

import { getMastodonStatus, getMastodonStatuses } from './getMastodonStatus'
import { useSeededStatusDatabase } from './getMastodonStatus.testUtils'

// prettier-ignore
vi.mock('@/lib/config', () => ({
  getConfig: vi.fn().mockReturnValue({ host: 'test.llun.dev' })
}))

describe('getMastodonStatus', () => {
  const { database } = useSeededStatusDatabase()

  describe('quote serialization', () => {
    let counter = 0
    const makeStatus = async (
      actorId: string,
      { to = [ACTIVITY_STREAM_PUBLIC], cc = [] as string[] } = {}
    ): Promise<StatusNote> => {
      counter += 1
      const id = `${actorId}/statuses/mq-${counter}`
      await database.createNote({
        id,
        url: id,
        actorId,
        text: `quote test ${counter}`,
        to,
        cc
      })
      return (await database.getStatus({ statusId: id })) as StatusNote
    }

    const serializeQuoting = async (
      quotedStatusId: string,
      state: 'pending' | 'accepted' | 'rejected' | 'revoked' | 'deleted',
      currentActorId?: string
    ) => {
      const quoting = await makeStatus(ACTOR1_ID)
      await database.createStatusQuote({
        statusId: quoting.id,
        quotedStatusId,
        state
      })
      const hydrated = (await database.getStatus({
        statusId: quoting.id
      })) as Status
      return getMastodonStatus(database, hydrated, currentActorId)
    }

    it('embeds the quoted status for an accepted quote', async () => {
      const quoted = await makeStatus(ACTOR1_ID)
      const result = await serializeQuoting(quoted.id, 'accepted')
      const quote = result?.quote as {
        state: string
        quoted_status: { id: string } | null
      }
      expect(quote.state).toBe('accepted')
      expect(quote.quoted_status?.id).toBe(quoted.publicId)
      expect(result?.content).toMatch(
        new RegExp(
          `^<p class="quote-inline">RE: <a href="${quoted.url.replaceAll('/', '\\/')}">`
        )
      )
    })

    it('prepends the fallback to content for a pending quote', async () => {
      const quoted = await makeStatus(ACTOR1_ID)
      const result = await serializeQuoting(quoted.id, 'pending')
      expect(result?.content).toMatch(
        new RegExp(
          `^<p class="quote-inline">RE: <a href="${quoted.url.replaceAll('/', '\\/')}">`
        )
      )
    })

    it.each([
      { state: 'pending' as const },
      { state: 'rejected' as const },
      { state: 'revoked' as const },
      { state: 'deleted' as const }
    ])(
      'serializes a $state quote as a placeholder with no quoted status',
      async ({ state }) => {
        const quoted = await makeStatus(ACTOR1_ID)
        const result = await serializeQuoting(quoted.id, state)
        const quote = result?.quote as {
          state: string
          quoted_status: unknown
        }
        expect(quote.state).toBe(state)
        expect(quote.quoted_status).toBeNull()
      }
    )

    it.each([
      { state: 'rejected' as const },
      { state: 'revoked' as const },
      { state: 'deleted' as const }
    ])(
      'does not add fallback to content on a $state edge',
      async ({ state }) => {
        const quoted = await makeStatus(ACTOR1_ID)
        const result = await serializeQuoting(quoted.id, state)
        expect(result?.content).not.toContain('quote-inline')
      }
    )

    it('downgrades an accepted quote to deleted when the quoted status is gone', async () => {
      const result = await serializeQuoting(
        `${ACTOR1_ID}/statuses/mq-nonexistent`,
        'accepted'
      )
      const quote = result?.quote as { state: string; quoted_status: unknown }
      expect(quote.state).toBe('deleted')
      expect(quote.quoted_status).toBeNull()
    })

    it('downgrades an accepted quote to unauthorized when the viewer cannot read the quoted status', async () => {
      // Followers-only quoted status; an anonymous viewer cannot read it.
      const quoted = await makeStatus(ACTOR1_ID, {
        to: [`${ACTOR1_ID}/followers`],
        cc: []
      })
      const result = await serializeQuoting(quoted.id, 'accepted')
      const quote = result?.quote as { state: string; quoted_status: unknown }
      expect(quote.state).toBe('unauthorized')
      expect(quote.quoted_status).toBeNull()
    })

    it('hydrates the embedded quote viewer action state on the single-status path', async () => {
      // No batch cache: getQuotedStatus must pass currentActorId so the embedded
      // quoted_status reflects the viewer's bookmark, not a default false.
      const quoted = await makeStatus(ACTOR1_ID)
      await database.createBookmark({ actorId: ACTOR2_ID, statusId: quoted.id })
      const quoting = await makeStatus(ACTOR1_ID)
      await database.createStatusQuote({
        statusId: quoting.id,
        quotedStatusId: quoted.id,
        state: 'accepted'
      })
      const hydrated = (await database.getStatus({
        statusId: quoting.id
      })) as Status

      const result = await getMastodonStatus(database, hydrated, ACTOR2_ID)
      const quote = result?.quote as {
        quoted_status: { bookmarked?: boolean } | null
      }
      expect(quote.quoted_status?.bookmarked).toBe(true)
    })

    it('embeds an accepted quote for an authenticated non-author viewer of a public status', async () => {
      const quoted = await makeStatus(ACTOR1_ID)
      const result = await serializeQuoting(quoted.id, 'accepted', ACTOR2_ID)
      const quote = result?.quote as {
        state: string
        quoted_status: { id: string } | null
      }
      expect(quote.state).toBe('accepted')
      expect(quote.quoted_status?.id).toBe(quoted.publicId)
    })

    it('embeds an accepted quote when the authenticated viewer authored the followers-only quoted status', async () => {
      // Exercises the authenticated getViewerActor + canActorReadStatus self-read
      // path: a followers-only quoted status is readable by its own author.
      const quoted = await makeStatus(ACTOR1_ID, {
        to: [`${ACTOR1_ID}/followers`],
        cc: []
      })
      const result = await serializeQuoting(quoted.id, 'accepted', ACTOR1_ID)
      const quote = result?.quote as {
        state: string
        quoted_status: { id: string } | null
      }
      expect(quote.state).toBe('accepted')
      expect(quote.quoted_status?.id).toBe(quoted.publicId)
    })

    it('resolves the viewer once per batch and embeds readable accepted quotes', async () => {
      // Followers-only quoted status + author viewer, hydrated through the batch
      // path so the viewer Actor comes from options.viewerActor (not a per-status
      // fetch).
      const quoted = await makeStatus(ACTOR1_ID, {
        to: [`${ACTOR1_ID}/followers`],
        cc: []
      })
      const quoting = await makeStatus(ACTOR1_ID)
      await database.createStatusQuote({
        statusId: quoting.id,
        quotedStatusId: quoted.id,
        state: 'accepted'
      })
      const hydrated = (await database.getStatus({
        statusId: quoting.id
      })) as Status

      const [result] = await getMastodonStatuses(
        database,
        [hydrated],
        ACTOR1_ID
      )
      const quote = result.quote as {
        state: string
        quoted_status: { id: string } | null
      }
      expect(quote.state).toBe('accepted')
      expect(quote.quoted_status?.id).toBe(quoted.publicId)
    })

    it('emits a shallow quote at depth 1 and stops recursing', async () => {
      const c = await makeStatus(ACTOR1_ID)
      const b = await makeStatus(ACTOR1_ID)
      await database.createStatusQuote({
        statusId: b.id,
        quotedStatusId: c.id,
        state: 'accepted'
      })
      const a = await makeStatus(ACTOR1_ID)
      await database.createStatusQuote({
        statusId: a.id,
        quotedStatusId: b.id,
        state: 'accepted'
      })

      const hydrated = (await database.getStatus({ statusId: a.id })) as Status
      const result = await getMastodonStatus(database, hydrated)

      const outerQuote = result?.quote as {
        state: string
        quoted_status: {
          id: string
          quote?: { state: string; quoted_status_id?: string }
        }
      }
      expect(outerQuote.quoted_status.id).toBe(b.publicId)
      // The inner quote (B -> C) is shallow: id only, no embedded status.
      const innerQuote = outerQuote.quoted_status.quote as {
        state: string
        quoted_status_id?: string
        quoted_status?: unknown
      }
      expect(innerQuote.quoted_status_id).toBe(c.publicId)
      expect(innerQuote.quoted_status).toBeUndefined()
    })

    it('withholds the quoted id in a shallow quote when the inner edge is not accepted', async () => {
      const c = await makeStatus(ACTOR1_ID)
      const b = await makeStatus(ACTOR1_ID)
      await database.createStatusQuote({
        statusId: b.id,
        quotedStatusId: c.id,
        state: 'pending'
      })
      const a = await makeStatus(ACTOR1_ID)
      await database.createStatusQuote({
        statusId: a.id,
        quotedStatusId: b.id,
        state: 'accepted'
      })

      const hydrated = (await database.getStatus({ statusId: a.id })) as Status
      const result = await getMastodonStatus(database, hydrated)
      const outerQuote = result?.quote as {
        quoted_status: { quote?: { state: string; quoted_status_id: unknown } }
      }
      const innerQuote = outerQuote.quoted_status.quote as {
        state: string
        quoted_status_id: unknown
      }
      expect(innerQuote.state).toBe('pending')
      expect(innerQuote.quoted_status_id).toBeNull()
    })

    it('downgrades a depth-1 accepted quote to unauthorized when the viewer cannot read the innermost status', async () => {
      // A (public) -> B (public), accepted; B -> C accepted, but C is
      // followers-only. An anonymous viewer sees A, embeds B, and the shallow
      // B->C quote must downgrade to unauthorized with no leaked id.
      const c = await makeStatus(ACTOR1_ID, {
        to: [`${ACTOR1_ID}/followers`],
        cc: []
      })
      const b = await makeStatus(ACTOR1_ID)
      await database.createStatusQuote({
        statusId: b.id,
        quotedStatusId: c.id,
        state: 'accepted'
      })
      const a = await makeStatus(ACTOR1_ID)
      await database.createStatusQuote({
        statusId: a.id,
        quotedStatusId: b.id,
        state: 'accepted'
      })

      const hydrated = (await database.getStatus({ statusId: a.id })) as Status
      const result = await getMastodonStatus(database, hydrated)
      const innerQuote = (
        result?.quote as {
          quoted_status: {
            quote?: { state: string; quoted_status_id: unknown }
          }
        }
      ).quoted_status.quote as { state: string; quoted_status_id: unknown }
      expect(innerQuote.state).toBe('unauthorized')
      expect(innerQuote.quoted_status_id).toBeNull()
    })

    it('downgrades a depth-1 accepted quote to deleted when the innermost status is gone', async () => {
      const b = await makeStatus(ACTOR1_ID)
      await database.createStatusQuote({
        statusId: b.id,
        quotedStatusId: `${ACTOR1_ID}/statuses/mq-shallow-missing`,
        state: 'accepted'
      })
      const a = await makeStatus(ACTOR1_ID)
      await database.createStatusQuote({
        statusId: a.id,
        quotedStatusId: b.id,
        state: 'accepted'
      })

      const hydrated = (await database.getStatus({ statusId: a.id })) as Status
      const result = await getMastodonStatus(database, hydrated)
      const innerQuote = (
        result?.quote as {
          quoted_status: {
            quote?: { state: string; quoted_status_id: unknown }
          }
        }
      ).quoted_status.quote as { state: string; quoted_status_id: unknown }
      expect(innerQuote.state).toBe('deleted')
      expect(innerQuote.quoted_status_id).toBeNull()
    })

    it.each([
      {
        description: 'public policy, author viewer',
        policy: undefined,
        viewer: ACTOR1_ID,
        expectedAutomatic: ['public'],
        expectedCurrentUser: 'automatic'
      },
      {
        description: 'public policy, authenticated non-author viewer',
        policy: 'public' as const,
        viewer: ACTOR2_ID,
        expectedAutomatic: ['public'],
        expectedCurrentUser: 'automatic'
      },
      {
        description: 'public policy, anonymous viewer',
        policy: 'public' as const,
        viewer: undefined,
        expectedAutomatic: ['public'],
        expectedCurrentUser: 'unknown'
      },
      {
        description: 'nobody policy, non-author viewer',
        policy: 'nobody' as const,
        viewer: ACTOR2_ID,
        expectedAutomatic: [] as string[],
        expectedCurrentUser: 'denied'
      },
      {
        // ACTOR2 does not have an accepted follow of ACTOR1 (seed), so a
        // followers-policy status by ACTOR1 denies quoting to ACTOR2.
        description: 'followers policy, non-follower viewer',
        policy: 'followers' as const,
        viewer: ACTOR2_ID,
        expectedAutomatic: ['followers'],
        expectedCurrentUser: 'denied'
      },
      {
        // ACTOR3 has an accepted follow of ACTOR2 (seed), so a followers-policy
        // status by ACTOR2 automatically approves quoting for ACTOR3.
        description: 'followers policy, accepted-follower viewer',
        author: ACTOR2_ID,
        policy: 'followers' as const,
        viewer: ACTOR3_ID,
        expectedAutomatic: ['followers'],
        expectedCurrentUser: 'automatic'
      }
    ])(
      'emits quote_approval for $description',
      async ({
        author = ACTOR1_ID,
        policy,
        viewer,
        expectedAutomatic,
        expectedCurrentUser
      }) => {
        counter += 1
        const id = `${author}/statuses/mq-approval-${counter}`
        await database.createNote({
          id,
          url: id,
          actorId: author,
          text: 'approval',
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          ...(policy ? { quoteApprovalPolicy: policy } : {})
        })
        const status = (await database.getStatus({ statusId: id })) as Status
        const result = await getMastodonStatus(database, status, viewer)
        expect(result?.quote_approval).toEqual({
          automatic: expectedAutomatic,
          manual: [],
          current_user: expectedCurrentUser
        })
      }
    )

    it('resolves followers-policy current_user with a single batched follow query', async () => {
      // Three followers-policy statuses by ACTOR2; ACTOR3 is an accepted
      // follower of ACTOR2 (seed), so all three report current_user
      // 'automatic'. The follow relationship must be resolved in ONE batched
      // getAcceptedFollowTargetActorIds call across the whole page (no N+1).
      const statuses: Status[] = []
      for (let i = 0; i < 3; i += 1) {
        counter += 1
        const id = `${ACTOR2_ID}/statuses/mq-approval-batch-${counter}`
        await database.createNote({
          id,
          url: id,
          actorId: ACTOR2_ID,
          text: 'approval batch',
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          quoteApprovalPolicy: 'followers'
        })
        statuses.push((await database.getStatus({ statusId: id })) as Status)
      }

      const spy = vi.spyOn(database, 'getAcceptedFollowTargetActorIds')
      const results = await getMastodonStatuses(database, statuses, ACTOR3_ID)

      expect(results).toHaveLength(3)
      for (const result of results) {
        expect(
          (result.quote_approval as { current_user: string }).current_user
        ).toBe('automatic')
      }
      expect(spy).toHaveBeenCalledTimes(1)
    })

    it('batch-prefetches quoted statuses with a single getStatusesByIds call', async () => {
      const quotingStatuses: Status[] = []
      for (let i = 0; i < 5; i += 1) {
        const quoted = await makeStatus(ACTOR1_ID)
        const quoting = await makeStatus(ACTOR1_ID)
        await database.createStatusQuote({
          statusId: quoting.id,
          quotedStatusId: quoted.id,
          state: 'accepted'
        })
        quotingStatuses.push(
          (await database.getStatus({
            statusId: quoting.id
          })) as Status
        )
      }

      const spy = vi.spyOn(database, 'getStatusesByIds')
      const results = await getMastodonStatuses(database, quotingStatuses)

      expect(results).toHaveLength(5)
      // One call for the quoted-status prefetch (no replies in these fixtures).
      expect(spy).toHaveBeenCalledTimes(1)
      for (const result of results) {
        expect((result.quote as { state: string }).state).toBe('accepted')
      }
    })
  })
})
