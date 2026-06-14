import type { ServerAnnouncement } from '@/lib/client'

import { computeAnnouncementStatus } from './announcementStatus'

const NOW = Date.parse('2026-06-13T12:00:00.000Z')
const HOUR = 60 * 60 * 1000

const build = (
  overrides: Partial<
    Pick<ServerAnnouncement, 'published' | 'starts_at' | 'ends_at'>
  >
): Pick<ServerAnnouncement, 'published' | 'starts_at' | 'ends_at'> => ({
  published: false,
  starts_at: null,
  ends_at: null,
  ...overrides
})

describe('computeAnnouncementStatus', () => {
  it.each([
    {
      description: 'unpublished is Draft',
      input: { published: false },
      expectedStatus: 'draft',
      expectedLabel: 'Draft',
      expectedTone: 'gray'
    },
    {
      description: 'published with no end time is Published',
      input: { published: true, ends_at: null },
      expectedStatus: 'published',
      expectedLabel: 'Published',
      expectedTone: 'green'
    },
    {
      description: 'published with a future end time is Published',
      input: { published: true, ends_at: NOW + HOUR },
      expectedStatus: 'published',
      expectedLabel: 'Published',
      expectedTone: 'green'
    },
    {
      description: 'published with a past end time is Expired',
      input: { published: true, ends_at: NOW - HOUR },
      expectedStatus: 'expired',
      expectedLabel: 'Expired',
      expectedTone: 'gray'
    },
    {
      description: 'published with a future start time is Scheduled',
      input: { published: true, starts_at: NOW + HOUR },
      expectedStatus: 'scheduled',
      expectedLabel: 'Scheduled',
      expectedTone: 'orange'
    },
    {
      description: 'published with a past start time is Published',
      input: { published: true, starts_at: NOW - HOUR },
      expectedStatus: 'published',
      expectedLabel: 'Published',
      expectedTone: 'green'
    },
    {
      description:
        'expired takes precedence over a future start time (past end wins)',
      input: { published: true, starts_at: NOW + HOUR, ends_at: NOW - HOUR },
      expectedStatus: 'expired',
      expectedLabel: 'Expired',
      expectedTone: 'gray'
    }
  ])(
    '$description',
    ({ input, expectedStatus, expectedLabel, expectedTone }) => {
      const result = computeAnnouncementStatus(build(input), NOW)
      expect(result.status).toBe(expectedStatus)
      expect(result.label).toBe(expectedLabel)
      expect(result.tone).toBe(expectedTone)
    }
  )
})
