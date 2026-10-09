import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getServerSoftware } from '@/lib/services/federation/serverSoftware'
import { MediaDatabase } from '@/lib/types/database/operations'
import { Attachment } from '@/lib/types/domain/attachment'
import {
  StatusAnnounce,
  StatusNote,
  StatusPoll,
  StatusType
} from '@/lib/types/domain/status'
import { logger } from '@/lib/utils/logger'
import { safeRemoteFetch } from '@/lib/utils/safeRemoteFetch'

import {
  BATCH_ANIMATION_METADATA_CONCURRENCY,
  BATCH_ANIMATION_METADATA_TIMEOUT_MS,
  MAX_BATCH_ANIMATION_METADATA_LOOKUPS,
  clearAnimationMetadataCacheForTests,
  enrichStatusesAttachments
} from './animationMetadata'

vi.mock('@/lib/services/federation/serverSoftware', () => ({
  getServerSoftware: vi.fn()
}))

vi.mock('@/lib/utils/safeRemoteFetch', () => ({
  safeRemoteFetch: vi.fn()
}))

describe('enrichStatusesAttachments', () => {
  const mockDb: MediaDatabase = {
    updateAttachmentPlayback: vi.fn().mockResolvedValue(true)
  } as unknown as MediaDatabase

  beforeEach(() => {
    clearAnimationMetadataCacheForTests()
    vi.mocked(getServerSoftware).mockReset()
    vi.mocked(safeRemoteFetch).mockReset()
    vi.mocked(mockDb.updateAttachmentPlayback).mockReset()
    vi.mocked(getServerSoftware).mockResolvedValue('mastodon')
  })

  it('returns empty array when given empty or null statuses', async () => {
    expect(await enrichStatusesAttachments([])).toEqual([])
  })

  describe('a batch containing Notes, Polls, and Announce boosts', () => {
    const AUTHOR_ID = 'https://mastodon.social/users/cheeaun'
    const statusIdFor = (statusNumber: number) =>
      `${AUTHOR_ID}/statuses/${statusNumber}`
    const mediaUrlFor = (statusNumber: number) =>
      `https://files.mastodon.social/media/${statusNumber}.mp4`
    const previewUrlFor = (statusNumber: number) =>
      `https://files.mastodon.social/media/${statusNumber}-preview.png`

    const makeAttachment = (
      statusNumber: number,
      id: string,
      name: string
    ): Attachment => ({
      id,
      actorId: AUTHOR_ID,
      statusId: statusIdFor(statusNumber),
      type: 'Document',
      mediaType: 'video/mp4',
      url: mediaUrlFor(statusNumber),
      name,
      createdAt: Date.now(),
      updatedAt: Date.now()
    })

    const gifvResponse = (
      url: string,
      statusNumber: number,
      mediaId: string,
      status: StatusNote | StatusPoll
    ) => ({
      statusCode: 200,
      body: JSON.stringify({
        id: String(statusNumber),
        uri: status.id,
        url: status.url,
        account: { url: 'https://mastodon.social/@cheeaun' },
        media_attachments: [
          {
            id: mediaId,
            type: 'gifv',
            url: mediaUrlFor(statusNumber),
            preview_url: previewUrlFor(statusNumber)
          }
        ]
      }),
      bodyTruncated: false,
      headers: {},
      url
    })

    let noteAttachment: Attachment
    let pollAttachment: Attachment
    let boostOriginalAttachment: Attachment
    let results: Awaited<ReturnType<typeof enrichStatusesAttachments>>

    beforeEach(async () => {
      noteAttachment = makeAttachment(1001, 'note-att-1', 'Note video')
      const noteStatus: StatusNote = {
        id: statusIdFor(1001),
        url: 'https://mastodon.social/@cheeaun/1001',
        actorId: AUTHOR_ID,
        actor: null,
        type: StatusType.enum.Note,
        text: 'Note text',
        summary: null,
        reply: '',
        replies: [],
        totalReplies: 0,
        actorAnnounceStatusId: null,
        isActorLiked: false,
        isActorBookmarked: false,
        totalLikes: 0,
        totalShares: 0,
        to: [],
        cc: [],
        edits: [],
        attachments: [noteAttachment],
        tags: [],
        isLocalActor: false,
        createdAt: Date.now(),
        updatedAt: Date.now()
      }

      pollAttachment = makeAttachment(1002, 'poll-att-1', 'Poll video')
      const pollStatus: StatusPoll = {
        ...noteStatus,
        id: statusIdFor(1002),
        url: 'https://mastodon.social/@cheeaun/1002',
        type: StatusType.enum.Poll,
        choices: [],
        endAt: Date.now() + 10000,
        pollType: 'oneOf',
        attachments: [pollAttachment]
      }

      boostOriginalAttachment = makeAttachment(
        1003,
        'boost-orig-att-1',
        'Boost original video'
      )
      const boostOriginalStatus: StatusNote = {
        ...noteStatus,
        id: statusIdFor(1003),
        url: 'https://mastodon.social/@cheeaun/1003',
        attachments: [boostOriginalAttachment]
      }

      const boostStatus: StatusAnnounce = {
        id: 'https://llun.test/users/booster/statuses/boost-1',
        actorId: 'https://llun.test/users/booster',
        actor: null,
        type: StatusType.enum.Announce,
        to: [],
        cc: [],
        edits: [],
        isLocalActor: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        originalStatus: boostOriginalStatus
      }

      const lookups = [
        { statusNumber: 1001, mediaId: 'm1', status: noteStatus },
        { statusNumber: 1002, mediaId: 'm2', status: pollStatus },
        { statusNumber: 1003, mediaId: 'm3', status: boostOriginalStatus }
      ]
      vi.mocked(safeRemoteFetch).mockImplementation(async ({ url }) => {
        const lookup = lookups.find(({ statusNumber }) =>
          url.includes(String(statusNumber))
        )
        if (lookup) {
          return gifvResponse(
            url,
            lookup.statusNumber,
            lookup.mediaId,
            lookup.status
          )
        }
        return {
          statusCode: 404,
          body: '',
          bodyTruncated: false,
          headers: {},
          url
        }
      })

      results = await enrichStatusesAttachments(
        [noteStatus, pollStatus, boostStatus],
        mockDb
      )
    })

    it('returns one result per status in the batch', () => {
      expect(results).toHaveLength(3)
    })

    it.each([
      ['Note', 1001, 'note-att-1'],
      ['Poll', 1002, 'poll-att-1'],
      ['Announce original', 1003, 'boost-orig-att-1']
    ] as const)(
      'enriches the %s attachment and writes it with onlyIfUnset',
      (kind, statusNumber, attachmentId) => {
        const attachment = {
          Note: noteAttachment,
          Poll: pollAttachment,
          'Announce original': boostOriginalAttachment
        }[kind]

        expect(attachment.playbackType).toBe('gifv')
        expect(attachment.thumbnailUrl).toBe(previewUrlFor(statusNumber))

        // DB calls were made with onlyIfUnset: true
        expect(mockDb.updateAttachmentPlayback).toHaveBeenCalledWith({
          id: attachmentId,
          statusId: statusIdFor(statusNumber),
          playbackType: 'gifv',
          thumbnailUrl: previewUrlFor(statusNumber),
          onlyIfUnset: true
        })
      }
    )

    it('writes exactly one playback update per enriched attachment', () => {
      expect(mockDb.updateAttachmentPlayback).toHaveBeenCalledTimes(3)
    })
  })

  it('deduplicates repeated Announce originals and triggers only one remote lookup', async () => {
    const sharedAttachment: Attachment = {
      id: 'shared-att-1',
      actorId: 'https://mastodon.social/users/cheeaun',
      statusId: 'https://mastodon.social/users/cheeaun/statuses/shared',
      type: 'Document',
      mediaType: 'video/mp4',
      url: 'https://files.mastodon.social/media/shared.mp4',
      name: 'Shared video',
      createdAt: Date.now(),
      updatedAt: Date.now()
    }

    const originalNote: StatusNote = {
      id: 'https://mastodon.social/users/cheeaun/statuses/shared',
      url: 'https://mastodon.social/@cheeaun/shared',
      actorId: 'https://mastodon.social/users/cheeaun',
      actor: null,
      type: StatusType.enum.Note,
      text: 'Original shared note',
      summary: null,
      reply: '',
      replies: [],
      totalReplies: 0,
      actorAnnounceStatusId: null,
      isActorLiked: false,
      isActorBookmarked: false,
      totalLikes: 0,
      totalShares: 0,
      to: [],
      cc: [],
      edits: [],
      attachments: [sharedAttachment],
      tags: [],
      isLocalActor: false,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }

    const boost1: StatusAnnounce = {
      id: 'https://llun.test/users/booster1/statuses/b1',
      actorId: 'https://llun.test/users/booster1',
      actor: null,
      type: StatusType.enum.Announce,
      to: [],
      cc: [],
      edits: [],
      isLocalActor: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      originalStatus: originalNote
    }

    // A separate clone/instance of the same original note
    const clonedOriginalNote: StatusNote = {
      ...originalNote,
      attachments: [{ ...sharedAttachment }]
    }

    const boost2: StatusAnnounce = {
      id: 'https://llun.test/users/booster2/statuses/b2',
      actorId: 'https://llun.test/users/booster2',
      actor: null,
      type: StatusType.enum.Announce,
      to: [],
      cc: [],
      edits: [],
      isLocalActor: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      originalStatus: clonedOriginalNote
    }

    vi.mocked(safeRemoteFetch).mockResolvedValue({
      statusCode: 200,
      body: JSON.stringify({
        id: 'shared',
        uri: originalNote.id,
        url: originalNote.url,
        account: { url: 'https://mastodon.social/@cheeaun' },
        media_attachments: [
          {
            id: 'm-shared',
            type: 'gifv',
            url: 'https://files.mastodon.social/media/shared.mp4',
            preview_url: 'https://files.mastodon.social/media/shared-thumb.png'
          }
        ]
      }),
      bodyTruncated: false,
      headers: {},
      url: 'https://mastodon.social/api/v1/statuses/shared'
    })

    const results = await enrichStatusesAttachments([boost1, boost2], mockDb)
    expect(results).toHaveLength(2)

    // safeRemoteFetch was called exactly ONCE for the shared original
    expect(safeRemoteFetch).toHaveBeenCalledTimes(1)

    // Both boost original instances were enriched
    expect(sharedAttachment.playbackType).toBe('gifv')
    expect(clonedOriginalNote.attachments[0].playbackType).toBe('gifv')
    expect(clonedOriginalNote.attachments[0].thumbnailUrl).toBe(
      'https://files.mastodon.social/media/shared-thumb.png'
    )
  })

  it('skips statuses that already have playbackType set', async () => {
    const classifiedAttachment: Attachment = {
      id: 'att-already-gifv',
      actorId: 'https://mastodon.social/users/cheeaun',
      statusId: 'https://mastodon.social/users/cheeaun/statuses/999',
      type: 'Document',
      mediaType: 'video/mp4',
      url: 'https://files.mastodon.social/media/999.mp4',
      name: 'Classified',
      playbackType: 'gifv',
      createdAt: Date.now(),
      updatedAt: Date.now()
    }

    const status: StatusNote = {
      id: 'https://mastodon.social/users/cheeaun/statuses/999',
      url: 'https://mastodon.social/@cheeaun/999',
      actorId: 'https://mastodon.social/users/cheeaun',
      actor: null,
      type: StatusType.enum.Note,
      text: 'Already classified',
      summary: null,
      reply: '',
      replies: [],
      totalReplies: 0,
      actorAnnounceStatusId: null,
      isActorLiked: false,
      isActorBookmarked: false,
      totalLikes: 0,
      totalShares: 0,
      to: [],
      cc: [],
      edits: [],
      attachments: [classifiedAttachment],
      tags: [],
      isLocalActor: false,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }

    await enrichStatusesAttachments([status], mockDb)
    expect(safeRemoteFetch).not.toHaveBeenCalled()
  })

  it('bounds candidate lookups to MAX_BATCH_ANIMATION_METADATA_LOOKUPS (20)', async () => {
    const statuses: StatusNote[] = Array.from({ length: 25 }, (_, i) => ({
      id: `https://mastodon.social/users/cheeaun/statuses/bound-${i}`,
      url: `https://mastodon.social/@cheeaun/bound-${i}`,
      actorId: 'https://mastodon.social/users/cheeaun',
      actor: null,
      type: StatusType.enum.Note,
      text: `Bound note ${i}`,
      summary: null,
      reply: '',
      replies: [],
      totalReplies: 0,
      actorAnnounceStatusId: null,
      isActorLiked: false,
      isActorBookmarked: false,
      totalLikes: 0,
      totalShares: 0,
      to: [],
      cc: [],
      edits: [],
      attachments: [
        {
          id: `bound-att-${i}`,
          actorId: 'https://mastodon.social/users/cheeaun',
          statusId: `https://mastodon.social/users/cheeaun/statuses/bound-${i}`,
          type: 'Document',
          mediaType: 'video/mp4',
          url: `https://files.mastodon.social/media/bound-${i}.mp4`,
          name: `bound-${i}`,
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      ],
      tags: [],
      isLocalActor: false,
      createdAt: Date.now() - i * 1000,
      updatedAt: Date.now() - i * 1000
    }))

    vi.mocked(safeRemoteFetch).mockImplementation(async ({ url }) => {
      const match = url.match(/bound-(\d+)/)
      const index = match ? match[1] : '0'
      return {
        statusCode: 200,
        body: JSON.stringify({
          id: `bound-${index}`,
          uri: `https://mastodon.social/users/cheeaun/statuses/bound-${index}`,
          url: `https://mastodon.social/@cheeaun/bound-${index}`,
          account: { url: 'https://mastodon.social/@cheeaun' },
          media_attachments: [
            {
              id: `m-bound-${index}`,
              type: 'gifv',
              url: `https://files.mastodon.social/media/bound-${index}.mp4`
            }
          ]
        }),
        bodyTruncated: false,
        headers: {},
        url
      }
    })

    const results = await enrichStatusesAttachments(statuses, mockDb)
    expect(results).toHaveLength(25)
    // Exactly MAX_BATCH_ANIMATION_METADATA_LOOKUPS (20) lookups were performed
    expect(safeRemoteFetch).toHaveBeenCalledTimes(
      MAX_BATCH_ANIMATION_METADATA_LOOKUPS
    )

    // First 20 are enriched
    for (let i = 0; i < MAX_BATCH_ANIMATION_METADATA_LOOKUPS; i++) {
      expect((results[i] as StatusNote).attachments[0].playbackType).toBe(
        'gifv'
      )
    }
    // Remaining 5 are left unclassified
    for (let i = MAX_BATCH_ANIMATION_METADATA_LOOKUPS; i < 25; i++) {
      expect(
        (results[i] as StatusNote).attachments[0].playbackType
      ).toBeUndefined()
    }
  })

  it('handles timeout when batch execution exceeds BATCH_ANIMATION_METADATA_TIMEOUT_MS', async () => {
    const status: StatusNote = {
      id: 'https://mastodon.social/users/cheeaun/statuses/timeout-test',
      url: 'https://mastodon.social/@cheeaun/timeout-test',
      actorId: 'https://mastodon.social/users/cheeaun',
      actor: null,
      type: StatusType.enum.Note,
      text: 'Timeout test',
      summary: null,
      reply: '',
      replies: [],
      totalReplies: 0,
      actorAnnounceStatusId: null,
      isActorLiked: false,
      isActorBookmarked: false,
      totalLikes: 0,
      totalShares: 0,
      to: [],
      cc: [],
      edits: [],
      attachments: [
        {
          id: 'timeout-att',
          actorId: 'https://mastodon.social/users/cheeaun',
          statusId:
            'https://mastodon.social/users/cheeaun/statuses/timeout-test',
          type: 'Document',
          mediaType: 'video/mp4',
          url: 'https://files.mastodon.social/media/timeout.mp4',
          name: 'timeout',
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      ],
      tags: [],
      isLocalActor: false,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }

    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    vi.useFakeTimers()
    try {
      // safeRemoteFetch never resolves
      vi.mocked(safeRemoteFetch).mockImplementation(() => new Promise(() => {}))

      const enrichPromise = enrichStatusesAttachments([status], mockDb)
      await vi.advanceTimersByTimeAsync(
        BATCH_ANIMATION_METADATA_TIMEOUT_MS + 50
      )
      const results = await enrichPromise

      expect(results).toHaveLength(1)
      expect(
        (results[0] as StatusNote).attachments[0].playbackType
      ).toBeUndefined()
      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Batch animation metadata enrichment timed out'
        })
      )
    } finally {
      vi.useRealTimers()
      warnSpy.mockRestore()
    }
  })

  // Regression (F001): the deadline raced the batch without cancelling it, so
  // after the timeline response went out `mapWithConcurrency` kept starting
  // the later chunks' remote fetches anyway.
  it('starts no further lookups once the batch deadline has passed', async () => {
    const total = BATCH_ANIMATION_METADATA_CONCURRENCY * 2
    const statuses: StatusNote[] = Array.from({ length: total }, (_, i) => ({
      id: `https://mastodon.social/users/cheeaun/statuses/abandon-${i}`,
      url: `https://mastodon.social/@cheeaun/abandon-${i}`,
      actorId: 'https://mastodon.social/users/cheeaun',
      actor: null,
      type: StatusType.enum.Note,
      text: `Abandon ${i}`,
      summary: null,
      reply: '',
      replies: [],
      totalReplies: 0,
      actorAnnounceStatusId: null,
      isActorLiked: false,
      isActorBookmarked: false,
      totalLikes: 0,
      totalShares: 0,
      to: [],
      cc: [],
      edits: [],
      attachments: [
        {
          id: `abandon-att-${i}`,
          actorId: 'https://mastodon.social/users/cheeaun',
          statusId: `https://mastodon.social/users/cheeaun/statuses/abandon-${i}`,
          type: 'Document',
          mediaType: 'video/mp4',
          url: `https://files.mastodon.social/media/abandon-${i}.mp4`,
          name: `abandon-${i}`,
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      ],
      tags: [],
      isLocalActor: false,
      createdAt: Date.now() - i * 1000,
      updatedAt: Date.now() - i * 1000
    }))

    const pending: Array<() => void> = []
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    vi.useFakeTimers()
    try {
      // Every lookup hangs until released, so the first chunk outlives the
      // deadline.
      vi.mocked(safeRemoteFetch).mockImplementation(
        ({ url }) =>
          new Promise((resolve) => {
            pending.push(() =>
              resolve({
                statusCode: 404,
                body: '',
                bodyTruncated: false,
                headers: {},
                url
              })
            )
          })
      )
      const lookupsFor = () =>
        vi
          .mocked(safeRemoteFetch)
          .mock.calls.filter(([{ url }]) => url.includes('abandon-')).length

      const enrichPromise = enrichStatusesAttachments(statuses, mockDb)
      await vi.advanceTimersByTimeAsync(
        BATCH_ANIMATION_METADATA_TIMEOUT_MS + 50
      )
      await enrichPromise
      const startedBeforeDeadline = lookupsFor()
      expect(startedBeforeDeadline).toBeGreaterThan(0)
      expect(startedBeforeDeadline).toBeLessThanOrEqual(
        BATCH_ANIMATION_METADATA_CONCURRENCY
      )

      // Let the abandoned first chunk finish; the next chunk must not start.
      while (pending.length > 0) {
        pending.splice(0).forEach((release) => release())
        await vi.advanceTimersByTimeAsync(10)
      }

      expect(lookupsFor()).toBe(startedBeforeDeadline)
    } finally {
      vi.useRealTimers()
      warnSpy.mockRestore()
    }
  })

  it('isolates candidate errors so other candidates in the batch succeed', async () => {
    const failingStatus: StatusNote = {
      id: 'https://mastodon.social/users/cheeaun/statuses/failing-candidate',
      url: 'https://mastodon.social/@cheeaun/failing-candidate',
      actorId: 'https://mastodon.social/users/cheeaun',
      actor: null,
      type: StatusType.enum.Note,
      text: 'Failing candidate',
      summary: null,
      reply: '',
      replies: [],
      totalReplies: 0,
      actorAnnounceStatusId: null,
      isActorLiked: false,
      isActorBookmarked: false,
      totalLikes: 0,
      totalShares: 0,
      to: [],
      cc: [],
      edits: [],
      attachments: [
        {
          id: 'fail-att',
          actorId: 'https://mastodon.social/users/cheeaun',
          statusId:
            'https://mastodon.social/users/cheeaun/statuses/failing-candidate',
          type: 'Document',
          mediaType: 'video/mp4',
          url: 'https://files.mastodon.social/media/fail.mp4',
          name: 'fail',
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      ],
      tags: [],
      isLocalActor: false,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }

    const succeedingStatus: StatusNote = {
      id: 'https://mastodon.social/users/cheeaun/statuses/succeeding-candidate',
      url: 'https://mastodon.social/@cheeaun/succeeding-candidate',
      actorId: 'https://mastodon.social/users/cheeaun',
      actor: null,
      type: StatusType.enum.Note,
      text: 'Succeeding candidate',
      summary: null,
      reply: '',
      replies: [],
      totalReplies: 0,
      actorAnnounceStatusId: null,
      isActorLiked: false,
      isActorBookmarked: false,
      totalLikes: 0,
      totalShares: 0,
      to: [],
      cc: [],
      edits: [],
      attachments: [
        {
          id: 'success-att',
          actorId: 'https://mastodon.social/users/cheeaun',
          statusId:
            'https://mastodon.social/users/cheeaun/statuses/succeeding-candidate',
          type: 'Document',
          mediaType: 'video/mp4',
          url: 'https://files.mastodon.social/media/success.mp4',
          name: 'success',
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      ],
      tags: [],
      isLocalActor: false,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }

    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    try {
      vi.mocked(safeRemoteFetch).mockImplementation(async ({ url }) => ({
        statusCode: 200,
        body: JSON.stringify({
          id: url.includes('failing')
            ? 'failing-candidate'
            : 'succeeding-candidate',
          uri: url.includes('failing') ? failingStatus.id : succeedingStatus.id,
          url,
          account: { url: 'https://mastodon.social/@cheeaun' },
          media_attachments: [
            {
              id: 'm-anim',
              type: 'gifv',
              url: url.includes('failing')
                ? 'https://files.mastodon.social/media/fail.mp4'
                : 'https://files.mastodon.social/media/success.mp4'
            }
          ]
        }),
        bodyTruncated: false,
        headers: {},
        url
      }))

      vi.mocked(mockDb.updateAttachmentPlayback).mockImplementation(
        async ({ id }) => {
          if (id === 'fail-att') {
            throw new Error('Database write error')
          }
          return true
        }
      )

      const results = await enrichStatusesAttachments(
        [failingStatus, succeedingStatus],
        mockDb
      )
      expect(results).toHaveLength(2)
      // Succeeding candidate was successfully enriched and updated
      expect((results[1] as StatusNote).attachments[0].playbackType).toBe(
        'gifv'
      )
      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Failed to enrich status attachments in batch',
          statusId: failingStatus.id
        })
      )
    } finally {
      warnSpy.mockRestore()
    }
  })
})
