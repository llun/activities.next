import { StatusEditRevision } from '@/lib/types/database/operations'
import { Attachment } from '@/lib/types/domain/attachment'

import { getStatusEditTransitions } from './statusEditChanges'

type Snapshot = Omit<StatusEditRevision, 'createdAt' | 'supersededAt'>

const allFieldsAvailable: Snapshot['available'] = {
  text: true,
  summary: true,
  sensitive: true,
  attachments: true,
  pollOptions: true
}

const snapshot = (
  overrides: Partial<Snapshot> = {},
  supersededAt = 100
): StatusEditRevision => ({
  text: 'Old text',
  summary: null,
  sensitive: false,
  attachments: [],
  pollOptions: null,
  available: allFieldsAvailable,
  createdAt: 1,
  supersededAt,
  ...overrides
})

const current = (overrides: Partial<Snapshot> = {}): Snapshot => ({
  text: 'New text',
  summary: null,
  sensitive: false,
  attachments: [],
  pollOptions: null,
  available: allFieldsAvailable,
  ...overrides
})

const attachment = (overrides: Partial<Attachment> = {}): Attachment => ({
  id: '1',
  actorId: 'actor',
  statusId: 'status',
  type: 'Document',
  mediaType: 'image/jpeg',
  url: 'https://example.com/ride.jpg',
  name: 'Ride map',
  createdAt: 1,
  updatedAt: 1,
  ...overrides
})

describe('getStatusEditTransitions', () => {
  it.each([
    { before: '', after: 'Ride stats', expected: 'text-added' },
    { before: 'Old text', after: 'New text', expected: 'text-updated' },
    { before: 'Old text', after: ' ', expected: 'text-removed' }
  ] as const)(
    'describes text changes from "$before" to "$after"',
    ({ before, after, expected }) => {
      const [transition] = getStatusEditTransitions(
        [snapshot({ text: before })],
        current({ text: after }),
        false
      )

      expect(transition.changes).toContain(expected)
    }
  )

  it('reports image additions and removals while other images remain', () => {
    const first = attachment({ id: 'first', url: 'https://example.com/1.jpg' })
    const second = attachment({
      id: 'second',
      url: 'https://example.com/2.jpg'
    })

    const [added] = getStatusEditTransitions(
      [snapshot({ attachments: [first] })],
      current({ attachments: [first, second] }),
      false
    )
    const [removed] = getStatusEditTransitions(
      [snapshot({ attachments: [first, second] })],
      current({ attachments: [second] }),
      false
    )

    expect(added.changes).toContain('images-added')
    expect(removed.changes).toContain('images-removed')
  })

  it.each([
    {
      description: 'alt text',
      before: attachment({ name: 'Old description' }),
      after: attachment({ name: 'New description' })
    },
    {
      description: 'focal point',
      before: attachment({ focus: { x: 0, y: 0 } }),
      after: attachment({ focus: { x: 0.4, y: -0.2 } })
    },
    {
      description: 'order',
      before: [
        attachment({ id: 'first', url: 'https://example.com/1.jpg' }),
        attachment({ id: 'second', url: 'https://example.com/2.jpg' })
      ],
      after: [
        attachment({ id: 'second', url: 'https://example.com/2.jpg' }),
        attachment({ id: 'first', url: 'https://example.com/1.jpg' })
      ]
    }
  ])('reports image updates when $description changes', ({ before, after }) => {
    const [transition] = getStatusEditTransitions(
      [snapshot({ attachments: Array.isArray(before) ? before : [before] })],
      current({ attachments: Array.isArray(after) ? after : [after] }),
      false
    )

    expect(transition.changes).toContain('images-updated')
  })

  it('uses attachment labels for non-image media and reports mixed changes', () => {
    const image = attachment()
    const tcx = attachment({
      id: 'tcx',
      mediaType: 'application/vnd.garmin.tcx+xml',
      url: 'https://example.com/ride.tcx',
      name: 'Original activity'
    })
    const [transition] = getStatusEditTransitions(
      [snapshot()],
      current({ attachments: [image, tcx] }),
      false
    )

    expect(transition.changes).toContain('images-added')
    expect(transition.changes).toContain('attachments-added')
  })

  it('reports reordering between image and non-image attachments', () => {
    const image = attachment({ url: 'https://example.com/ride.jpg' })
    const video = attachment({
      id: 'video',
      mediaType: 'video/mp4',
      url: 'https://example.com/ride.mp4'
    })
    const [transition] = getStatusEditTransitions(
      [snapshot({ text: 'Same', attachments: [image, video] })],
      current({ text: 'Same', attachments: [video, image] }),
      false
    )

    expect(transition.changes).toEqual([
      'images-updated',
      'attachments-updated'
    ])
  })

  it('describes content warning, sensitivity, and poll option changes', () => {
    const [transition] = getStatusEditTransitions(
      [
        snapshot({
          summary: null,
          sensitive: false,
          pollOptions: ['Before', 'Other']
        })
      ],
      current({
        summary: 'Contains a spoiler',
        sensitive: true,
        pollOptions: ['After', 'Other']
      }),
      true
    )

    expect(transition.changes).toEqual([
      'text-updated',
      'content-warning-changed',
      'sensitive-setting-changed',
      'poll-options-changed'
    ])
  })

  it('compares each revision with its next version and preserves transition times', () => {
    const map = attachment()
    const revisions = [
      snapshot({ text: '', attachments: [] }, 50),
      snapshot({ text: 'Ride', attachments: [map] }, 100)
    ]
    const transitions = getStatusEditTransitions(
      revisions,
      current({ text: 'Ride stats', attachments: [map] }),
      false
    )

    expect(transitions).toEqual([
      {
        editedAt: 50,
        changes: ['text-added', 'images-added'],
        changeDetailsUnavailable: false
      },
      {
        editedAt: 100,
        changes: ['text-updated'],
        changeDetailsUnavailable: false
      }
    ])
  })

  it('keeps known labels and marks missing legacy snapshot details unavailable', () => {
    const [transition] = getStatusEditTransitions(
      [
        snapshot({
          text: '',
          available: {
            text: true,
            summary: true,
            sensitive: false,
            attachments: false,
            pollOptions: false
          }
        })
      ],
      current({ text: 'Ride stats', attachments: [attachment()] }),
      false
    )

    expect(transition.changes).toEqual(['text-added'])
    expect(transition.changeDetailsUnavailable).toBe(true)
  })

  it('treats null poll options as missing snapshot data for a poll', () => {
    const [transition] = getStatusEditTransitions(
      [snapshot({ pollOptions: null })],
      current({ pollOptions: ['Current option', 'Another option'] }),
      true
    )

    expect(transition.changes).not.toContain('poll-options-changed')
    expect(transition.changeDetailsUnavailable).toBe(true)
  })

  it('ignores database and generated attachment metadata', () => {
    const before = attachment({
      id: 'before',
      mediaId: '11',
      width: 320,
      height: 240,
      blurhash: 'old-blurhash',
      thumbnailUrl: 'https://example.com/old-thumbnail.jpg',
      createdAt: 1,
      updatedAt: 2
    })
    const after = attachment({
      id: 'after',
      mediaId: '22',
      width: 640,
      height: 480,
      blurhash: 'new-blurhash',
      thumbnailUrl: 'https://example.com/new-thumbnail.jpg',
      createdAt: 30,
      updatedAt: 40
    })
    const [transition] = getStatusEditTransitions(
      [snapshot({ text: 'Same', attachments: [before] })],
      current({ text: 'Same', attachments: [after] }),
      false
    )

    expect(transition.changes).toEqual([])
  })
})
