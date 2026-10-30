import { serializeAccountImport } from '@/lib/services/accountImport/serialize'
import type { AccountImport } from '@/lib/types/domain/accountImport'

const baseImport: AccountImport = {
  id: 'import-1',
  accountId: 'account-1',
  actorId: 'https://llun.test/users/actor-1',
  status: 'done',
  kind: 'mastodon',
  archiveETag: null,
  options: '{}',
  storageToken: 'token',
  uploadedBytes: 100,
  progress: null,
  phase: null,
  cursor: null,
  runToken: null,
  claimedUntil: null,
  lastErrorCode: null,
  createdAt: Date.UTC(2026, 0, 1, 12, 0, 0),
  startedAt: Date.UTC(2026, 0, 1, 12, 1, 0),
  finishedAt: Date.UTC(2026, 0, 1, 12, 2, 0),
  updatedAt: Date.UTC(2026, 0, 1, 12, 2, 0)
}

describe('serializeAccountImport', () => {
  it('serializes the safe fields and no report by default', () => {
    expect(serializeAccountImport(baseImport)).toEqual({
      id: 'import-1',
      status: 'done',
      kind: 'mastodon',
      phase: null,
      progress: {
        version: 1,
        sourceActorId: null,
        sourceFollowersUrl: null,
        statusOrder: 'newest-first',
        catalogStage: 'statuses',
        catalogIndex: 0,
        totalItems: 0,
        completedItems: 0,
        skippedItems: 0,
        continuationCount: 0
      },
      createdAt: '2026-01-01T12:00:00.000Z',
      startedAt: '2026-01-01T12:01:00.000Z',
      finishedAt: '2026-01-01T12:02:00.000Z',
      lastErrorCode: null
    })
  })
})
