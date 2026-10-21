import type { DraftRecord } from '@/lib/client/drafts'
import type { ActorProfile } from '@/lib/types/domain/actor'
import type { Status } from '@/lib/types/domain/status'

export const NOW = new Date('2026-10-21T12:00:00.000Z').getTime()

export const ACTOR_ID = 'https://llun.test/users/me'

export const profile = {
  id: ACTOR_ID,
  username: 'me',
  domain: 'llun.test'
} as unknown as ActorProfile

export const draftRecord = (patch: Partial<DraftRecord> = {}): DraftRecord => ({
  id: 'draft-1',
  accountId: 'account-1',
  actorId: ACTOR_ID,
  revision: 1,
  createdAt: NOW - 3_600_000,
  updatedAt: NOW - 12 * 60_000,
  composer: 'post-box',
  text: 'A post I have not sent',
  contentWarning: '',
  contentWarningVisible: false,
  visibility: 'public',
  quoteApprovalPolicy: 'public',
  attachments: [],
  ...patch
})

/** The few fields a draft preview reads from a reply or quote target. */
export const targetStatus = (username: string, domain: string): Status =>
  ({
    id: `https://${domain}/users/${username}/statuses/1`,
    actorId: `https://${domain}/users/${username}`,
    actor: { id: `https://${domain}/users/${username}`, username, domain },
    type: 'Note',
    text: 'Original'
  }) as unknown as Status
