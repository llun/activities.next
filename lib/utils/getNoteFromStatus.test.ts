import type { Status } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { getNoteFromStatus } from '@/lib/utils/getNoteFromStatus'

const ACTOR_ID = 'https://llun.test/users/me'
const STATUS_ID = `${ACTOR_ID}/statuses/1`
const QUOTED_ID = 'https://remote.example/users/alice/statuses/7'

const baseStatus = (overrides: Record<string, unknown> = {}): Status =>
  ({
    id: STATUS_ID,
    type: 'Note',
    actorId: ACTOR_ID,
    url: 'https://llun.test/@me/1',
    text: 'hello',
    summary: null,
    to: [ACTIVITY_STREAM_PUBLIC],
    cc: [],
    reply: '',
    attachments: [],
    tags: [],
    replies: [],
    edits: [],
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    ...overrides
  }) as unknown as Status

describe('getNoteFromStatus quote emission', () => {
  it('emits the quote target under all compat aliases plus the stamp for an accepted quote', () => {
    const note = getNoteFromStatus(
      baseStatus({
        quote: {
          quotedStatusId: QUOTED_ID,
          state: 'accepted',
          authorizationUri: 'https://remote.example/stamp/1'
        }
      })
    ) as Record<string, unknown>

    expect(note.quote).toBe(QUOTED_ID)
    expect(note.quoteUrl).toBe(QUOTED_ID)
    expect(note.quoteUri).toBe(QUOTED_ID)
    expect(note._misskey_quote).toBe(QUOTED_ID)
    expect(note.quoteAuthorization).toBe('https://remote.example/stamp/1')
  })

  it('emits a pending quote target without a stamp', () => {
    const note = getNoteFromStatus(
      baseStatus({
        quote: { quotedStatusId: QUOTED_ID, state: 'pending' }
      })
    ) as Record<string, unknown>

    expect(note.quote).toBe(QUOTED_ID)
    expect(note.quoteAuthorization).toBeUndefined()
  })

  it('does not emit a quote target for a terminal (revoked) edge', () => {
    const note = getNoteFromStatus(
      baseStatus({
        quote: { quotedStatusId: QUOTED_ID, state: 'revoked' }
      })
    ) as Record<string, unknown>

    expect(note.quote).toBeUndefined()
  })

  it.each([
    { policy: undefined, expected: [ACTIVITY_STREAM_PUBLIC] },
    { policy: 'public', expected: [ACTIVITY_STREAM_PUBLIC] },
    { policy: 'followers', expected: [`${ACTOR_ID}/followers`] },
    { policy: 'nobody', expected: [ACTOR_ID] }
  ])(
    'advertises interactionPolicy.canQuote.automaticApproval for policy $policy',
    ({ policy, expected }) => {
      const note = getNoteFromStatus(
        baseStatus(policy ? { quoteApprovalPolicy: policy } : {})
      ) as Record<string, unknown>

      const interactionPolicy = note.interactionPolicy as {
        canQuote: { automaticApproval: string[]; manualApproval: string[] }
      }
      expect(interactionPolicy.canQuote.automaticApproval).toEqual(expected)
      expect(interactionPolicy.canQuote.manualApproval).toEqual([])
    }
  )
})
