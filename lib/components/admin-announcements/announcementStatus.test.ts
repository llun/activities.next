import type { ServerAnnouncement } from '@/lib/client'

import { computeAnnouncementStatus } from './announcementStatus'

const NOW = Date.parse('2026-06-13T12:00:00.000Z')
const HOUR = 60 * 60 * 1000

const build = (
  overrides: Partial<
    Pick<ServerAnnouncement, 'published' | 'published_at' | 'ends_at'>
  >
): Pick<ServerAnnouncement, 'published' | 'published_at' | 'ends_at'> => ({
  published: false,
  published_at: null,
  ends_at: null,
  ...overrides
})

describe('computeAnnouncementStatus', () => {
  it.each([
    {
      description: 'unpublished with a future publish time is Scheduled',
      input: { published: false, published_at: NOW + HOUR },
      expectedStatus: 'scheduled',
      expectedLabel: 'Scheduled',
      expectedTone: 'orange'
    },
    {
      description: 'unpublished with no publish time is Draft',
      input: { published: false, published_at: null },
      expectedStatus: 'draft',
      expectedLabel: 'Draft',
      expectedTone: 'gray'
    },
    {
      description: 'unpublished with a past publish time is Draft',
      input: { published: false, published_at: NOW - HOUR },
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
